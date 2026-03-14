async function publish(post) {
  return {
    platform: 'twitter',
    status: 'not_implemented',
    postId: post.id
  };
}

module.exports = {
  publish
};
