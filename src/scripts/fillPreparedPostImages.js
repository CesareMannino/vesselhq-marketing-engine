require('dotenv').config();

const { testConnection } = require('../config/db');
const { fillMissingPreparedPostImages } = require('../services/preparedPostService');
const { ensurePreparedPostSchema } = require('../services/schemaService');
const logger = require('../utils/logger');

async function main() {
  await testConnection();
  await ensurePreparedPostSchema();

  const result = await fillMissingPreparedPostImages(process.argv[2]);

  logger.info('Prepared post images filled', result);
}

main().catch((error) => {
  logger.error('Prepared post image fill script failed', {
    message: error.message
  });
  process.exit(1);
});
