const { pool } = require('../config/db');
const PreparedMarketingPost = require('../models/PreparedMarketingPost');
const { ensurePreparedPostHasManagedImage, resolvePreparedPostImageUrl } = require('./preparedPostImageService');

function mapPreparedPostRow(row) {
  return new PreparedMarketingPost({
    id: row.id,
    importKey: row.importKey,
    text: row.text,
    imageUrl: resolvePreparedPostImageUrl({
      text: row.text,
      imageUrl: row.imageUrl,
      platform: row.platform
    }),
    platform: row.platform,
    scheduledOrder: row.scheduledOrder,
    status: row.status,
    campaignTag: row.campaignTag,
    postType: row.postType,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt
  });
}

function getPlatformImportKeys(importKeyBase, platform) {
  const safeImportKeyBase = String(importKeyBase || '').trim();
  const safePlatform = String(platform || '').trim().toLowerCase();

  if (!safeImportKeyBase || !safePlatform) {
    return [];
  }

  const suffixMap = {
    twitter: '_tw',
    facebook: '_fb',
    linkedin: '_li'
  };
  const platformSuffix = suffixMap[safePlatform] || '';
  const normalizedBase = safeImportKeyBase
    .replace(new RegExp(`:${safePlatform}$`, 'i'), '')
    .replace(new RegExp(`${platformSuffix}$`, 'i'), '');

  const keys = [
    safeImportKeyBase,
    `${normalizedBase}:${safePlatform}`,
    `${normalizedBase}${platformSuffix}`,
    `${safeImportKeyBase}:${safePlatform}`,
    `${safeImportKeyBase}${platformSuffix}`
  ].filter(Boolean);

  return [...new Set(keys)];
}

function getSupportedImportKeys(importKeyBase) {
  return ['twitter', 'facebook', 'linkedin'].flatMap((platform) =>
    getPlatformImportKeys(importKeyBase, platform)
  );
}

function normalizePlatformFilter(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return [];
  }

  const supportedPlatforms = new Set(['twitter', 'facebook', 'linkedin']);

  return [...new Set(
    platforms
      .map((platform) => String(platform || '').trim().toLowerCase())
      .filter((platform) => supportedPlatforms.has(platform))
  )];
}

async function getNextPreparedPostBatch(platforms = []) {
  const normalizedPlatforms = normalizePlatformFilter(platforms);
  const platformClause = normalizedPlatforms.length > 0 ? 'AND platform IN (?)' : '';
  const params = normalizedPlatforms.length > 0 ? [normalizedPlatforms, normalizedPlatforms] : [];
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
        ${platformClause}
        AND scheduled_order = (
          SELECT MIN(scheduled_order)
          FROM marketing_prepared_posts
          WHERE status = 'pending'
            ${platformClause}
        )
      ORDER BY id ASC
    `,
    params
  );

  return batchRows.map(mapPreparedPostRow);
}

async function upsertPreparedPost(postData) {
  const imageUrl = ensurePreparedPostHasManagedImage(
    resolvePreparedPostImageUrl(postData),
    'Prepared post'
  );

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
      imageUrl,
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

async function listPreparedPostsForQueue(limit = 100) {
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
      ORDER BY
        CASE status
          WHEN 'pending' THEN 0
          WHEN 'failed' THEN 1
          ELSE 2
        END ASC,
        scheduled_order ASC,
        COALESCE(published_at, created_at) DESC,
        id ASC
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
  const candidateImportKeys = getPlatformImportKeys(importKeyBase, platform);

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
      LIMIT 1
    `,
    [candidateImportKeys]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapPreparedPostRow(rows[0]);
}

async function updatePendingPreparedPostGroup(groupData) {
  const imageUrl = ensurePreparedPostHasManagedImage(
    resolvePreparedPostImageUrl(groupData),
    'Prepared post update'
  );
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
        [platformsToDelete.flatMap((platform) => getPlatformImportKeys(groupData.importKeyBase, platform))]
      );
    }

    for (const platform of groupData.platforms) {
      const existingRow = existingRows.find((row) => row.platform === platform);
      const importKey = existingRow ? existingRow.importKey : `${groupData.importKeyBase}:${platform}`;

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
          importKey,
          groupData.text,
          imageUrl,
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

async function deletePendingPreparedPostsByScheduledOrder(scheduledOrder) {
  const safeScheduledOrder = Number(scheduledOrder);

  if (!Number.isInteger(safeScheduledOrder) || safeScheduledOrder < 1) {
    throw new Error('Prepared post delete requires a valid "scheduledOrder".');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
        SELECT id
        FROM marketing_prepared_posts
        WHERE status = 'pending'
          AND scheduled_order = ?
      `,
      [safeScheduledOrder]
    );

    if (existingRows.length === 0) {
      throw new Error('No pending prepared posts found for this scheduled day.');
    }

    await connection.query(
      `
        DELETE FROM marketing_prepared_posts
        WHERE status = 'pending'
          AND scheduled_order = ?
      `,
      [safeScheduledOrder]
    );

    await connection.commit();

    return {
      deletedCount: existingRows.length,
      scheduledOrder: safeScheduledOrder
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  deletePendingPreparedPostsByScheduledOrder,
  deletePendingPreparedPostGroup,
  getPendingPreparedPostByPlatform,
  getPendingPreparedPostGroup,
  getNextPreparedPostBatch,
  listPreparedPostsForQueue,
  listPendingPreparedPosts,
  markPreparedPostsAsPublished,
  updatePendingPreparedPostGroup,
  upsertPreparedPost
};
