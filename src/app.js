require('dotenv').config();

const express = require('express');
const path = require('path');
const { scheduleMarketingCron, runMarketingJob } = require('./cron/marketingCron');
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
const { ensurePreparedPostSchema } = require('./services/schemaService');
const logger = require('./utils/logger');

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use('/prepared-images', express.static(path.resolve(process.cwd(), 'prepared-images')));

function sendDashboard(res) {
  res.sendFile(path.resolve(process.cwd(), 'src', 'public', 'dashboard.html'));
}

app.get('/', (req, res) => {
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

app.get('/dashboard', (req, res) => {
  sendDashboard(res);
});

app.get('/queue', (req, res) => {
  res.redirect(302, '/prepared-posts/ui');
});

app.get('/history', (req, res) => {
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

app.get('/linkedin/connect', (req, res) => {
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

app.get('/linkedin/callback', async (req, res) => {
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

app.use('/webhooks', webhookRoutes);
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
