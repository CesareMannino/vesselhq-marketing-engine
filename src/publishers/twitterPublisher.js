const axios = require('axios');
const crypto = require('crypto');

const X_API_BASE_URL = String(process.env.X_API_BASE_URL || 'https://api.x.com').replace(/\/$/, '');
const X_MEDIA_CATEGORY = 'tweet_image';
const MAX_IMAGE_STATUS_POLLS = 10;
const IMAGE_STATUS_POLL_FALLBACK_MS = 2000;

function getEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();

    if (value) {
      return value;
    }
  }

  return '';
}

function getCredentials() {
  const userAccessToken = getEnv('X_USER_ACCESS_TOKEN');

  if (userAccessToken) {
    return {
      authType: 'bearer',
      userAccessToken
    };
  }

  const consumerKey = getEnv('X_API_KEY', 'TWITTER_API_KEY');
  const consumerSecret = getEnv('X_API_SECRET', 'X_API_KEY_SECRET', 'TWITTER_API_SECRET', 'TWITTER_API_KEY_SECRET');
  const accessToken = getEnv('X_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN');
  const accessTokenSecret = getEnv('X_ACCESS_TOKEN_SECRET', 'TWITTER_ACCESS_TOKEN_SECRET');

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      'X publishing requires either X_USER_ACCESS_TOKEN or X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, and X_ACCESS_TOKEN_SECRET.'
    );
  }

  return {
    authType: 'oauth1',
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret
  };
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeParams(params) {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const values = Array.isArray(params[key]) ? params[key] : [params[key]];

      return values
        .map((value) => [percentEncode(key), percentEncode(value)])
        .sort((left, right) => left[1].localeCompare(right[1]));
    })
    .flat()
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function buildOAuthHeader({ method, url, credentials, params = {} }) {
  const oauthParams = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0'
  };

  const signatureBaseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(normalizeParams({ ...params, ...oauthParams }))
  ].join('&');

  oauthParams.oauth_signature = crypto
    .createHmac(
      'sha1',
      `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.accessTokenSecret)}`
    )
    .update(signatureBaseString)
    .digest('base64');

  return `OAuth ${Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ')}`;
}

async function xRequest({ method, path, body, params, headers }) {
  const url = `${X_API_BASE_URL}${path}`;
  const credentials = getCredentials();
  const authorizationHeader =
    credentials.authType === 'bearer'
      ? `Bearer ${credentials.userAccessToken}`
      : buildOAuthHeader({
          method,
          url,
          credentials,
          params
        });

  try {
    const response = await axios({
      method,
      url,
      params,
      data: body,
      headers: {
        Authorization: authorizationHeader,
        ...headers
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status >= 400) {
      const apiErrors = response.data && response.data.errors ? response.data.errors : [];
      const firstError = apiErrors[0] || {};
      const detail =
        firstError.detail ||
        firstError.message ||
        (response.data && response.data.title) ||
        `X API request failed with status ${response.status}.`;

      throw new Error(detail);
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      const apiErrors = error.response.data && error.response.data.errors ? error.response.data.errors : [];
      const firstError = apiErrors[0] || {};
      const detail =
        firstError.detail ||
        firstError.message ||
        (error.response.data && error.response.data.title) ||
        error.message;

      throw new Error(detail);
    }

    throw error;
  }
}

async function downloadImageAsBase64(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  });

  const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (!contentType.startsWith('image/')) {
    throw new Error(`X image upload requires an image URL. Received content-type "${contentType || 'unknown'}".`);
  }

  return {
    mediaType: contentType,
    mediaData: Buffer.from(response.data).toString('base64')
  };
}

async function waitForMediaProcessing(mediaId) {
  for (let attempt = 0; attempt < MAX_IMAGE_STATUS_POLLS; attempt += 1) {
    const payload = await xRequest({
      method: 'GET',
      path: '/2/media/upload',
      params: {
        command: 'STATUS',
        media_id: mediaId
      }
    });

    const processingInfo =
      (payload.data && payload.data.processing_info) ||
      payload.processing_info ||
      null;

    if (!processingInfo || processingInfo.state === 'succeeded') {
      return;
    }

    if (processingInfo.state === 'failed') {
      const reason =
        processingInfo.error && processingInfo.error.message
          ? processingInfo.error.message
          : 'X media processing failed.';

      throw new Error(reason);
    }

    const waitSeconds = Number(processingInfo.check_after_secs) || IMAGE_STATUS_POLL_FALLBACK_MS / 1000;

    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }

  throw new Error('X media processing timed out.');
}

async function uploadMedia(imageUrl) {
  const { mediaType, mediaData } = await downloadImageAsBase64(imageUrl);

  const payload = await xRequest({
    method: 'POST',
    path: '/2/media/upload',
    body: {
      media: mediaData,
      media_category: X_MEDIA_CATEGORY,
      media_type: mediaType
    },
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const mediaId =
    (payload.data && (payload.data.id || payload.data.media_id || payload.data.media_id_string)) ||
    payload.media_id ||
    payload.media_id_string ||
    '';

  if (!mediaId) {
    throw new Error('X media upload did not return a media id.');
  }

  await waitForMediaProcessing(mediaId);

  return mediaId;
}

async function createTweet(post, mediaId) {
  if (!String(post.content || '').trim()) {
    throw new Error('X publishing requires post.content.');
  }

  const body = {
    text: post.content
  };

  if (mediaId) {
    body.media = {
      media_ids: [mediaId]
    };
  }

  const payload = await xRequest({
    method: 'POST',
    path: '/2/tweets',
    body,
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const tweetId = payload.data && payload.data.id ? payload.data.id : '';

  if (!tweetId) {
    throw new Error('X create post request did not return a tweet id.');
  }

  return tweetId;
}

async function publish(post) {
  const mediaId = post.imageUrl ? await uploadMedia(post.imageUrl) : null;
  const remotePostId = await createTweet(post, mediaId);

  return {
    platform: 'twitter',
    status: 'published',
    postId: post.id,
    remotePostId,
    mediaId
  };
}

module.exports = {
  publish
};
