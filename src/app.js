require('dotenv').config();

const express = require('express');
const path = require('path');
const { scheduleMarketingCron, runMarketingJob } = require('./cron/marketingCron');
const webhookRoutes = require('./routes/webhookRoutes');
const preparedPostRoutes = require('./routes/preparedPostRoutes');
const { ensurePreparedPostSchema } = require('./services/schemaService');
const logger = require('./utils/logger');

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use('/prepared-images', express.static(path.resolve(process.cwd(), 'prepared-images')));

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'vesselhq-marketing-engine',
    message: 'Service is running',
    health: '/health',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'vesselhq-marketing-engine',
    timestamp: new Date().toISOString()
  });
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
