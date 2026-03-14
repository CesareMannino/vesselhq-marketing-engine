async function publish(post) {
  return {
    platform: 'facebook',
    status: 'not_implemented',
    postId: post.id
  };
}

module.exports = {
  publish
};
