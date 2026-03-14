async function publish(post) {
  return {
    platform: 'linkedin',
    status: 'queued',
    postId: post.id
  };
}

module.exports = {
  publish
};
