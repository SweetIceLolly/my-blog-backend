const request = require('request');

/**
 * Validate the given GitHub token
 * @param {string} token Token to check
 * @param {function(body)} valid The function called if the token is valid
 * @param {function(e)} invalid The function called if the token is invalid
 */
module.exports.validateToken = function(token, valid, invalid) {
  var options = {
    url: 'https://api.github.com/user',
    method: 'GET',
    headers: {
      'user-agent': 'Thunderstorm/1.0 (Linux)',
      'Authorization': 'token ' + token
    }
  }

  var req = request(options, function(err, res, body) {
    try {
      if (res.statusCode === 200) {
        valid(body);
      } else {
        invalid(res);
      }
    } catch (err) {
      invalid(err);
    }
  });
  req.on('error', invalid);
  req.end();
}