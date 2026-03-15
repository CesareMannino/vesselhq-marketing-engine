function getDailyCronExpression() {
  return process.env.CRON_SCHEDULE || '0 8 * * *';
}

function getCronTimezone() {
  return process.env.CRON_TIMEZONE || 'Europe/Rome';
}

function getCronAutoPlatforms() {
  const rawValue = String(process.env.CRON_AUTO_PLATFORMS || 'facebook').trim().toLowerCase();
  const supportedPlatforms = ['facebook', 'linkedin', 'twitter'];
  const selectedPlatforms = rawValue
    .split(',')
    .map((platform) => platform.trim())
    .filter((platform) => supportedPlatforms.includes(platform));

  return selectedPlatforms.length > 0 ? [...new Set(selectedPlatforms)] : ['facebook'];
}

module.exports = {
  getDailyCronExpression,
  getCronAutoPlatforms,
  getCronTimezone
};
