const path = require('path');
const preparedPostService = require('../services/preparedPostService');
const preparedPostImportService = require('../services/preparedPostImportService');
const publisherService = require('../services/publisherService');
const analyticsService = require('../services/analyticsService');
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

async function publishPreparedPostNow(req, res) {
  try {
    const importKeyBase = String((req.body && req.body.importKey) || '').trim();
    const platform = String((req.body && req.body.platform) || 'twitter').trim().toLowerCase();

    if (!importKeyBase) {
      throw new Error('publish-now requires "importKey".');
    }

    const post = await preparedPostService.getPendingPreparedPostByPlatform(importKeyBase, platform);

    if (!post) {
      return res.status(404).json({
        status: 'error',
        message: `No pending ${platform} post found for this queue item.`
      });
    }

    const publishResult = await publisherService.publishPost(post);
    await analyticsService.trackPostCreation(post);
    await preparedPostService.markPreparedPostsAsPublished([post.id]);

    res.status(200).json({
      status: 'ok',
      message: `${platform} post published`,
      result: publishResult
    });
  } catch (error) {
    logger.error('Prepared post publish-now failed', {
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
  publishPreparedPostNow,
  updatePreparedPostGroup,
  uploadPreparedPosts
};
