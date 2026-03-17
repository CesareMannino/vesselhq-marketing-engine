const { getSessionFromRequest, isAuthEnabled } = require('../services/authService');

const HTML_REDIRECT_PATHS = new Set([
  '/',
  '/dashboard',
  '/queue',
  '/history',
  '/prepared-posts/ui',
  '/posts/ui',
  '/linkedin/connect',
  '/linkedin/callback'
]);

function buildLoginRedirectTarget(req) {
  const next = encodeURIComponent(req.originalUrl || '/dashboard');
  return `/login?next=${next}`;
}

function isHtmlRedirectRequest(req) {
  return req.method === 'GET' && HTML_REDIRECT_PATHS.has(req.path);
}

async function ensureAuthenticated(req, res, next) {
  try {
    if (!isAuthEnabled()) {
      return next();
    }

    const session = await getSessionFromRequest(req);

    if (session) {
      req.authSession = session;
      return next();
    }

    if (isHtmlRedirectRequest(req)) {
      return res.redirect(302, buildLoginRedirectTarget(req));
    }

    return res.status(401).json({
      status: 'error',
      message: 'Authentication required.',
      login: '/login'
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  ensureAuthenticated
};
