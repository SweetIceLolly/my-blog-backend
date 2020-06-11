const { Pool } = require('pg');

// Connect to the database
var pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Insert a comment in the database
 * @param {number} article_id Article ID
 * @param {string} username Commenter's username
 * @param {string} client Commenter's client
 * @param {string} os Commenter's operating system
 * @param {string} content Comment
 * @param {number} githubid GitHub user ID
 * @param {string} ip Commenter's IP address (Can be IPv4, IPv6 or mixed)
 * @param {function(err, res)} callback Callback function
 */
module.exports.insertComment = function(article_id, username, client, os, content, githubid, ip, callback) {
  const query = 'INSERT INTO comments(articleid, username, client, os, content, githubid, fromip) VALUES ($1, $2, $3, $4, $5, $6, $7)';
  const values = [article_id, username, client, os, content, githubid, ip];

  pool.query(query, values, callback);
};

/**
 * Increase comment count by 1 of an article in the database
 * @param {number} article_id Article ID
 * @param {function(err, res)} callback Callback function
 */
module.exports.increaseCommentCount = function(article_id, callback) {
  const query = 'UPDATE articles SET commentcount = commentcount + 1 WHERE id=$1';
  const values = [article_id];

  pool.query(query, values, callback)
};

/**
 * Decrease comment count by 1 of an article in the database
 * @param {number} article_id Article ID
 * @param {function(err, res)} callback Callback function
 */
module.exports.decreaseCommentCount = function(article_id, callback) {
  const query = 'UPDATE articles SET commentcount = commentcount - 1 WHERE id=$1';
  const values = [article_id];

  pool.query(query, values, callback)
};

/**
 * Get article contents from the database
 * @param {function(err, res)} callback Callback function
 */
module.exports.getContents = function(callback) {
  const query = 'SELECT id, commentcount, title, description, link, category, time FROM articles ORDER BY time DESC';

  pool.query(query, callback);
};

/**
 * Get article info from the database
 * @param {number} article_id Article ID
 * @param {function(err, res)} callback Callback function
 */
module.exports.getArticleInfo = function(article_id, callback) {
  const query = 'SELECT commentcount, title, description, link, category, time FROM articles WHERE id=$1';
  const values = [article_id];

  pool.query(query, values, callback);
}

/**
 * Get article comments from the database
 * @param {number} article_id Article ID
 * @param {function(err, res)} callback Callback function
 */
module.exports.getArticleComments = function(article_id, callback) {
  const query = 'SELECT username, client, os, content, githubid, time FROM comments WHERE articleid=$1 ORDER BY time DESC';
  const values = [article_id];

  pool.query(query, values, callback);
}

/**
 * Add a new article into the database
 * @param {string} title Article title
 * @param {string} description  Article description
 * @param {string} link  Link to the article markdown file
 * @param {string} category  Article category
 * @param {function(err, res)} callback Callback function
 */
module.exports.addArticle = function(title, description, link, category, callback) {
  const query = 'INSERT INTO articles (title, description, link, category) VALUES ($1, $2, $3, $4) RETURNING id';
  const values = [title, description, link, category];

  pool.query(query, values, callback);
}