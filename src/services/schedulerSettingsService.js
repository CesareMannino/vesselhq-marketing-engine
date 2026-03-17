const { pool } = require('../config/db');
const {
  buildCronExpressionFromSettings,
  getDefaultQueueScheduleSettings,
  normalizeWeekdays
} = require('../utils/schedulerHelper');

const SCHEDULER_SETTINGS_KEY = 'queue_schedule';

function normalizeTimeParts(input) {
  const timeValue = String(input && input.time ? input.time : '').trim();

  if (timeValue) {
    const match = timeValue.match(/^(\d{1,2}):(\d{2})$/);

    if (!match) {
      throw new Error('Schedule time must use HH:MM format.');
    }

    return {
      hour: Number(match[1]),
      minute: Number(match[2])
    };
  }

  return {
    hour: Number(input && input.hour),
    minute: Number(input && input.minute)
  };
}

function normalizeSchedulerSettings(input, fallback = getDefaultQueueScheduleSettings()) {
  const weekdays = normalizeWeekdays(input && input.weekdays);
  const timeParts = normalizeTimeParts(input || {});
  const hour = timeParts.hour;
  const minute = timeParts.minute;
  const timezone = String(
    input && input.timezone
      ? input.timezone
      : fallback && fallback.timezone
        ? fallback.timezone
        : getDefaultQueueScheduleSettings().timezone
  ).trim();

  if (!weekdays.length) {
    throw new Error('Select at least one weekday for the automatic schedule.');
  }

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Schedule hour must be between 00 and 23.');
  }

  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Schedule minutes must be between 00 and 59.');
  }

  return {
    weekdays,
    hour,
    minute,
    timezone
  };
}

function mapSchedulerSettings(settings) {
  const normalized = normalizeSchedulerSettings(settings);

  return {
    weekdays: normalized.weekdays,
    hour: normalized.hour,
    minute: normalized.minute,
    time: `${String(normalized.hour).padStart(2, '0')}:${String(normalized.minute).padStart(2, '0')}`,
    timezone: normalized.timezone,
    cronExpression: buildCronExpressionFromSettings(normalized)
  };
}

async function getQueueScheduleSettings() {
  const [rows] = await pool.query(
    `
      SELECT setting_value AS settingValue
      FROM marketing_app_settings
      WHERE setting_key = ?
      LIMIT 1
    `,
    [SCHEDULER_SETTINGS_KEY]
  );

  if (!rows.length) {
    return mapSchedulerSettings(getDefaultQueueScheduleSettings());
  }

  try {
    return mapSchedulerSettings(JSON.parse(rows[0].settingValue));
  } catch (error) {
    return mapSchedulerSettings(getDefaultQueueScheduleSettings());
  }
}

async function updateQueueScheduleSettings(input) {
  const currentSettings = await getQueueScheduleSettings();
  const nextSettings = normalizeSchedulerSettings(input, currentSettings);

  await pool.query(
    `
      INSERT INTO marketing_app_settings (
        setting_key,
        setting_value
      )
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        setting_value = VALUES(setting_value)
    `,
    [SCHEDULER_SETTINGS_KEY, JSON.stringify(nextSettings)]
  );

  return mapSchedulerSettings(nextSettings);
}

module.exports = {
  getQueueScheduleSettings,
  mapSchedulerSettings,
  normalizeSchedulerSettings,
  updateQueueScheduleSettings
};
