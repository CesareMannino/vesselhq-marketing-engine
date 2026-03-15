const axios = require('axios');

const LINKEDIN_API_BASE_URL = String(process.env.LINKEDIN_API_BASE_URL || 'https://api.linkedin.com').replace(
  /\/$/,
  ''
);
const LINKEDIN_API_VERSION = String(process.env.LINKEDIN_API_VERSION || '202601').trim();
const LINKEDIN_POST_VISIBILITY = String(process.env.LINKEDIN_POST_VISIBILITY || 'PUBLIC').trim().toUpperCase();
const LINKEDIN_IMAGE_READY_RETRY_ATTEMPTS = Number(process.env.LINKEDIN_IMAGE_READY_RETRY_ATTEMPTS || 8);
const LINKEDIN_IMAGE_READY_RETRY_DELAY_MS = Number(process.env.LINKEDIN_IMAGE_READY_RETRY_DELAY_MS || 2000);

function getEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();

    if (value) {
      return value;
    }
  }

  return '';
}

function buildUrn(prefix, value) {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.startsWith('urn:li:')) {
    return normalizedValue;
  }

  return `urn:li:${prefix}:${normalizedValue}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCredentials() {
  const accessToken = getEnv('LINKEDIN_ACCESS_TOKEN');
  const authorUrn =
    getEnv('LINKEDIN_AUTHOR_URN') ||
    buildUrn('organization', getEnv('LINKEDIN_ORGANIZATION_ID')) ||
    buildUrn('person', getEnv('LINKEDIN_PERSON_ID', 'LINKEDIN_MEMBER_ID'));

  if (!accessToken || !authorUrn) {
    throw new Error(
      'LinkedIn publishing requires LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN (or LINKEDIN_ORGANIZATION_ID / LINKEDIN_PERSON_ID).'
    );
  }

  return {
    accessToken,
    authorUrn,
    imageOwnerUrn: getEnv('LINKEDIN_IMAGE_OWNER_URN') || authorUrn
  };
}

function buildLinkedInHeaders(accessToken, headers = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...headers
  };
}

function extractLinkedInErrorMessage(data, status) {
  const firstError = Array.isArray(data && data.errors) ? data.errors[0] : null;
  const errorDetails =
    data && data.errorDetails
      ? typeof data.errorDetails === 'string'
        ? data.errorDetails
        : JSON.stringify(data.errorDetails)
      : '';

  if (firstError) {
    const baseMessage =
      firstError.message ||
      firstError.errorDetails ||
      firstError.errorDetailType ||
      `LinkedIn API request failed with status ${status}.`;

    return errorDetails ? `${baseMessage} Details: ${errorDetails}` : baseMessage;
  }

  const baseMessage =
    (data && (data.message || data.error_description || data.description)) ||
    `LinkedIn API request failed with status ${status}.`;

  return errorDetails ? `${baseMessage} Details: ${errorDetails}` : baseMessage;
}

async function linkedinRequest({ method, path, accessToken, params, body, headers }) {
  try {
    const response = await axios({
      method,
      url: `${LINKEDIN_API_BASE_URL}${path}`,
      params,
      data: body,
      headers: buildLinkedInHeaders(accessToken, headers),
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status >= 400) {
      throw new Error(extractLinkedInErrorMessage(response.data, response.status));
    }

    return response;
  } catch (error) {
    if (error.response) {
      throw new Error(extractLinkedInErrorMessage(error.response.data, error.response.status));
    }

    throw error;
  }
}

async function downloadImage(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  const contentType = String(response.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!contentType.startsWith('image/')) {
    throw new Error(`LinkedIn image upload requires an image URL. Received content-type "${contentType || 'unknown'}".`);
  }

  return {
    buffer: Buffer.from(response.data),
    contentType
  };
}

async function initializeImageUpload(credentials) {
  const response = await linkedinRequest({
    method: 'POST',
    path: '/rest/images',
    accessToken: credentials.accessToken,
    params: {
      action: 'initializeUpload'
    },
    body: {
      initializeUploadRequest: {
        owner: credentials.imageOwnerUrn
      }
    },
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const uploadData = response.data && response.data.value ? response.data.value : null;
  const uploadUrl = uploadData && uploadData.uploadUrl ? uploadData.uploadUrl : '';
  const imageUrn = uploadData && uploadData.image ? uploadData.image : '';

  if (!uploadUrl || !imageUrn) {
    throw new Error('LinkedIn image initialization did not return an upload URL and image URN.');
  }

  return {
    uploadUrl,
    imageUrn
  };
}

async function uploadImageToLinkedIn(uploadUrl, imageAsset, accessToken) {
  const response = await axios.put(uploadUrl, imageAsset.buffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': imageAsset.contentType,
      'Content-Length': imageAsset.buffer.length
    },
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(extractLinkedInErrorMessage(response.data, response.status));
  }
}

async function getImageStatus(imageUrn, credentials) {
  const response = await linkedinRequest({
    method: 'GET',
    path: `/rest/images/${encodeURIComponent(imageUrn)}`,
    accessToken: credentials.accessToken
  });

  return String(response.data && response.data.status ? response.data.status : '').trim().toUpperCase();
}

function shouldRetryImagePost(error) {
  const message = String(error.message || '').toLowerCase();

  return (
    message.includes('processing') ||
    message.includes('not ready') ||
    message.includes('media') ||
    message.includes('image') ||
    message.includes('upload') ||
    message.includes('invalid param')
  );
}

async function waitForImageAvailability(imageUrn, credentials) {
  for (let attempt = 0; attempt < LINKEDIN_IMAGE_READY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const status = await getImageStatus(imageUrn, credentials);

      if (!status || status === 'AVAILABLE') {
        return;
      }

      if (status === 'PROCESSING_FAILED') {
        throw new Error('LinkedIn image processing failed.');
      }

      if (status !== 'WAITING_UPLOAD' && status !== 'PROCESSING') {
        return;
      }
    } catch (error) {
      const message = String(error.message || '').toLowerCase();

      if (message.includes('forbidden') || message.includes('not enough permissions')) {
        return;
      }

      if (attempt === LINKEDIN_IMAGE_READY_RETRY_ATTEMPTS - 1) {
        throw error;
      }
    }

    await sleep(LINKEDIN_IMAGE_READY_RETRY_DELAY_MS * (attempt + 1));
  }
}

function buildPostBody(post, authorUrn, imageUrn) {
  const body = {
    author: authorUrn,
    commentary: String(post.content || '').trim(),
    visibility: LINKEDIN_POST_VISIBILITY,
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: []
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false
  };

  if (imageUrn) {
    body.content = {
      media: {
        id: imageUrn
      }
    };
  }

  return body;
}

async function createLinkedInPost(post, credentials, imageUrn) {
  const response = await linkedinRequest({
    method: 'POST',
    path: '/rest/posts',
    accessToken: credentials.accessToken,
    body: buildPostBody(post, credentials.authorUrn, imageUrn),
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const remotePostId =
    response.headers['x-restli-id'] ||
    (response.data && (response.data.id || response.data.post || response.data.activity)) ||
    '';

  if (!remotePostId) {
    throw new Error('LinkedIn create post request did not return a post id.');
  }

  return remotePostId;
}

async function createLinkedInImagePost(post, credentials, imageUrn) {
  let lastError;

  for (let attempt = 0; attempt < LINKEDIN_IMAGE_READY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await createLinkedInPost(post, credentials, imageUrn);
    } catch (error) {
      lastError = error;

      if (!shouldRetryImagePost(error) || attempt === LINKEDIN_IMAGE_READY_RETRY_ATTEMPTS - 1) {
        throw error;
      }

      await sleep(LINKEDIN_IMAGE_READY_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error('LinkedIn image post publish failed.');
}

async function publish(post) {
  const credentials = getCredentials();

  if (!String(post.content || '').trim()) {
    throw new Error('LinkedIn publishing requires post.content.');
  }

  if (!post.imageUrl) {
    const remotePostId = await createLinkedInPost(post, credentials, null);

    return {
      platform: 'linkedin',
      status: 'published',
      postId: post.id,
      remotePostId
    };
  }

  const imageAsset = await downloadImage(post.imageUrl);
  const upload = await initializeImageUpload(credentials);

  await uploadImageToLinkedIn(upload.uploadUrl, imageAsset, credentials.accessToken);
  await waitForImageAvailability(upload.imageUrn, credentials);

  const remotePostId = await createLinkedInImagePost(post, credentials, upload.imageUrn);

  return {
    platform: 'linkedin',
    status: 'published',
    postId: post.id,
    remotePostId,
    mediaId: upload.imageUrn
  };
}

module.exports = {
  publish
};
