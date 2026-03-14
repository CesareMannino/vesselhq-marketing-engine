const path = require('path');
const postHistoryService = require('../services/postHistoryService');
const logger = require('../utils/logger');

async function getPostHistory(req, res) {
  try {
    const result = await postHistoryService.listPostHistory({
      limit: req.query.limit,
      status: req.query.status,
      source: req.query.source
    });

    res.status(200).json({
      status: 'ok',
      count: result.posts.length,
      filters: result.filters,
      posts: result.posts
    });
  } catch (error) {
    logger.error('Post history lookup failed', {
      message: error.message
    });

    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
}

function getPostHistoryUi(req, res) {
  res.sendFile(path.resolve(process.cwd(), 'src', 'public', 'posts.html'));
}

module.exports = {
  getPostHistory,
  getPostHistoryUi
};
