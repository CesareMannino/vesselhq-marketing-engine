const { pool } = require('../config/db');
const { getOpenAIClient } = require('../config/openai');
const { buildLinkedInPrompt, buildImagePrompt } = require('../ai/promptBuilder');
const MarketingPost = require('../models/MarketingPost');
const logger = require('../utils/logger');

function buildMockLinkedInPost(topic) {
  return [
    `Maritime operators are under pressure to do more with every voyage, and ${topic.title.toLowerCase()} is becoming a real differentiator.`,
    '',
    `${topic.angle}. Teams that operationalize this well tend to communicate faster, reduce friction across stakeholders, and present a stronger commercial story to charterers and shippers.`,
    '',
    'For maritime brands, the opportunity is not just operational efficiency. It is turning that efficiency into trust, credibility, and pipeline momentum.',
    '',
    'If you are refining your maritime growth strategy, this is the kind of narrative worth building into your next campaign.'
  ].join('\n');
}

function isMockModeEnabled() {
  return process.env.MOCK_OPENAI === 'true';
}

function isFallbackEnabled() {
  return process.env.OPENAI_FALLBACK_TO_MOCK !== 'false';
}

async function generateLinkedInPost(topic) {
  if (isMockModeEnabled()) {
    return {
      text: buildMockLinkedInPost(topic),
      source: 'mock'
    };
  }

  const client = getOpenAIClient();
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: buildLinkedInPrompt(topic)
    });

    const text = response.output_text && response.output_text.trim();

    if (!text) {
      throw new Error('OpenAI returned an empty marketing post.');
    }

    return {
      text,
      source: 'openai'
    };
  } catch (error) {
    if (!isFallbackEnabled()) {
      throw error;
    }

    logger.info('OpenAI unavailable, using mock marketing content instead', {
      reason: error.message
    });

    return {
      text: buildMockLinkedInPost(topic),
      source: 'mock-fallback'
    };
  }
}

function generateImagePrompt(topic, content) {
  return buildImagePrompt(topic, content);
}

async function saveMarketingPost(postData) {
  const [result] = await pool.query(
    `
      INSERT INTO marketing_posts (
        topic_id,
        platform,
        content,
        image_prompt,
        image_url,
        publish_status
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      postData.topicId,
      postData.platform,
      postData.content,
      postData.imagePrompt,
      postData.imageUrl,
      postData.publishStatus
    ]
  );

  return new MarketingPost({
    id: result.insertId,
    ...postData
  });
}

async function updatePostPublishStatus(postId, publishStatus) {
  await pool.query(
    `
      UPDATE marketing_posts
      SET publish_status = ?
      WHERE id = ?
    `,
    [publishStatus, postId]
  );
}

module.exports = {
  generateLinkedInPost,
  generateImagePrompt,
  saveMarketingPost,
  updatePostPublishStatus
};
