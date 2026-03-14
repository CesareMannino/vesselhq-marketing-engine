require('dotenv').config();

const { testConnection } = require('../config/db');
const preparedPostImportService = require('../services/preparedPostImportService');
const logger = require('../utils/logger');

async function main() {
  await testConnection();

  const result = await preparedPostImportService.importPreparedPostsFromManifest({
    manifestPath: process.argv[2]
  });

  logger.info('Prepared posts imported from manifest', result);
}

main().catch((error) => {
  logger.error('Prepared post import script failed', {
    message: error.message
  });
  process.exit(1);
});
