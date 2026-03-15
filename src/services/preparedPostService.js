const { pool } = require('../config/db');
const PreparedMarketingPost = require('../models/PreparedMarketingPost');

function mapPreparedPostRow(row) {
  return new PreparedMarketingPost({
    id: row.id,
    importKey: row.importKey,
    text: row.text,
    imageUrl: row.imageUrl,
    platform: row.platform,
    scheduledOrder: row.scheduledOrder,
    status: row.status,
    campaignTag: row.campaignTag,
    postType: row.postType,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt
  });
}

function getSupportedImportKeys(importKeyBase) {
  return ['twitter', 'facebook', 'linkedin'].map((platform) => `${importKeyBase}:${platform}`);
}

async function getNextPreparedPostBatch() {
  const [batchRows] = await pool.query(
    `
      SELECT
        id,
        import_key AS importKey,
        text,
        image_url AS imageUrl,
        platform,
        scheduled_order AS scheduledOrder,
        status,
        campaign_tag AS campaignTag,
        post_type AS postType,
        created_at AS createdAt,
        published_at AS publishedAt
      FROM marketing_prepared_posts
      WHERE status = 'pending'
        AND scheduled_order = (
          SELECT MIN(scheduled_order)
          FROM marketing_prepared_posts
          WHERE status = 'pending'
        )
      ORDER BY id ASC
    `
  );

  return batchRows.map(mapPreparedPostRow);
}

async function upsertPreparedPost(postData) {
  await pool.query(
    `
      INSERT INTO marketing_prepared_posts (
        import_key,
        text,
        image_url,
        platform,
        scheduled_order,
        status,
        campaign_tag,
        post_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        text = VALUES(text),
        image_url = VALUES(image_url),
        platform = VALUES(platform),
        scheduled_order = VALUES(scheduled_order),
        campaign_tag = VALUES(campaign_tag),
        post_type = VALUES(post_type),
        status = IF(
          marketing_prepared_posts.status = 'published',
          marketing_prepared_posts.status,
          VALUES(status)
        )
    `,
    [
      postData.importKey,
      postData.text,
      postData.imageUrl,
      postData.platform,
      postData.scheduledOrder,
      postData.status || 'pending',
      postData.campaignTag || null,
      postData.postType || null
    ]
  );
}

async function markPreparedPostsAsPublished(postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return;
  }

  await pool.query(
    `
      UPDATE marketing_prepared_posts
      SET status = 'published',
          published_at = CURRENT_TIMESTAMP
      WHERE id IN (?)
    `,
    [postIds]
  );
}

async function listPendingPreparedPosts(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const [rows] = await pool.query(
    `
      SELECT
        id,
        import_key AS importKey,
        text,
        image_url AS imageUrl,
        platform,
        scheduled_order AS scheduledOrder,
        status,
        campaign_tag AS campaignTag,
        post_type AS postType,
        created_at AS createdAt,
        published_at AS publishedAt
      FROM marketing_prepared_posts
      WHERE status = 'pending'
      ORDER BY scheduled_order ASC, id ASC
      LIMIT ?
    `,
    [safeLimit]
  );

  return rows.map(mapPreparedPostRow);
}

async function getPendingPreparedPostGroup(importKeyBase) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        import_key AS importKey,
        text,
        image_url AS imageUrl,
        platform,
        scheduled_order AS scheduledOrder,
        status,
        campaign_tag AS campaignTag,
        post_type AS postType,
        created_at AS createdAt,
        published_at AS publishedAt
      FROM marketing_prepared_posts
      WHERE status = 'pending'
        AND import_key IN (?)
      ORDER BY id ASC
    `,
    [getSupportedImportKeys(importKeyBase)]
  );

  return rows.map(mapPreparedPostRow);
}

async function getPendingPreparedPostByPlatform(importKeyBase, platform) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        import_key AS importKey,
        text,
        image_url AS imageUrl,
        platform,
        scheduled_order AS scheduledOrder,
        status,
        campaign_tag AS campaignTag,
        post_type AS postType,
        created_at AS createdAt,
        published_at AS publishedAt
      FROM marketing_prepared_posts
      WHERE status = 'pending'
        AND import_key = ?
      LIMIT 1
    `,
    [`${importKeyBase}:${platform}`]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapPreparedPostRow(rows[0]);
}

async function updatePendingPreparedPostGroup(groupData) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
        SELECT
          id,
          import_key AS importKey,
          platform
        FROM marketing_prepared_posts
        WHERE status = 'pending'
          AND import_key IN (?)
      `,
      [getSupportedImportKeys(groupData.importKeyBase)]
    );

    if (existingRows.length === 0) {
      throw new Error('Pending prepared post group not found.');
    }

    const existingPlatforms = new Set(existingRows.map((row) => row.platform));
    const selectedPlatforms = new Set(groupData.platforms);
    const platformsToDelete = [...existingPlatforms].filter((platform) => !selectedPlatforms.has(platform));

    if (platformsToDelete.length > 0) {
      await connection.query(
        `
          DELETE FROM marketing_prepared_posts
          WHERE status = 'pending'
            AND import_key IN (?)
        `,
        [platformsToDelete.map((platform) => `${groupData.importKeyBase}:${platform}`)]
      );
    }

    for (const platform of groupData.platforms) {
      await connection.query(
        `
          INSERT INTO marketing_prepared_posts (
            import_key,
            text,
            image_url,
            platform,
            scheduled_order,
            status,
            campaign_tag,
            post_type
          )
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
          ON DUPLICATE KEY UPDATE
            text = VALUES(text),
            image_url = VALUES(image_url),
            platform = VALUES(platform),
            scheduled_order = VALUES(scheduled_order),
            campaign_tag = VALUES(campaign_tag),
            post_type = VALUES(post_type),
            status = 'pending'
        `,
        [
          `${groupData.importKeyBase}:${platform}`,
          groupData.text,
          groupData.imageUrl,
          platform,
          groupData.scheduledOrder,
          groupData.campaignTag || null,
          groupData.postType || null
        ]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return getPendingPreparedPostGroup(groupData.importKeyBase);
}

async function deletePendingPreparedPostGroup(importKeyBase) {
  const safeImportKeyBase = String(importKeyBase || '').trim();

  if (!safeImportKeyBase) {
    throw new Error('Prepared post delete requires "importKey".');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
        SELECT id
        FROM marketing_prepared_posts
        WHERE status = 'pending'
          AND import_key IN (?)
      `,
      [getSupportedImportKeys(safeImportKeyBase)]
    );

    if (existingRows.length === 0) {
      throw new Error('Pending prepared post group not found.');
    }

    await connection.query(
      `
        DELETE FROM marketing_prepared_posts
        WHERE status = 'pending'
          AND import_key IN (?)
      `,
      [getSupportedImportKeys(safeImportKeyBase)]
    );

    await connection.commit();

    return {
      deletedCount: existingRows.length,
      importKeyBase: safeImportKeyBase
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  deletePendingPreparedPostGroup,
  getPendingPreparedPostByPlatform,
  getPendingPreparedPostGroup,
  getNextPreparedPostBatch,
  listPendingPreparedPosts,
  markPreparedPostsAsPublished,
  updatePendingPreparedPostGroup,
  upsertPreparedPost
};
