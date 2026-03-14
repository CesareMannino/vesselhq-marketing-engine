async function handleSocialWebhook(req, res) {
  res.status(202).json({
    status: 'accepted',
    message: 'Webhook placeholder received',
    payload: req.body
  });
}

module.exports = {
  handleSocialWebhook
};
