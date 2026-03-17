require('dotenv').config();

const express = require('express');
const path = require('path');
const { scheduleMarketingCron, runMarketingJob } = require('./cron/marketingCron');
const { ensureAuthenticated } = require('./middleware/authMiddleware');
const { ensureSameOrigin } = require('./middleware/sameOriginMiddleware');
const webhookRoutes = require('./routes/webhookRoutes');
const postRoutes = require('./routes/postRoutes');
const preparedPostRoutes = require('./routes/preparedPostRoutes');
const {
  buildAuthorizationUrl,
  buildOAuthResult,
  consumeState,
  exchangeCodeForToken,
  fetchUserInfo,
  getRedirectUri,
  renderCallbackHtml
} = require('./services/linkedinAuthService');
const {
  buildClearSessionCookie,
  buildSessionCookie,
  createSession,
  getSessionFromRequest,
  invalidateSession,
  isAuthEnabled,
  verifyCredentials
} = require('./services/authService');
const {
  clearLoginThrottle,
  getLoginThrottleState,
  registerFailedLoginAttempt
} = require('./services/loginRateLimitService');
const { ensureDatabaseSchema } = require('./services/schemaService');
const logger = require('./utils/logger');

function sendDashboard(res) {
  res.sendFile(path.resolve(process.cwd(), 'src', 'public', 'dashboard.html'));
}

function sendLogin(res) {
  res.sendFile(path.resolve(process.cwd(), 'src', 'public', 'login.html'));
}

function getSafeNextPath(value) {
  const next = String(value || '/dashboard').trim();
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createApp() {
  const app = express();

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get(
    '/',
    asyncHandler(async (req, res) => {
      if (isAuthEnabled() && !(await getSessionFromRequest(req))) {
        return res.redirect(302, '/login?next=%2Fdashboard');
      }

      if (req.accepts('html')) {
        return sendDashboard(res);
      }

      return res.status(200).json({
        status: 'ok',
        service: 'vesselhq-marketing-engine',
        message: 'Service is running',
        dashboard: '/dashboard',
        health: '/health',
        timestamp: new Date().toISOString()
      });
    })
  );

  app.get(
    '/login',
    asyncHandler(async (req, res) => {
      if (!isAuthEnabled()) {
        return res.redirect(302, '/dashboard');
      }

      if (await getSessionFromRequest(req)) {
        return res.redirect(302, getSafeNextPath(req.query.next));
      }

      return sendLogin(res);
    })
  );

  app.post(
    '/login',
    asyncHandler(async (req, res) => {
      if (!isAuthEnabled()) {
        return res.redirect(302, '/dashboard');
      }

      const throttleState = getLoginThrottleState(req);
      const next = getSafeNextPath(req.body && req.body.next);

      if (throttleState.blocked) {
        res.setHeader('Retry-After', throttleState.retryAfterSeconds);
        return res.redirect(302, `/login?error=rate_limit&next=${encodeURIComponent(next)}`);
      }

      const username = String(req.body && req.body.username ? req.body.username : '').trim();
      const password = String(req.body && req.body.password ? req.body.password : '');

      if (!verifyCredentials(username, password)) {
        registerFailedLoginAttempt(req);
        return res.redirect(302, `/login?error=1&next=${encodeURIComponent(next)}`);
      }

      clearLoginThrottle(req);
      const session = await createSession(username);
      res.setHeader('Set-Cookie', buildSessionCookie(session.token));
      return res.redirect(302, next);
    })
  );

  app.post(
    '/logout',
    ensureSameOrigin,
    asyncHandler(async (req, res) => {
      await invalidateSession(req);
      res.setHeader('Set-Cookie', buildClearSessionCookie());
      return res.redirect(302, '/login');
    })
  );

  app.get('/dashboard', ensureAuthenticated, (req, res) => {
    sendDashboard(res);
  });

  app.get('/queue', ensureAuthenticated, (req, res) => {
    res.redirect(302, '/prepared-posts/ui');
  });

  app.get('/history', ensureAuthenticated, (req, res) => {
    res.redirect(302, '/posts/ui');
  });

  app.get('/status', (req, res) => {
    res.redirect(302, '/health');
  });

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'vesselhq-marketing-engine',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/linkedin/connect', ensureAuthenticated, (req, res) => {
    try {
      const { authorizationUrl, redirectUri, scopes, statePayload } = buildAuthorizationUrl(req.query);

      logger.info('LinkedIn OAuth started', {
        mode: statePayload.mode,
        organizationId: statePayload.organizationId || null,
        redirectUri,
        scopes
      });

      res.redirect(302, authorizationUrl);
    } catch (error) {
      logger.error('LinkedIn OAuth start failed', {
        message: error.message
      });

      res.status(400).json({
        status: 'error',
        message: error.message
      });
    }
  });

  app.get(
    '/linkedin/callback',
    ensureAuthenticated,
    asyncHandler(async (req, res) => {
      if (req.query.error) {
        throw new Error(String(req.query.error_description || req.query.error));
      }

      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();

      if (!code || !state) {
        throw new Error('LinkedIn callback requires both code and state.');
      }

      const statePayload = consumeState(state);
      const tokenPayload = await exchangeCodeForToken(code);
      const userInfo = await fetchUserInfo(tokenPayload.access_token);
      const oauthResult = buildOAuthResult(tokenPayload, userInfo, statePayload);

      logger.info('LinkedIn OAuth completed', {
        mode: statePayload.mode,
        organizationId: statePayload.organizationId || null,
        personId: oauthResult.personId || null,
        authorUrn: oauthResult.selectedAuthorUrn || null,
        redirectUri: getRedirectUri()
      });

      res.status(200).send(renderCallbackHtml(oauthResult));
    })
  );

  app.use('/webhooks', webhookRoutes);
  app.use(ensureAuthenticated);
  app.use(ensureSameOrigin);
  app.use('/prepared-images', express.static(path.resolve(process.cwd(), 'prepared-images')));

  app.post(
    '/run-marketing-job',
    asyncHandler(async (req, res) => {
      try {
        const result = await runMarketingJob({ throwOnError: true });
        res.status(200).json({
          status: 'ok',
          message: 'Marketing job executed',
          result
        });
      } catch (error) {
        logger.error('Manual marketing job failed', {
          message: error.message
        });
        res.status(500).json({
          status: 'error',
          message: error.message
        });
      }
    })
  );

  app.use('/posts', postRoutes);
  app.use('/prepared-posts', preparedPostRoutes);

  app.use((error, req, res, next) => {
    logger.error('Unhandled request error', {
      path: req.originalUrl,
      method: req.method,
      message: error && error.message ? error.message : 'Unknown error'
    });

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error.'
    });
  });

  return app;
}

const port = Number(process.env.PORT) || 3000;
const app = createApp();

async function bootstrap() {
  try {
    await ensureDatabaseSchema();

    app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
      scheduleMarketingCron().catch((error) => {
        logger.error('Marketing cron schedule failed', {
          message: error.message
        });
      });
    });
  } catch (error) {
    logger.error('Server startup failed', {
      name: error && error.name ? error.name : 'Error',
      message: error && error.message ? error.message : '',
      code: error && error.code ? error.code : '',
      errno: error && error.errno ? error.errno : '',
      sqlState: error && error.sqlState ? error.sqlState : '',
      stack: error && error.stack ? error.stack : ''
    });
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}

module.exports = {
  app,
  bootstrap,
  createApp
};
