const axios = require('axios');

const FACEBOOK_GRAPH_API_BASE_URL = String(
  process.env.FACEBOOK_GRAPH_API_BASE_URL || 'https://graph.facebook.com'
).replace(/\/$/, '');
const FACEBOOK_GRAPH_API_VERSION = String(process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0').trim();

function getCredentials() {
  const pageId = String(process.env.FACEBOOK_PAGE_ID || '').trim();
  const pageAccessToken = String(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();

  if (!pageId || !pageAccessToken) {
    throw new Error('Facebook publishing requires FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN.');
  }

  return {
    pageId,
    pageAccessToken
  };
}

function buildUrl(path) {
  return `${FACEBOOK_GRAPH_API_BASE_URL}/${FACEBOOK_GRAPH_API_VERSION}${path}`;
}

function buildFormBody(payload) {
  const body = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      body.append(key, String(value));
    }
  });

  return body;
}

function getAssetLabel(imageUrl) {
  try {
    const parsedUrl = new URL(String(imageUrl || '').trim());
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch (error) {
    return String(imageUrl || '').trim() || 'unknown image URL';
  }
}

async function validatePhotoAsset(imageUrl) {
  try {
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
      throw new Error(
        `Facebook photo publish requires a public image URL. Received content-type "${contentType || 'unknown'}".`
      );
    }

    if (contentType === 'image/svg+xml') {
      throw new Error('Facebook photo publish requires a raster image. SVG assets are not supported; use PNG or JPEG.');
    }
  } catch (error) {
    if (error.response) {
      const contentType = String(error.response.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();

      throw new Error(
        `Unable to fetch the Facebook image asset from ${getAssetLabel(imageUrl)}. Remote server responded with status ${error.response.status}${contentType ? ` and content-type "${contentType}"` : ''}.`
      );
    }

    if (error.request) {
      throw new Error(`Unable to fetch the Facebook image asset from ${getAssetLabel(imageUrl)}. No response was returned.`);
    }

    throw error;
  }
}

function parseFacebookError(error) {
  if (error.response && error.response.data && error.response.data.error) {
    const apiError = error.response.data.error;
    const message = (
      apiError.error_user_msg ||
      apiError.error_user_title ||
      apiError.message ||
      error.message
    );

    const normalizedMessage = String(message || '').toLowerCase();

    if (normalizedMessage.includes('publish_actions')) {
      return 'Meta rejected the request because `publish_actions` was deprecated. Use a Facebook Page access token with `pages_manage_posts` for Page publishing, or use Meta Sharing products when the goal is user sharing.';
    }

    if (
      normalizedMessage.includes('includa un\'immagine utilizzabile in un\'inserzione') ||
      normalizedMessage.includes('include an image usable in an ad')
    ) {
      return `${message} Verify that image_url is public and resolves directly to a raster image such as PNG or JPEG. SVG assets are not supported.`;
    }

    if (apiError.code === 200 && normalizedMessage.includes('permission')) {
      return `${message} Facebook publishing in this service requires a Page access token for the target Page plus Page publishing permission such as \`pages_manage_posts\`.`;
    }

    return message;
  }

  return error.message;
}

async function graphRequest(path, payload) {
  try {
    const response = await axios.post(buildUrl(path), buildFormBody(payload), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    throw new Error(parseFacebookError(error));
  }
}

async function createFeedPost(post, credentials) {
  const payload = await graphRequest(`/${credentials.pageId}/feed`, {
    message: post.content,
    access_token: credentials.pageAccessToken
  });

  const remotePostId = payload.id || '';

  if (!remotePostId) {
    throw new Error('Facebook feed publish did not return a post id.');
  }

  return {
    remotePostId
  };
}

async function createPhotoPost(post, credentials) {
  await validatePhotoAsset(post.imageUrl);

  const payload = await graphRequest(`/${credentials.pageId}/photos`, {
    url: post.imageUrl,
    caption: post.content,
    access_token: credentials.pageAccessToken
  });

  const remotePostId = payload.post_id || payload.id || '';
  const mediaId = payload.id || '';

  if (!remotePostId && !mediaId) {
    throw new Error('Facebook photo publish did not return a post id.');
  }

  return {
    remotePostId: remotePostId || mediaId,
    mediaId
  };
}

async function publish(post) {
  const credentials = getCredentials();

  if (!String(post.content || '').trim()) {
    throw new Error('Facebook publishing requires post.content.');
  }

  const result = post.imageUrl
    ? await createPhotoPost(post, credentials)
    : await createFeedPost(post, credentials);

  return {
    platform: 'facebook',
    status: 'published',
    postId: post.id,
    remotePostId: result.remotePostId,
    mediaId: result.mediaId || null
  };
}

module.exports = {
  publish
};
