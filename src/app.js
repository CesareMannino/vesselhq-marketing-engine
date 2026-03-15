require('dotenv').config();

const express = require('express');
const path = require('path');
const { scheduleMarketingCron, runMarketingJob } = require('./cron/marketingCron');
const { ensureAuthenticated } = require('./middleware/authMiddleware');
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
const { ensurePreparedPostSchema } = require('./services/schemaService');
const logger = require('./utils/logger');

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false }));

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

app.get('/', (req, res) => {
  if (isAuthEnabled() && !getSessionFromRequest(req)) {
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
});

app.get('/login', (req, res) => {
  if (!isAuthEnabled()) {
    return res.redirect(302, '/dashboard');
  }

  if (getSessionFromRequest(req)) {
    return res.redirect(302, getSafeNextPath(req.query.next));
  }

  return sendLogin(res);
});

app.post('/login', (req, res) => {
  if (!isAuthEnabled()) {
    return res.redirect(302, '/dashboard');
  }

  const username = String(req.body && req.body.username ? req.body.username : '').trim();
  const password = String(req.body && req.body.password ? req.body.password : '');
  const next = getSafeNextPath(req.body && req.body.next);

  if (!verifyCredentials(username, password)) {
    return res.redirect(302, `/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const session = createSession(username);
  res.setHeader('Set-Cookie', buildSessionCookie(session.token));
  return res.redirect(302, next);
});

app.post('/logout', (req, res) => {
  invalidateSession(req);
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  return res.redirect(302, '/login');
});

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

app.get('/linkedin/callback', ensureAuthenticated, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('LinkedIn OAuth callback failed', {
      message: error.message
    });

    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
});

app.use('/webhooks', webhookRoutes);
app.use(ensureAuthenticated);
app.use('/prepared-images', express.static(path.resolve(process.cwd(), 'prepared-images')));

app.post('/run-marketing-job', async (req, res) => {
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
});

app.use('/posts', postRoutes);
app.use('/prepared-posts', preparedPostRoutes);

const port = Number(process.env.PORT) || 3000;

async function bootstrap() {
  try {
    await ensurePreparedPostSchema();

    app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
      scheduleMarketingCron();
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

bootstrap();

module.exports = app;
