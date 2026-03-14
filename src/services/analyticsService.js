const logger = require('../utils/logger');

async function trackPostCreation(post) {
  logger.info('Analytics placeholder executed', {
    postId: post.id
  });
}

module.exports = {
  trackPostCreation
};
