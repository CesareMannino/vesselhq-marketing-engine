const { pool } = require('../config/db');

function normalizeLimit(limit = 50) {
  return Math.max(1, Math.min(Number(limit) || 50, 200));
}

function normalizeStatus(status = 'published') {
  const value = String(status || 'published').trim().toLowerCase();

  if (['published', 'pending', 'draft', 'failed', 'all'].includes(value)) {
    return value;
  }

  return 'published';
}

function normalizeSource(source = 'all') {
  const value = String(source || 'all').trim().toLowerCase();

  if (['all', 'generated', 'prepared'].includes(value)) {
    return value;
  }

  return 'all';
}

async function listGeneratedPosts(limit, status) {
  const params = [];
  let whereClause = '';

  if (status !== 'all') {
    whereClause = 'WHERE mp.publish_status = ?';
    params.push(status);
  }

  params.push(limit);

  const [rows] = await pool.query(
    `
      SELECT
        mp.id,
        'generated' AS source,
        mp.platform,
        mp.content,
        mp.image_url AS imageUrl,
        mp.image_prompt AS imagePrompt,
        mp.publish_status AS status,
        mt.title AS topicTitle,
        mt.angle AS topicAngle,
        mp.created_at AS createdAt,
        NULL AS publishedAt,
        NULL AS importKey,
        NULL AS scheduledOrder,
        NULL AS campaignTag,
        NULL AS postType
      FROM marketing_posts mp
      INNER JOIN marketing_topics mt ON mt.id = mp.topic_id
      ${whereClause}
      ORDER BY mp.created_at DESC, mp.id DESC
      LIMIT ?
    `,
    params
  );

  return rows.map((row) => ({
    ...row,
    sortDate: row.publishedAt || row.createdAt
  }));
}

async function listPreparedPosts(limit, status) {
  const params = [];
  let whereClause = '';

  if (status !== 'all') {
    whereClause = 'WHERE mpp.status = ?';
    params.push(status);
  }

  params.push(limit);

  const [rows] = await pool.query(
    `
      SELECT
        mpp.id,
        'prepared' AS source,
        mpp.platform,
        mpp.text AS content,
        mpp.image_url AS imageUrl,
        NULL AS imagePrompt,
        mpp.status,
        NULL AS topicTitle,
        NULL AS topicAngle,
        mpp.created_at AS createdAt,
        mpp.published_at AS publishedAt,
        mpp.import_key AS importKey,
        mpp.scheduled_order AS scheduledOrder,
        mpp.campaign_tag AS campaignTag,
        mpp.post_type AS postType
      FROM marketing_prepared_posts mpp
      ${whereClause}
      ORDER BY COALESCE(mpp.published_at, mpp.created_at) DESC, mpp.id DESC
      LIMIT ?
    `,
    params
  );

  return rows.map((row) => ({
    ...row,
    sortDate: row.publishedAt || row.createdAt
  }));
}

function bySortDateDesc(a, b) {
  return new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime();
}

async function listPostHistory(options = {}) {
  const limit = normalizeLimit(options.limit);
  const status = normalizeStatus(options.status);
  const source = normalizeSource(options.source);

  const [generatedPosts, preparedPosts] = await Promise.all([
    source === 'all' || source === 'generated' ? listGeneratedPosts(limit, status) : Promise.resolve([]),
    source === 'all' || source === 'prepared' ? listPreparedPosts(limit, status) : Promise.resolve([])
  ]);

  const posts = [...generatedPosts, ...preparedPosts]
    .sort(bySortDateDesc)
    .slice(0, limit)
    .map(({ sortDate, ...post }) => post);

  return {
    posts,
    filters: {
      limit,
      status,
      source
    }
  };
}

module.exports = {
  listPostHistory
};
