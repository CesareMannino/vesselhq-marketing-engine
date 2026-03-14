function getDailyCronExpression() {
  return process.env.CRON_SCHEDULE || '0 8 * * *';
}

function getCronTimezone() {
  return process.env.CRON_TIMEZONE || 'Europe/Rome';
}

module.exports = {
  getDailyCronExpression,
  getCronTimezone
};
