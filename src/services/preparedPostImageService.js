const { pool } = require('../config/db');

const PREPARED_POST_IMAGE_API_BASE_URL = String(
  process.env.PREPARED_POST_IMAGE_API_BASE_URL || 'https://image.pollinations.ai/prompt'
).replace(/\/$/, '');
const PREPARED_POST_IMAGE_PROMPT_MAX_CHARS = Math.max(
  20,
  Math.min(Number(process.env.PREPARED_POST_IMAGE_PROMPT_MAX_CHARS) || 120, 500)
);

function normalizePromptText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPreparedPostImageUrl(text) {
  const normalizedText = normalizePromptText(text);

  if (!normalizedText) {
    throw new Error('Prepared post image generation requires text content.');
  }

  const prompt = encodeURIComponent(normalizedText.slice(0, PREPARED_POST_IMAGE_PROMPT_MAX_CHARS));

  return `${PREPARED_POST_IMAGE_API_BASE_URL}/${prompt}`;
}

function isPreparedPostPromptImageUrl(imageUrl) {
  const normalizedImageUrl = String(imageUrl || '').trim();

  if (!normalizedImageUrl) {
    return false;
  }

  return normalizedImageUrl === PREPARED_POST_IMAGE_API_BASE_URL || normalizedImageUrl.startsWith(`${PREPARED_POST_IMAGE_API_BASE_URL}/`);
}

function resolvePreparedPostImageUrl(postData) {
  const existingImageUrl = String(postData && postData.imageUrl ? postData.imageUrl : '').trim();

  if (existingImageUrl) {
    return existingImageUrl;
  }

  if (String(postData && postData.platform ? postData.platform : '').trim().toLowerCase() === 'facebook') {
    return '';
  }

  return buildPreparedPostImageUrl(postData && postData.text);
}

async function fillMissingPreparedPostImages(limit = 500) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
  const [rows] = await pool.query(
    `
      SELECT id, text
      FROM marketing_prepared_posts
      WHERE (image_url IS NULL
         OR TRIM(image_url) = '')
        AND platform <> 'facebook'
      ORDER BY id ASC
      LIMIT ?
    `,
    [safeLimit]
  );

  let updatedCount = 0;

  for (const row of rows) {
    const imageUrl = buildPreparedPostImageUrl(row.text);

    await pool.query(
      `
        UPDATE marketing_prepared_posts
        SET image_url = ?
        WHERE id = ?
      `,
      [imageUrl, row.id]
    );

    updatedCount += 1;
  }

  return {
    checkedCount: rows.length,
    updatedCount
  };
}

module.exports = {
  buildPreparedPostImageUrl,
  fillMissingPreparedPostImages,
  isPreparedPostPromptImageUrl,
  resolvePreparedPostImageUrl
};
