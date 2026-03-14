const socialConfig = require('../config/social');
const facebookPublisher = require('../publishers/facebookPublisher');
const linkedinPublisher = require('../publishers/linkedinPublisher');
const twitterPublisher = require('../publishers/twitterPublisher');

async function publishPost(post) {
  const platform = post.platform || socialConfig.defaultPlatform;

  if (platform === 'linkedin') {
    return linkedinPublisher.publish(post);
  }

  if (platform === 'twitter') {
    return twitterPublisher.publish(post);
  }

  if (platform === 'facebook') {
    return facebookPublisher.publish(post);
  }

  return {
    platform,
    status: 'not_implemented',
    postId: post.id
  };
}

module.exports = {
  publishPost
};
