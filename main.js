const db = require('./dbOperation');
const github = require('./githubApi');
const http = require('http');
const qs = require('querystring');
const Entities = require('html-entities').AllHtmlEntities;
const ua = require('useragent');
const url = require('url');

const entities = new Entities();

const password = process.env.PASSWORD;

// Record previous comment time of users (identified by githubid)
var prevCommentTime = {};

// Record previous password attempt time of users (identified by IP)
// prevPasswordAttemptTime[ip] = [attempted_times, timestamp]
var prevPasswordAttemptTime = {};

/**
 * Strip slashes in the given string
 * @param {string} str String to be processed
 * @return {string} Processed string
 * +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
 * +   improved by: Ates Goral (http://magnetiq.com)
 * +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
 * +   improved by: Ates Goral (http://magnetiq.com)
 * +      fixed by: Mick@el
 * +   improved by: marrtins
 * +   bugfixed by: Onno Marsman
 * +   improved by: rezna
 * +   input by: Rick Waldron
 * +   reimplemented by: Brett Zamir (http://brett-zamir.me)
 * +   input by: Brant Messenger (http://www.brantmessenger.com/)
 * +   bugfixed by: Brett Zamir (http://brett-zamir.me)
 */
function stripslashes (str) {
  return (str + '').replace(/\\(.?)/g, function (s, n1) {
    switch (n1) {
    case '\\':
      return '\\';
    case '0':
      return '\u0000';
    case '':
      return '';
    default:
      return n1;
    }
  });
}

/**
 * Process server data
 * @param {http.IncomingMessage} req Request object
 * @param {http.ServerResponse} res Response object
 */
function serverFunction(req, res) {
  // Response data
  var resJson = {
    status: 200,
    message: {}
  };
  res.setHeader('Content-Type', 'application/json');

  // Allow CORS from my website
  res.setHeader('Access-Control-Allow-Origin', 'http://icelolly.ddns.net:466');

  /**
   * Set status and message of the respond and then respond
   * @param {number} status HTTP status number
   * @param {string} msg Message
   */
  var respond = function(status, msg) {
    resJson.status = status;
    resJson.message = msg;
    res.statusCode = status;

    // Respond
    res.write(JSON.stringify(resJson));
    res.end();
  };

  var reqBody = '';
  var reqData;        // For POST requests
  var reqApi = url.parse(req.url, true);

  /**
   * Append data to reqBody. Also checks if someone tries to flood my RAM
   * @param {string} data Data chunk to append to reqBody
   */
  var appendBody = function(data) {
    reqBody += data;
    if (reqBody.length > 1e6) {
      req.connection.destroy();
    }
  }

  /**
   * Process add comment request
   */
  var processAddComment = function() {
    // Parse the payload
    try {
      reqData = qs.parse(reqBody);
    }
    catch (e) {
      respond(400, 'Cannot parse the requested body.');
      return;
    }

    // token is not a string
    var token = reqData['token'];
    if (typeof(token) !== 'string') {
      respond(400, 'Invalid token type. Expected a string.');
      return;
    }

    // articleid is not a number
    var article_id = parseInt(reqData['articleid']);
    if (Number.isNaN(article_id)) {
      respond(400, 'Invalid articleid type. Expected a number.');
      return;
    }

    // content is not a string
    var content = reqData['content'];
    if (typeof(content) !== 'string') {
      respond(400, 'Invalid content type. Expected a string.');
      return;
    }

    // content is empty
    content = content.trim();
    if (content.length == 0) {
      respond(400, 'Content is empty.');
      return;
    }

    // Strip HTML special chars to prevent HTML injection
    content = stripslashes(content);
    content = entities.encode(content);

    // Determine if the content is too long
    if (content.length > 1000) {
      respond(400, 'Content is too long.');
      return;
    }

    // Validate the given GitHub token
    github.validateToken(token,
      function(body) {
        // Token validated. Parse GitHub user info
        var githubInfo = JSON.parse(body);
        var githubid = githubInfo['id'];

        // Detect if the user with current user (identified by githubid) is requesting too frequently
        if (prevCommentTime[githubid] === undefined) {
          // There is no recording of current user. Create a new entry
          prevCommentTime[githubid] = Date.now();
        } else {
          // Calculate time difference. Reject requests with interval < 20s
          if (Date.now() - prevCommentTime[githubid] < 20000) {
            respond(429, 'You commented too frequently.');
            return;
          } else {
            // Update comment time of current user
            prevCommentTime[githubid] = Date.now();
          }
        }
        
        // Parse user-agent info
        var agent = ua.parse(req.headers['user-agent']);
        var client = agent.major === '0' ? agent.family : agent.family + ' ' + agent.major + '.' + agent.minor + '.' + agent.patch;
        var os = agent.os.major === '0' ? agent.os.family : agent.os.family + ' ' + agent.os.major + '.' + agent.os.minor + '.' + agent.os.patch;
        if (agent.device.family !== 'Other') {
          client += ', ' + agent.device.family;
        }

        // Increase the comment count of this article by 1
        db.increaseCommentCount(article_id, (err, res) => {
          if (err) {
            respond(500, 'Failed to access database');
          } else {
            // Insert the comment into the database
            db.insertComment(article_id, githubInfo['login'], client, os, content, githubid, req.connection.remoteAddress, (err, res) => {
              if (err) {
                respond(500, 'Failed to access database');

                // Undo adding comment count
                db.decreaseCommentCount(article_id, () => {});
              } else {
                respond(200, 'Comment added');
              }
            });
          }
        });
      },
      function() {
        // Token invalid
        respond(401, 'Invalid GitHub login token.');
      }
    );
  }

  /**
   * Process get contents request
   */
  var processGetContents = function() {
    db.getContents((err, res) => {
      if (err) {
        respond(500, 'Failed to access database.');
      } else {
        contents = res.rows;
        respond(200, JSON.stringify(contents));
      }
    });
  }

  /**
   * Process get article info request
   */
  var processGetArticleInfo = function() {
    // articleid is not a number
    var article_id = parseInt(reqApi.query['articleid']);
    if (Number.isNaN(article_id)) {
      respond(400, 'Invalid articleid type. Expected a number.');
      return;
    }

    // Query article info
    db.getArticleInfo(article_id, (err, res) => {
      if (err) {
        respond(500, 'Failed to access database.');
      } else {
        if (res.rows.length === 0) {
          respond(400, 'Article not found.');
        } else {
          var rtnData = res.rows[0];

          // Query corresponding comments
          db.getArticleComments(article_id, (err, res) => {
            if (err) {
              respond(500, 'Failed to access database.');
            } else {
              rtnData['comments'] = res.rows;
              respond(200, JSON.stringify(rtnData));
            }
          });
        }
      }
    });
  }

  /**
   * Process add article request
   */
  var processAddArticle = function() {
    // Parse the payload
    try {
      reqData = qs.parse(reqBody);
    }
    catch (e) {
      respond(400, 'Cannot parse the requested body.');
      return;
    }

    // password is not a string
    var reqPsw = reqData['password'];
    if (typeof(reqPsw) !== 'string') {
      respond(400, 'Invalid password type. Expected a string.');
      return;
    }

    // Check parameter lengths
    var title, desc, link, category;
    try {
      title = reqData['title'].trim(),
      desc = reqData['description'].trim(),
      link = reqData['link'].trim(),
      category = reqData['category'].trim();
      if (!(title.length * desc.length * link.length * category.length > 0)) {
        respond(400, 'Information incomplete.');
        return;
      }
    }
    catch (e) {
      // Encountered undefined type
      respond(400, 'Information incomplete.');
      return;
    }

    // Check if the user is (probably) using a brute-force attack. Threshold = 3; Reset interval = 30s
    if (prevPasswordAttemptTime[req.connection.remoteAddress]) {
      if (prevPasswordAttemptTime[req.connection.remoteAddress][0] >= 3) {
        if (Date.now() - prevPasswordAttemptTime[req.connection.remoteAddress][1] < 30000) {
          respond(429, 'Too many incorrect password attempts.');
          return;
        } else {
          prevPasswordAttemptTime[req.connection.remoteAddress][0] = 0;
        }
      }
    }

    // Check password
    if (reqPsw === password) {
      // Add the article into database
      db.addArticle(title, desc, link, category, (err, res) => {
        if (err) {
          respond(500, 'Failed to access database.');
        } else {
          respond(200, JSON.stringify({id: res.rows[0].id}));
        }
      });
    } else {
      if (prevPasswordAttemptTime[req.connection.remoteAddress]) {
        prevPasswordAttemptTime[req.connection.remoteAddress][0]++;
        prevPasswordAttemptTime[req.connection.remoteAddress][1] = Date.now();
      } else {
        prevPasswordAttemptTime[req.connection.remoteAddress] = [1, Date.now()];
      }
      respond(403, 'Password incorrect.');
    }
  }
  
  switch(reqApi.pathname) {
  case '/':
    // Root
    respond(200, 'There is nothing here!! Go away! ⁄(⁄ ⁄•⁄ω⁄•⁄ ⁄)⁄');
    break;

  case '/addcomment':
    /**
     * API: Add comment
     * Method: POST
     * Args: token: GitHub login token; article_id: Article ID; content: Comment content
     */
    if (req.method === 'POST') {
      req.on('data', appendBody);
      req.on('end', processAddComment);
    } else {
      respond(400, 'Invalid request method');
    }
    break;

  case '/getcontents':
    /**
     * API: Get contents
     * Method: GET
     * Args: none
     */
    if (req.method === 'GET') {
      processGetContents();
    } else {
      respond(400, 'Invalid request method');
    }
    break;

  case '/getarticleinfo':
    /**
     * API: Get article info
     * Method: GET
     * Args: article_id: Article ID
     */
    if (req.method === 'GET') {
      processGetArticleInfo();
    } else {
      respond(400, 'Invalid request method');
    }
    break;

  case '/addarticle':
    /**
     * API: Add a new article
     * Method: POST
     * Args: password: Password; title: Title; description: Description; link: Link; category: Category
     */
    if (req.method === 'POST') {
      req.on('data', appendBody);
      req.on('end', processAddArticle);
    } else {
      respond(400, 'Invalid request method');
    }
    break;

  default:
    // Other
    respond(404, 'Unknown API');
  }
}

// Create server
http.createServer(serverFunction).listen(8080);