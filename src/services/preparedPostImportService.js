const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const preparedPostService = require('./preparedPostService');
const { uploadPreparedImage } = require('./imageService');
const socialConfig = require('../config/social');
const { buildPreparedPostImageUrl } = require('./preparedPostImageService');

const preparedPostsDir = path.resolve(process.cwd(), 'prepared-posts');
const preparedImagesDir = path.resolve(process.cwd(), 'prepared-images');
const defaultManifestPath = path.join(preparedPostsDir, 'queue.json');

function resolvePreparedImagePath(imageFile) {
  const imagePath = path.resolve(preparedImagesDir, imageFile);

  if (!imagePath.startsWith(preparedImagesDir)) {
    throw new Error(`Image file "${imageFile}" must stay inside prepared-images/.`);
  }

  return imagePath;
}

function sanitizeFileSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'prepared-post';
}

function parseImageDataUrl(imageDataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(imageDataUrl || ''));

  if (!match) {
    throw new Error('Invalid image payload. Expected a base64 data URL.');
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64')
  };
}

function getImageExtension(imageName, mimeType) {
  const providedExtension = path.extname(imageName || '').toLowerCase();
  if (providedExtension) {
    return providedExtension;
  }

  if (mimeType === 'image/png') {
    return '.png';
  }

  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }

  if (mimeType === 'image/webp') {
    return '.webp';
  }

  if (mimeType === 'image/gif') {
    return '.gif';
  }

  throw new Error(`Unsupported image type "${mimeType}".`);
}

async function ensurePreparedDirectories() {
  await fs.mkdir(preparedPostsDir, { recursive: true });
  await fs.mkdir(preparedImagesDir, { recursive: true });
}

function buildImportKey(entry, platform, imageFile) {
  if (entry.importKey) {
    return `${entry.importKey}:${platform}`;
  }

  const imageBaseName = path.parse(imageFile).name.toLowerCase();
  return `${entry.scheduledOrder}:${platform}:${imageBaseName}`;
}

function normalizePlatforms(entry) {
  const sourcePlatforms = Array.isArray(entry.platforms)
    ? entry.platforms
    : [entry.platform || entry.defaultPlatform].filter(Boolean);

  if (sourcePlatforms.length === 0) {
    throw new Error('Each prepared post must define "platform" or "platforms".');
  }

  return sourcePlatforms.map((platform) => String(platform).toLowerCase());
}

async function readManifest(manifestPath = defaultManifestPath) {
  const rawManifest = await fs.readFile(manifestPath, 'utf8');
  const parsedManifest = JSON.parse(rawManifest);

  if (!Array.isArray(parsedManifest)) {
    throw new Error('prepared-posts/queue.json must contain a JSON array.');
  }

  return parsedManifest;
}

async function importPreparedPostsFromManifest(options = {}) {
  await ensurePreparedDirectories();

  const manifestPath = path.resolve(options.manifestPath || defaultManifestPath);
  const manifestEntries = await readManifest(manifestPath);

  let importedCount = 0;

  for (const [index, entry] of manifestEntries.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Manifest entry ${index + 1} must be an object.`);
    }

    const text = String(entry.text || '').trim();
    const imageFile = String(entry.imageFile || '').trim();
    const scheduledOrder = Number(entry.scheduledOrder);

    if (!text) {
      throw new Error(`Manifest entry ${index + 1} is missing "text".`);
    }

    if (!Number.isInteger(scheduledOrder) || scheduledOrder < 1) {
      throw new Error(`Manifest entry ${index + 1} has an invalid "scheduledOrder".`);
    }

    let imageUrl = '';

    if (imageFile) {
      const imagePath = resolvePreparedImagePath(imageFile);
      await fs.access(imagePath);
      const imageAsset = await uploadPreparedImage({
        fileName: imageFile,
        filePath: imagePath
      });
      imageUrl = imageAsset.secureUrl;
    } else {
      imageUrl = buildPreparedPostImageUrl(text);
    }

    const platforms = normalizePlatforms(entry);

    for (const platform of platforms) {
      if (!socialConfig.supportedPlatforms.includes(platform)) {
        throw new Error(`Unsupported platform "${platform}" in manifest entry ${index + 1}.`);
      }

      await preparedPostService.upsertPreparedPost({
        importKey: buildImportKey(entry, platform, imageFile),
        text,
        imageUrl,
        platform,
        scheduledOrder,
        status: entry.status || 'pending',
        campaignTag: entry.campaignTag || null,
        postType: entry.postType || null
      });

      importedCount += 1;
    }
  }

  return {
    importedCount,
    manifestPath
  };
}

async function createPreparedPostsFromBrowser(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('No prepared posts were provided.');
  }

  await ensurePreparedDirectories();

  let importedCount = 0;

  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Upload entry ${index + 1} must be an object.`);
    }

    const text = String(entry.text || '').trim();
    const scheduledOrder = Number(entry.scheduledOrder);

    if (!text) {
      throw new Error(`Upload entry ${index + 1} is missing "text".`);
    }

    if (!Number.isInteger(scheduledOrder) || scheduledOrder < 1) {
      throw new Error(`Upload entry ${index + 1} has an invalid "scheduledOrder".`);
    }

    const platforms = normalizePlatforms(entry);
    const imageName = String(entry.imageName || '').trim();
    const fileBaseName = sanitizeFileSegment(entry.importKey || path.parse(imageName || 'prepared-post').name);
    let imageUrl = '';

    if (entry.imageDataUrl) {
      if (!imageName) {
        throw new Error(`Upload entry ${index + 1} is missing "imageName".`);
      }

      const { mimeType, buffer } = parseImageDataUrl(entry.imageDataUrl);
      const extension = getImageExtension(imageName, mimeType);
      const fileName = `${scheduledOrder}-${fileBaseName}-${crypto.randomBytes(4).toString('hex')}${extension}`;
      const imageAsset = await uploadPreparedImage({
        fileName,
        buffer
      });

      imageUrl = imageAsset.secureUrl;
    } else {
      imageUrl = buildPreparedPostImageUrl(text);
    }

    for (const platform of platforms) {
      if (!socialConfig.supportedPlatforms.includes(platform)) {
        throw new Error(`Unsupported platform "${platform}" in upload entry ${index + 1}.`);
      }

      await preparedPostService.upsertPreparedPost({
        importKey: buildImportKey(
          {
            importKey: entry.importKey || fileBaseName,
            scheduledOrder
          },
          platform,
          imageName || fileBaseName
        ),
        text,
        imageUrl,
        platform,
        scheduledOrder,
        status: entry.status || 'pending',
        campaignTag: entry.campaignTag || null,
        postType: entry.postType || null
      });

      importedCount += 1;
    }
  }

  return {
    importedCount
  };
}

async function updatePreparedPostGroupFromBrowser(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('No prepared post update payload was provided.');
  }

  const importKeyBase = String(entry.importKey || '').trim();
  const text = String(entry.text || '').trim();
  const scheduledOrder = Number(entry.scheduledOrder);

  if (!importKeyBase) {
    throw new Error('Prepared post update is missing "importKey".');
  }

  if (!text) {
    throw new Error('Prepared post update is missing "text".');
  }

  if (!Number.isInteger(scheduledOrder) || scheduledOrder < 1) {
    throw new Error('Prepared post update has an invalid "scheduledOrder".');
  }

  const platforms = normalizePlatforms(entry);
  const existingImageUrl = String(entry.existingImageUrl || '').trim();
  let imageUrl = existingImageUrl;

  if (entry.imageDataUrl) {
    const imageName = String(entry.imageName || '').trim();

    if (!imageName) {
      throw new Error('Prepared post update is missing "imageName".');
    }

    const { mimeType, buffer } = parseImageDataUrl(entry.imageDataUrl);
    const extension = getImageExtension(imageName, mimeType);
    const fileBaseName = sanitizeFileSegment(importKeyBase || path.parse(imageName).name);
    const fileName = `${scheduledOrder}-${fileBaseName}-${crypto.randomBytes(4).toString('hex')}${extension}`;
    const imageAsset = await uploadPreparedImage({
      fileName,
      buffer
    });

    imageUrl = imageAsset.secureUrl;
  }

  if (!imageUrl) {
    imageUrl = buildPreparedPostImageUrl(text);
  }

  return preparedPostService.updatePendingPreparedPostGroup({
    importKeyBase,
    text,
    imageUrl,
    platforms,
    scheduledOrder,
    campaignTag: entry.campaignTag || null,
    postType: entry.postType || null
  });
}

module.exports = {
  createPreparedPostsFromBrowser,
  defaultManifestPath,
  importPreparedPostsFromManifest,
  updatePreparedPostGroupFromBrowser,
  preparedImagesDir,
  preparedPostsDir
};
