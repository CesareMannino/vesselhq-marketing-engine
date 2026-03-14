const path = require('path');
const preparedPostService = require('../services/preparedPostService');
const preparedPostImportService = require('../services/preparedPostImportService');
const logger = require('../utils/logger');

async function importPreparedPosts(req, res) {
  try {
    const result = await preparedPostImportService.importPreparedPostsFromManifest({
      manifestPath: req.body && req.body.manifestPath
    });

    res.status(200).json({
      status: 'ok',
      message: 'Prepared posts imported',
      result
    });
  } catch (error) {
    logger.error('Prepared post import failed', {
      message: error.message
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
}

async function getPreparedQueue(req, res) {
  try {
    const queue = await preparedPostService.listPendingPreparedPosts(req.query.limit);
    res.status(200).json({
      status: 'ok',
      count: queue.length,
      queue
    });
  } catch (error) {
    logger.error('Prepared queue lookup failed', {
      message: error.message
    });

    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
}

async function uploadPreparedPosts(req, res) {
  try {
    const result = await preparedPostImportService.createPreparedPostsFromBrowser(
      req.body && req.body.entries
    );

    res.status(200).json({
      status: 'ok',
      message: 'Prepared posts uploaded',
      result
    });
  } catch (error) {
    logger.error('Prepared post upload failed', {
      message: error.message
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
}

async function updatePreparedPostGroup(req, res) {
  try {
    const result = await preparedPostImportService.updatePreparedPostGroupFromBrowser(req.body);

    res.status(200).json({
      status: 'ok',
      message: 'Prepared post updated',
      result
    });
  } catch (error) {
    logger.error('Prepared post update failed', {
      message: error.message
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
}

function getPreparedPostUi(req, res) {
  res.sendFile(path.resolve(process.cwd(), 'src', 'public', 'prepared-posts.html'));
}

module.exports = {
  getPreparedQueue,
  getPreparedPostUi,
  importPreparedPosts,
  updatePreparedPostGroup,
  uploadPreparedPosts
};
