const cron = require('node-cron');
const topicService = require('../services/topicService');
const contentService = require('../services/contentService');
const imageService = require('../services/imageService');
const publisherService = require('../services/publisherService');
const analyticsService = require('../services/analyticsService');
const preparedPostService = require('../services/preparedPostService');
const { ensurePreparedPostHasManagedImage } = require('../services/preparedPostImageService');
const logger = require('../utils/logger');
const { getDailyCronExpression, getCronAutoPlatforms, getCronTimezone } = require('../utils/schedulerHelper');

let marketingTask;

async function runMarketingJob(options = {}) {
  const { throwOnError = false } = options;

  try {
    const autoPlatforms = getCronAutoPlatforms();
    const preparedBatch = await preparedPostService.getNextPreparedPostBatch(autoPlatforms);

    if (preparedBatch.length > 0) {
      for (const preparedPost of preparedBatch) {
        ensurePreparedPostHasManagedImage(
          preparedPost.imageUrl,
          `Prepared post ${preparedPost.importKey || preparedPost.id}`
        );
        await publisherService.publishPost(preparedPost);
        await analyticsService.trackPostCreation(preparedPost);
      }

      await preparedPostService.markPreparedPostsAsPublished(
        preparedBatch.map((preparedPost) => preparedPost.id)
      );

      logger.info('Prepared marketing batch published', {
        scheduledOrder: preparedBatch[0].scheduledOrder,
        postIds: preparedBatch.map((preparedPost) => preparedPost.id),
        platforms: preparedBatch.map((preparedPost) => preparedPost.platform),
        autoPlatforms,
        contentSource: 'prepared'
      });

      return {
        success: true,
        publishedCount: preparedBatch.length,
        postIds: preparedBatch.map((preparedPost) => preparedPost.id),
        scheduledOrder: preparedBatch[0].scheduledOrder,
        contentSource: 'prepared'
      };
    }

    const topic = await topicService.getNextTopic();
    const generatedContent = await contentService.generateLinkedInPost(topic);
    const content = generatedContent.text;
    const imagePrompt = contentService.generateImagePrompt(topic, content);
    const imageAsset = await imageService.createMarketingImage(topic, imagePrompt);

    const post = await contentService.saveMarketingPost({
      topicId: topic.id,
      platform: autoPlatforms[0] || 'facebook',
      content,
      imagePrompt,
      imageUrl: imageAsset.secureUrl,
      publishStatus: 'draft'
    });

    await topicService.markTopicAsUsed(topic.id);
    await publisherService.publishPost(post);
    await contentService.updatePostPublishStatus(post.id, 'published');
    await analyticsService.trackPostCreation(post);

    logger.info('Marketing post created', {
      postId: post.id,
      topicId: topic.id,
      contentSource: generatedContent.source,
      imageSimulated: imageAsset.simulated
    });

    return {
      success: true,
      postId: post.id,
      topicId: topic.id,
      contentSource: generatedContent.source,
      imageSimulated: imageAsset.simulated
    };
  } catch (error) {
    logger.error('Marketing cron failed', {
      message: error.message
    });

    if (throwOnError) {
      throw error;
    }

    return {
      success: false,
      error: error.message
    };
  }
}

function scheduleMarketingCron() {
  if (marketingTask) {
    return marketingTask;
  }

  const cronExpression = getDailyCronExpression();
  const cronTimezone = getCronTimezone();

  marketingTask = cron.schedule(cronExpression, runMarketingJob, {
    scheduled: true,
    timezone: cronTimezone
  });

  logger.info(`Marketing cron scheduled with expression "${cronExpression}" in timezone "${cronTimezone}"`);

  return marketingTask;
}

module.exports = {
  runMarketingJob,
  scheduleMarketingCron
};
