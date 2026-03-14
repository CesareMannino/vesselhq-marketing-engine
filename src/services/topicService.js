const { pool } = require('../config/db');
const MarketingTopic = require('../models/MarketingTopic');
const { generateFallbackTopic } = require('../ai/topicGenerator');

async function getNextTopic() {
  const [rows] = await pool.query(
    `
      SELECT id, title, angle, status, created_at AS createdAt
      FROM marketing_topics
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `
  );

  if (rows.length > 0) {
    return new MarketingTopic(rows[0]);
  }

  return createFallbackTopic();
}

async function createFallbackTopic() {
  const fallback = generateFallbackTopic();

  const [result] = await pool.query(
    `
      INSERT INTO marketing_topics (title, angle, status)
      VALUES (?, ?, 'pending')
    `,
    [fallback.title, fallback.angle]
  );

  return new MarketingTopic({
    id: result.insertId,
    ...fallback,
    status: 'pending'
  });
}

async function markTopicAsUsed(topicId) {
  await pool.query(
    `
      UPDATE marketing_topics
      SET status = 'used',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [topicId]
  );
}

module.exports = {
  getNextTopic,
  markTopicAsUsed
};
