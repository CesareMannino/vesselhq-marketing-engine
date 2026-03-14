const path = require('path');
const { uploadImage } = require('./storageService');

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createPlaceholderSvg(topic, prompt) {
  const title = escapeXml(topic.title).slice(0, 70);
  const subtitle = escapeXml(prompt).slice(0, 120);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
      <defs>
        <linearGradient id="sea" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#0f4c5c" />
          <stop offset="100%" stop-color="#1f7a8c" />
        </linearGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#sea)" />
      <text x="80" y="220" fill="#ffffff" font-size="54" font-family="Arial, sans-serif" font-weight="700">
        ${title}
      </text>
      <text x="80" y="320" fill="#d8f3dc" font-size="28" font-family="Arial, sans-serif">
        ${subtitle}
      </text>
      <text x="80" y="580" fill="#ffffff" font-size="24" font-family="Arial, sans-serif">
        vesselhq-marketing-engine simulated creative
      </text>
    </svg>
  `.trim();
}

async function uploadPreparedImage({ fileName, buffer, filePath }) {
  const key = `vesselhq-marketing-engine/prepared/${Date.now()}-${slugify(path.parse(fileName).name) || 'prepared-post'}${path.extname(fileName).toLowerCase()}`;

  return uploadImage({
    key,
    buffer,
    filePath,
    contentType: getContentTypeFromExtension(fileName),
    tags: ['marketing', 'prepared']
  });
}

async function createMarketingImage(topic, imagePrompt) {
  return uploadImage({
    key: `vesselhq-marketing-engine/marketing/${Date.now()}-${slugify(topic.title) || 'maritime-topic'}.svg`,
    buffer: Buffer.from(createPlaceholderSvg(topic, imagePrompt)),
    contentType: 'image/svg+xml',
    tags: ['marketing', 'maritime']
  });
}

function getContentTypeFromExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  if (extension === '.gif') {
    return 'image/gif';
  }

  if (extension === '.svg') {
    return 'image/svg+xml';
  }

  return 'application/octet-stream';
}

module.exports = {
  createMarketingImage,
  uploadPreparedImage
};
