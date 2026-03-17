const MUTATIVE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeOrigin(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(String(value)).origin.toLowerCase();
  } catch (error) {
    return '';
  }
}

function getRequestOrigin(req) {
  const forwardedProto = String((req && req.headers && req.headers['x-forwarded-proto']) || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const forwardedHost = String((req && req.headers && req.headers['x-forwarded-host']) || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = forwardedHost || String((req && typeof req.get === 'function' && req.get('host')) || '').trim().toLowerCase();
  const protocol = forwardedProto || (req && req.secure ? 'https' : 'http');

  return host ? `${protocol}://${host}` : '';
}

function getAllowedOrigins(req) {
  const allowedOrigins = new Set();
  const appOrigin = normalizeOrigin(process.env.APP_URL);
  const requestOrigin = normalizeOrigin(getRequestOrigin(req));

  if (appOrigin) {
    allowedOrigins.add(appOrigin);
  }

  if (requestOrigin) {
    allowedOrigins.add(requestOrigin);
  }

  return allowedOrigins;
}

function ensureSameOrigin(req, res, next) {
  if (!MUTATIVE_METHODS.has(req.method)) {
    return next();
  }

  const allowedOrigins = getAllowedOrigins(req);
  const origin = normalizeOrigin(req.get('origin'));
  const refererOrigin = normalizeOrigin(req.get('referer'));
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase();

  if ((origin && allowedOrigins.has(origin)) || (!origin && refererOrigin && allowedOrigins.has(refererOrigin))) {
    return next();
  }

  if (!origin && !refererOrigin && fetchSite === 'same-origin') {
    return next();
  }

  return res.status(403).json({
    status: 'error',
    message: 'Cross-site requests are not allowed for authenticated write operations.'
  });
}

module.exports = {
  ensureSameOrigin
};
