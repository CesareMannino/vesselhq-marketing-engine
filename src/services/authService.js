const crypto = require('crypto');
const { pool } = require('../config/db');

const COOKIE_NAME = 'vhq_auth';
const DEFAULT_SESSION_HOURS = 24 * 14;
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastSessionCleanupAt = 0;

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

      try {
        accumulator[key] = decodeURIComponent(value);
      } catch (error) {
        accumulator[key] = value;
      }

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

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  return cookies[COOKIE_NAME] || '';
}

async function cleanupExpiredSessions(force = false) {
  const now = Date.now();

  if (!force && now - lastSessionCleanupAt < SESSION_CLEANUP_INTERVAL_MS) {
    return;
  }

  lastSessionCleanupAt = now;
  await pool.query('DELETE FROM marketing_auth_sessions WHERE expires_at <= ?', [now]);
}

async function createSession(username) {
  await cleanupExpiredSessions();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + getSessionDurationSeconds() * 1000;
  const tokenHash = hashSessionToken(token);

  await pool.query(
    `
      INSERT INTO marketing_auth_sessions (token_hash, username, expires_at)
      VALUES (?, ?, ?)
    `,
    [tokenHash, String(username || '').trim(), expiresAt]
  );

  return {
    token,
    expiresAt
  };
}

async function getSessionFromRequest(req) {
  if (!isAuthEnabled()) {
    return {
      username: 'local',
      expiresAt: Date.now() + getSessionDurationSeconds() * 1000
    };
  }

  await cleanupExpiredSessions();
  const token = getSessionTokenFromRequest(req);

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const [rows] = await pool.query(
    `
      SELECT username, expires_at
      FROM marketing_auth_sessions
      WHERE token_hash = ?
      LIMIT 1
    `,
    [tokenHash]
  );

  if (!rows.length) {
    return null;
  }

  const session = rows[0];
  const expiresAt = Number(session.expires_at || 0);

  if (!expiresAt || expiresAt <= Date.now()) {
    await pool.query('DELETE FROM marketing_auth_sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }

  return {
    username: session.username,
    expiresAt
  };
}

async function invalidateSession(req) {
  const token = getSessionTokenFromRequest(req);

  if (token) {
    await pool.query('DELETE FROM marketing_auth_sessions WHERE token_hash = ?', [hashSessionToken(token)]);
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
