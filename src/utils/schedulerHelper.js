function getDailyCronExpression() {
  return process.env.CRON_SCHEDULE || '0 8 * * *';
}

module.exports = {
  getDailyCronExpression
};
