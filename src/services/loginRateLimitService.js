const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_MAX_ATTEMPTS = 5;
const attemptsByClient = new Map();

function getRateLimitWindowMs() {
  const configuredMinutes = Number(process.env.AUTH_LOGIN_WINDOW_MINUTES || DEFAULT_WINDOW_MINUTES);
  const safeMinutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : DEFAULT_WINDOW_MINUTES;
  return Math.round(safeMinutes * 60 * 1000);
}

function getMaxAttempts() {
  const configuredAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
  return Number.isFinite(configuredAttempts) && configuredAttempts > 0 ? Math.floor(configuredAttempts) : DEFAULT_MAX_ATTEMPTS;
}

function getClientKey(req) {
  const forwardedFor = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return forwardedFor || req.ip || (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

function clearExpiredAttempts(now = Date.now()) {
  for (const [clientKey, bucket] of attemptsByClient.entries()) {
    if (!bucket || bucket.resetAt <= now) {
      attemptsByClient.delete(clientKey);
    }
  }
}

function getBucket(clientKey, now = Date.now()) {
  clearExpiredAttempts(now);

  const existingBucket = attemptsByClient.get(clientKey);

  if (existingBucket && existingBucket.resetAt > now) {
    return existingBucket;
  }

  const bucket = {
    count: 0,
    resetAt: now + getRateLimitWindowMs()
  };
  attemptsByClient.set(clientKey, bucket);
  return bucket;
}

function getLoginThrottleState(req) {
  const now = Date.now();
  const clientKey = getClientKey(req);
  const bucket = getBucket(clientKey, now);
  const remainingAttempts = Math.max(0, getMaxAttempts() - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return {
    blocked: bucket.count >= getMaxAttempts(),
    remainingAttempts,
    retryAfterSeconds
  };
}

function registerFailedLoginAttempt(req) {
  const bucket = getBucket(getClientKey(req));
  bucket.count += 1;
  return getLoginThrottleState(req);
}

function clearLoginThrottle(req) {
  attemptsByClient.delete(getClientKey(req));
}

module.exports = {
  clearLoginThrottle,
  getLoginThrottleState,
  registerFailedLoginAttempt
};
