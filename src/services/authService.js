const crypto = require('crypto');

const COOKIE_NAME = 'vhq_auth';
const DEFAULT_SESSION_HOURS = 24 * 14;
const sessions = new Map();

function getRequiredLoginUsername() {
  return String(process.env.LOGIN_USERNAME || '').trim();
}

function getRequiredLoginPassword() {
  return String(process.env.LOGIN_PASSWORD || '');
}

function isAuthEnabled() {
  return Boolean(getRequiredLoginUsername() && getRequiredLoginPassword());
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=');

      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function getSessionDurationSeconds() {
  const configuredHours = Number(process.env.AUTH_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  const safeHours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : DEFAULT_SESSION_HOURS;
  return Math.round(safeHours * 60 * 60);
}

function shouldUseSecureCookies() {
  const explicitValue = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase();

  if (explicitValue === 'true') {
    return true;
  }

  if (explicitValue === 'false') {
    return false;
  }

  const appUrl = String(process.env.APP_URL || '').trim().toLowerCase();
  return appUrl.startsWith('https://');
}

function buildCookieValue(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildSessionCookie(token) {
  return buildCookieValue(COOKIE_NAME, token, {
    maxAge: getSessionDurationSeconds(),
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies()
  });
}

function buildClearSessionCookie() {
  return buildCookieValue(COOKIE_NAME, '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies()
  });
}

function timingSafeMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCredentials(username, password) {
  if (!isAuthEnabled()) {
    return true;
  }

  return (
    timingSafeMatch(username, getRequiredLoginUsername()) &&
    timingSafeMatch(password, getRequiredLoginPassword())
  );
}

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function createSession(username) {
  cleanupExpiredSessions();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + getSessionDurationSeconds() * 1000;

  sessions.set(token, {
    username: String(username || '').trim(),
    expiresAt
  });

  return {
    token,
    expiresAt
  };
}

function getSessionFromRequest(req) {
  if (!isAuthEnabled()) {
    return {
      username: 'local',
      expiresAt: Date.now() + getSessionDurationSeconds() * 1000
    };
  }

  cleanupExpiredSessions();
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  const token = cookies[COOKIE_NAME];

  if (!token || !sessions.has(token)) {
    return null;
  }

  return sessions.get(token);
}

function invalidateSession(req) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  const token = cookies[COOKIE_NAME];

  if (token) {
    sessions.delete(token);
  }
}

module.exports = {
  buildClearSessionCookie,
  buildSessionCookie,
  COOKIE_NAME,
  createSession,
  getSessionFromRequest,
  invalidateSession,
  isAuthEnabled,
  verifyCredentials
};
