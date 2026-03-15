const LEGACY_PREPARED_POST_IMAGE_PREFIX = 'https://image.pollinations.ai/prompt';

function isLegacyPreparedPostPromptImageUrl(imageUrl) {
  const normalizedImageUrl = String(imageUrl || '').trim();

  if (!normalizedImageUrl) {
    return false;
  }

  return (
    normalizedImageUrl === LEGACY_PREPARED_POST_IMAGE_PREFIX ||
    normalizedImageUrl.startsWith(`${LEGACY_PREPARED_POST_IMAGE_PREFIX}/`)
  );
}

function resolvePreparedPostImageUrl(postData) {
  return String(postData && postData.imageUrl ? postData.imageUrl : '').trim();
}

function ensurePreparedPostHasManagedImage(imageUrl, contextLabel = 'Prepared post') {
  const normalizedImageUrl = String(imageUrl || '').trim();

  if (!normalizedImageUrl) {
    throw new Error(`${contextLabel} requires an uploaded public image. Attach a PNG, JPEG, WEBP, or GIF before saving.`);
  }

  if (isLegacyPreparedPostPromptImageUrl(normalizedImageUrl)) {
    throw new Error(`${contextLabel} is using a legacy Pollinations image URL. Replace it with an uploaded image before saving.`);
  }

  return normalizedImageUrl;
}

module.exports = {
  ensurePreparedPostHasManagedImage,
  isLegacyPreparedPostPromptImageUrl,
  resolvePreparedPostImageUrl
};
