function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const serializedMeta = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${serializedMeta}`;
}

function info(message, meta) {
  console.log(formatMessage('info', message, meta));
}

function error(message, meta) {
  console.error(formatMessage('error', message, meta));
}

module.exports = {
  info,
  error
};
