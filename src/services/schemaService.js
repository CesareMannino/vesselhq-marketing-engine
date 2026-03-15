const { pool, testConnection } = require('../config/db');

async function getPreparedPostColumns() {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'marketing_prepared_posts'
    `
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function hasPreparedPostImportKeyIndex() {
  const [rows] = await pool.query(
    `
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'marketing_prepared_posts'
        AND INDEX_NAME = 'uq_marketing_prepared_posts_import_key'
    `
  );

  return rows.length > 0;
}

async function ensurePreparedPostSchema() {
  await testConnection();

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS marketing_prepared_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        import_key VARCHAR(255) NOT NULL,
        text TEXT NOT NULL,
        image_url VARCHAR(500) DEFAULT NULL,
        platform VARCHAR(50) NOT NULL,
        scheduled_order INT NOT NULL,
        status ENUM('pending', 'published', 'failed') NOT NULL DEFAULT 'pending',
        campaign_tag VARCHAR(100) DEFAULT NULL,
        post_type VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY uq_marketing_prepared_posts_import_key (import_key)
      )
    `
  );

  const columns = await getPreparedPostColumns();

  if (!columns.has('import_key')) {
    await pool.query(
      `
        ALTER TABLE marketing_prepared_posts
        ADD COLUMN import_key VARCHAR(255) NULL AFTER id
      `
    );

    await pool.query(
      `
        UPDATE marketing_prepared_posts
        SET import_key = CONCAT('legacy-', id)
        WHERE import_key IS NULL
           OR import_key = ''
      `
    );

    await pool.query(
      `
        ALTER TABLE marketing_prepared_posts
        MODIFY COLUMN import_key VARCHAR(255) NOT NULL
      `
    );
  }

  if (!columns.has('campaign_tag')) {
    await pool.query(
      `
        ALTER TABLE marketing_prepared_posts
        ADD COLUMN campaign_tag VARCHAR(100) DEFAULT NULL AFTER status
      `
    );
  }

  if (!columns.has('post_type')) {
    await pool.query(
      `
        ALTER TABLE marketing_prepared_posts
        ADD COLUMN post_type VARCHAR(100) DEFAULT NULL AFTER campaign_tag
      `
    );
  }

  if (!columns.has('published_at')) {
    await pool.query(
      `
        ALTER TABLE marketing_prepared_posts
        ADD COLUMN published_at TIMESTAMP NULL DEFAULT NULL AFTER created_at
      `
    );

    if (columns.has('posted_at')) {
      await pool.query(
        `
          UPDATE marketing_prepared_posts
          SET published_at = posted_at
          WHERE published_at IS NULL
            AND posted_at IS NOT NULL
        `
      );
    }
  }

  await pool.query(
    `
      ALTER TABLE marketing_prepared_posts
      MODIFY COLUMN image_url VARCHAR(500) DEFAULT NULL
    `
  );

  if (!(await hasPreparedPostImportKeyIndex())) {
    await pool.query(
      `
        ALTER TABLE marketing_prepared_posts
        ADD UNIQUE KEY uq_marketing_prepared_posts_import_key (import_key)
      `
    );
  }
}

module.exports = {
  ensurePreparedPostSchema
};
