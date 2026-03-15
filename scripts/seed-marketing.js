#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const mysql = require('mysql2/promise');

let FormData;

try {
  FormData = require('form-data');
} catch (error) {
  throw new Error('Missing dependency "form-data". Install it with "npm install form-data" before running this script.');
}

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_SEED_DIR = path.join(ROOT_DIR, 'marketing-seed');
const POSTS_FILE = path.join(DEFAULT_SEED_DIR, 'posts.json');
const IMAGES_DIR = path.join(DEFAULT_SEED_DIR, 'images');

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getDbConfig() {
  return {
    host: getRequiredEnv('DB_HOST'),
    user: getRequiredEnv('DB_USER'),
    password: getRequiredEnv('DB_PASS'),
    database: getRequiredEnv('DB_NAME'),
    port: Number(process.env.DB_PORT || 3306)
  };
}

function getCloudinaryConfig() {
  return {
    cloudName: getRequiredEnv('CLOUDINARY_CLOUD_NAME'),
    uploadPreset: getRequiredEnv('CLOUDINARY_UPLOAD_PRESET')
  };
}

function getCloudinaryUploadUrl(cloudName) {
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
}

function resolveImagePath(imageName) {
  const normalizedImageName = String(imageName || '').trim();

  if (!normalizedImageName) {
    throw new Error('Post is missing "image".');
  }

  const imagePath = path.resolve(IMAGES_DIR, normalizedImageName);

  if (!imagePath.startsWith(IMAGES_DIR)) {
    throw new Error(`Image path "${normalizedImageName}" must stay inside ${IMAGES_DIR}`);
  }

  return imagePath;
}

async function loadPosts() {
  const raw = await fsp.readFile(POSTS_FILE, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${POSTS_FILE} must contain a JSON array.`);
  }

  return parsed;
}

function normalizePost(post, index) {
  if (!post || typeof post !== 'object' || Array.isArray(post)) {
    throw new Error(`Post ${index + 1} must be an object.`);
  }

  const normalized = {
    text: String(post.text || '').trim(),
    image: String(post.image || '').trim(),
    type: String(post.type || '').trim(),
    cta: String(post.cta || '').trim()
  };

  if (!normalized.text) {
    throw new Error(`Post ${index + 1} is missing "text".`);
  }

  if (!normalized.image) {
    throw new Error(`Post ${index + 1} is missing "image".`);
  }

  return normalized;
}

function getAxiosErrorMessage(error) {
  if (error.response && error.response.data) {
    const data = error.response.data;

    if (typeof data === 'string' && data.trim()) {
      return data.trim();
    }

    if (data.error && data.error.message) {
      return String(data.error.message);
    }
  }

  return error.message;
}

async function uploadImageToCloudinary(imagePath, cloudinaryConfig) {
  const form = new FormData();

  form.append('file', fs.createReadStream(imagePath));
  form.append('upload_preset', cloudinaryConfig.uploadPreset);

  const response = await axios.post(getCloudinaryUploadUrl(cloudinaryConfig.cloudName), form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120000
  });

  if (!response.data || !response.data.secure_url) {
    throw new Error(`Cloudinary upload did not return secure_url for ${path.basename(imagePath)}`);
  }

  return response.data.secure_url;
}

async function insertPreparedPost(connection, post, imageUrl) {
  await connection.execute(
    `
      INSERT INTO prepared_posts (
        text,
        image_url,
        type,
        cta
      )
      VALUES (?, ?, ?, ?)
    `,
    [
      post.text,
      imageUrl,
      post.type || null,
      post.cta || null
    ]
  );
}

async function ensureSeedFilesExist() {
  await fsp.access(POSTS_FILE);
  await fsp.access(IMAGES_DIR);
}

async function main() {
  const cloudinaryConfig = getCloudinaryConfig();
  const dbConfig = getDbConfig();

  await ensureSeedFilesExist();

  const posts = await loadPosts();

  if (posts.length === 0) {
    console.log('No posts found in posts.json');
    return;
  }

  const connection = await mysql.createConnection(dbConfig);
  let insertedCount = 0;
  let failedCount = 0;

  console.log(`Seed source: ${POSTS_FILE}`);
  console.log(`Images dir: ${IMAGES_DIR}`);
  console.log(`Posts to process: ${posts.length}`);

  try {
    for (const [index, rawPost] of posts.entries()) {
      let post;

      try {
        post = normalizePost(rawPost, index);
        const imagePath = resolveImagePath(post.image);

        await fsp.access(imagePath);

        console.log(`[${index + 1}/${posts.length}] Uploading image ${post.image}`);
        const imageUrl = await uploadImageToCloudinary(imagePath, cloudinaryConfig);

        await insertPreparedPost(connection, post, imageUrl);
        insertedCount += 1;
        console.log(`[${index + 1}/${posts.length}] Inserted post OK`);
      } catch (error) {
        failedCount += 1;
        console.error(
          `[${index + 1}/${posts.length}] Failed post ${index + 1}${post && post.image ? ` (${post.image})` : ''}: ${getAxiosErrorMessage(error)}`
        );
      }
    }
  } finally {
    await connection.end();
  }

  console.log(`Final summary count: inserted=${insertedCount}, failed=${failedCount}, total=${posts.length}`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Seeder failed: ${getAxiosErrorMessage(error)}`);
  process.exit(1);
});
