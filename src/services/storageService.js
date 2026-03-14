const fs = require('fs/promises');
const path = require('path');
const cloudinary = require('../config/cloudinary');

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function getStorageProvider() {
  return String(process.env.STORAGE_PROVIDER || 'cloudinary').toLowerCase();
}

function isCloudinaryUploadEnabled() {
  return process.env.CLOUDINARY_SIMULATE_UPLOAD === 'false';
}

function hasCloudinaryCredentials() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function getPreparedImagesDir() {
  return path.resolve(process.cwd(), 'prepared-images');
}

function buildLocalPreparedImageUrl(fileName) {
  const explicitUrl = process.env.APP_URL;
  const baseUrl = explicitUrl
    ? explicitUrl.replace(/\/$/, '')
    : `http://localhost:${Number(process.env.PORT) || 3000}`;

  return `${baseUrl}/prepared-images/${encodeURIComponent(fileName)}`;
}

function getR2PublicBaseUrl() {
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

  if (!publicBaseUrl) {
    throw new Error('R2 storage requires R2_PUBLIC_BASE_URL to be set to your public bucket domain or r2.dev URL.');
  }

  return publicBaseUrl;
}

function getR2Endpoint() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();

  if (!accountId) {
    throw new Error('R2 storage requires R2_ACCOUNT_ID.');
  }

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

async function createR2Client() {
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = String(process.env.R2_BUCKET_NAME || '').trim();

  if (!accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('R2 storage requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.');
  }

  let S3Client;
  let PutObjectCommand;

  try {
    ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
  } catch (error) {
    throw new Error('R2 support requires @aws-sdk/client-s3. Run npm install.');
  }

  return {
    bucketName,
    PutObjectCommand,
    client: new S3Client({
      region: 'auto',
      endpoint: getR2Endpoint(),
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })
  };
}

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });

    uploadStream.end(buffer);
  });
}

async function uploadToCloudinary({ key, buffer, filePath, tags }) {
  if (!hasCloudinaryCredentials()) {
    throw new Error('Cloudinary storage is enabled, but Cloudinary credentials are missing.');
  }

  const uploadOptions = {
    public_id: slugify(path.parse(key).name) || 'marketing-asset',
    resource_type: 'image',
    folder: path.posix.dirname(key),
    tags
  };

  const uploadResult = buffer
    ? await uploadBufferToCloudinary(buffer, uploadOptions)
    : await cloudinary.uploader.upload(filePath, uploadOptions);

  return {
    publicId: uploadResult.public_id,
    secureUrl: uploadResult.secure_url,
    simulated: false,
    provider: 'cloudinary'
  };
}

async function uploadToR2({ key, buffer, filePath, contentType }) {
  const { client, PutObjectCommand, bucketName } = await createR2Client();

  if (!buffer && filePath) {
    buffer = await fs.readFile(filePath);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream'
    })
  );

  return {
    publicId: key,
    secureUrl: `${getR2PublicBaseUrl()}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
    simulated: false,
    provider: 'r2'
  };
}

async function persistLocally({ fileName, buffer }) {
  const preparedImagesDir = getPreparedImagesDir();
  await fs.mkdir(preparedImagesDir, { recursive: true });
  await fs.writeFile(path.join(preparedImagesDir, fileName), buffer);

  return {
    publicId: `local/${fileName}`,
    secureUrl: buildLocalPreparedImageUrl(fileName),
    simulated: true,
    provider: 'local'
  };
}

async function uploadImage(options) {
  const provider = getStorageProvider();

  if (provider === 'r2') {
    return uploadToR2(options);
  }

  if (provider === 'cloudinary') {
    if (!isCloudinaryUploadEnabled()) {
      const fileName = path.basename(options.key);
      let { buffer } = options;
      if (!buffer && options.filePath) {
        buffer = await fs.readFile(options.filePath);
      }
      return persistLocally({ fileName, buffer });
    }

    return uploadToCloudinary(options);
  }

  if (provider === 'local') {
    const fileName = path.basename(options.key);
    let { buffer } = options;
    if (!buffer && options.filePath) {
      buffer = await fs.readFile(options.filePath);
    }
    return persistLocally({ fileName, buffer });
  }

  throw new Error(`Unsupported STORAGE_PROVIDER "${provider}".`);
}

module.exports = {
  getStorageProvider,
  uploadImage
};
