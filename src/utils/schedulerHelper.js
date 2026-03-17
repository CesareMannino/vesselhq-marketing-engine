const WEEKDAY_UI_ORDER = [1, 2, 3, 4, 5, 6, 0];

function getDailyCronExpression() {
  return process.env.CRON_SCHEDULE || '0 8 * * *';
}

function getCronTimezone() {
  return process.env.CRON_TIMEZONE || 'Europe/Rome';
}

function normalizeWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) {
    return [];
  }

  const seen = new Set();

  weekdays.forEach((weekday) => {
    const safeWeekday = Number(weekday);

    if (!Number.isInteger(safeWeekday)) {
      return;
    }

    const normalizedWeekday = safeWeekday === 7 ? 0 : safeWeekday;

    if (normalizedWeekday >= 0 && normalizedWeekday <= 6) {
      seen.add(normalizedWeekday);
    }
  });

  return WEEKDAY_UI_ORDER.filter((weekday) => seen.has(weekday));
}

function parseCronScheduleExpression(expression) {
  const parts = String(expression || '').trim().split(/\s+/);

  if (parts.length !== 5) {
    return null;
  }

  const [minutePart, hourPart, dayOfMonth, month, dayOfWeek] = parts;
  const minute = Number(minutePart);
  const hour = Number(hourPart);

  if (
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    dayOfMonth !== '*' ||
    month !== '*'
  ) {
    return null;
  }

  const weekdays = dayOfWeek === '*'
    ? [...WEEKDAY_UI_ORDER]
    : normalizeWeekdays(dayOfWeek.split(','));

  if (!weekdays.length) {
    return null;
  }

  return {
    hour,
    minute,
    weekdays
  };
}

function getDefaultQueueScheduleSettings() {
  const parsedCron = parseCronScheduleExpression(getDailyCronExpression());

  return {
    weekdays: parsedCron ? parsedCron.weekdays : [...WEEKDAY_UI_ORDER],
    hour: parsedCron ? parsedCron.hour : 8,
    minute: parsedCron ? parsedCron.minute : 0,
    timezone: getCronTimezone()
  };
}

function buildCronExpressionFromSettings(settings = {}) {
  const hour = Number(settings.hour);
  const minute = Number(settings.minute);
  const weekdays = normalizeWeekdays(settings.weekdays);

  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !weekdays.length
  ) {
    throw new Error('Invalid scheduler settings.');
  }

  const dayOfWeek = weekdays.length === 7 ? '*' : weekdays.join(',');

  return `${minute} ${hour} * * ${dayOfWeek}`;
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
  buildCronExpressionFromSettings,
  getCronAutoPlatforms,
  getCronTimezone,
  getDailyCronExpression,
  getDefaultQueueScheduleSettings,
  normalizeWeekdays,
  parseCronScheduleExpression,
  WEEKDAY_UI_ORDER
};
