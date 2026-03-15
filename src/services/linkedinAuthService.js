const axios = require('axios');
const crypto = require('crypto');

const LINKEDIN_OAUTH_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_OAUTH_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const STATE_TTL_MS = 15 * 60 * 1000;
const stateStore = new Map();

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`LinkedIn OAuth requires ${name}.`);
  }

  return value;
}

function getAppUrl() {
  return getRequiredEnv('APP_URL').replace(/\/$/, '');
}

function getRedirectUri() {
  return `${getAppUrl()}/linkedin/callback`;
}

function getOAuthConfig() {
  return {
    clientId: getRequiredEnv('LINKEDIN_CLIENT_ID'),
    clientSecret: getRequiredEnv('LINKEDIN_CLIENT_SECRET'),
    redirectUri: getRedirectUri(),
    scopes: String(process.env.LINKEDIN_OAUTH_SCOPES || 'openid profile email w_member_social')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  };
}

function cleanupExpiredStates() {
  const now = Date.now();

  for (const [state, payload] of stateStore.entries()) {
    if (payload.expiresAt <= now) {
      stateStore.delete(state);
    }
  }
}

function createStatePayload(query = {}) {
  cleanupExpiredStates();

  const state = crypto.randomBytes(24).toString('hex');
  const payload = {
    state,
    mode: String(query.mode || 'member').trim().toLowerCase(),
    organizationId: String(query.organizationId || query.orgId || '').trim(),
    expiresAt: Date.now() + STATE_TTL_MS
  };

  stateStore.set(state, payload);

  return payload;
}

function consumeState(state) {
  cleanupExpiredStates();

  const payload = stateStore.get(state);
  stateStore.delete(state);

  if (!payload || payload.expiresAt <= Date.now()) {
    throw new Error('LinkedIn OAuth state is missing or expired. Start again from /linkedin/connect.');
  }

  return payload;
}

function buildAuthorizationUrl(query = {}) {
  const oauthConfig = getOAuthConfig();
  const statePayload = createStatePayload(query);
  const url = new URL(LINKEDIN_OAUTH_AUTHORIZE_URL);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
  url.searchParams.set('state', statePayload.state);
  url.searchParams.set('scope', oauthConfig.scopes.join(' '));

  return {
    authorizationUrl: url.toString(),
    statePayload,
    redirectUri: oauthConfig.redirectUri,
    scopes: oauthConfig.scopes
  };
}

async function exchangeCodeForToken(code) {
  const oauthConfig = getOAuthConfig();
  const body = new URLSearchParams();

  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', oauthConfig.redirectUri);
  body.set('client_id', oauthConfig.clientId);
  body.set('client_secret', oauthConfig.clientSecret);

  try {
    const response = await axios.post(LINKEDIN_OAUTH_TOKEN_URL, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    if (error.response && error.response.data) {
      const data = error.response.data;
      throw new Error(data.error_description || data.error || error.message);
    }

    throw error;
  }
}

async function fetchUserInfo(accessToken) {
  try {
    const response = await axios.get(LINKEDIN_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    if (error.response && error.response.data) {
      const data = error.response.data;
      throw new Error(data.error_description || data.message || error.message);
    }

    throw error;
  }
}

function decodeJwtWithoutVerification(jwt) {
  const parts = String(jwt || '').split('.');

  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
}

function buildOAuthResult(tokenPayload, userInfo, statePayload) {
  const idTokenClaims = decodeJwtWithoutVerification(tokenPayload.id_token);
  const personId =
    String(
      (userInfo && userInfo.sub) ||
        (idTokenClaims && idTokenClaims.sub) ||
        ''
    ).trim();
  const organizationId = statePayload.organizationId || '';
  const memberAuthorUrn = personId ? `urn:li:person:${personId}` : '';
  const organizationAuthorUrn = organizationId ? `urn:li:organization:${organizationId}` : '';
  const selectedAuthorUrn = statePayload.mode === 'organization' ? organizationAuthorUrn : memberAuthorUrn;

  return {
    accessToken: tokenPayload.access_token || '',
    expiresIn: Number(tokenPayload.expires_in || 0),
    scopes: String(tokenPayload.scope || '').trim(),
    personId,
    organizationId,
    memberAuthorUrn,
    organizationAuthorUrn,
    selectedAuthorUrn,
    profile: {
      name: (userInfo && userInfo.name) || (idTokenClaims && idTokenClaims.name) || '',
      email: (userInfo && userInfo.email) || (idTokenClaims && idTokenClaims.email) || '',
      picture: (userInfo && userInfo.picture) || (idTokenClaims && idTokenClaims.picture) || ''
    }
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCallbackHtml(result) {
  const envLines = [
    `LINKEDIN_ACCESS_TOKEN=${result.accessToken}`,
    result.selectedAuthorUrn ? `LINKEDIN_AUTHOR_URN=${result.selectedAuthorUrn}` : '',
    result.organizationId ? `LINKEDIN_ORGANIZATION_ID=${result.organizationId}` : '',
    result.personId ? `LINKEDIN_PERSON_ID=${result.personId}` : '',
    'LINKEDIN_API_BASE_URL=https://api.linkedin.com',
    `LINKEDIN_API_VERSION=${String(process.env.LINKEDIN_API_VERSION || '202511').trim()}`,
    `LINKEDIN_POST_VISIBILITY=${String(process.env.LINKEDIN_POST_VISIBILITY || 'PUBLIC').trim().toUpperCase()}`
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LinkedIn OAuth Complete</title>
  <style>
    :root{--bg:#f3ede2;--panel:#fffaf1;--ink:#182228;--muted:#5c6d72;--line:#d7ccb8;--accent:#cf762d;--strong:#163b45}
    *{box-sizing:border-box} body{margin:0;font-family:Georgia,"Times New Roman",serif;background:var(--bg);color:var(--ink)}
    main{width:min(920px,calc(100% - 32px));margin:32px auto}
    section{background:var(--panel);border:1px solid rgba(22,59,69,0.08);border-radius:22px;padding:24px;box-shadow:0 22px 55px rgba(24,34,40,0.12)}
    h1,h2{margin:0 0 12px;color:var(--strong)} p{margin:0 0 14px;line-height:1.6;color:var(--muted)}
    .grid{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:18px}
    .card{border:1px solid var(--line);border-radius:16px;padding:16px;background:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8f4d18;margin-bottom:8px}
    .value{font-family:Consolas,Monaco,monospace;font-size:13px;word-break:break-word;white-space:pre-wrap}
    pre{margin:0;background:#182228;color:#f8f5ee;border-radius:16px;padding:16px;overflow:auto;font-size:13px}
    @media (max-width: 760px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <section>
      <h1>LinkedIn OAuth complete</h1>
      <p>Save the values below into your Railway environment variables. The access token is sensitive.</p>
      <pre>${escapeHtml(envLines.join('\n'))}</pre>
      <div class="grid">
        <div class="card">
          <div class="label">Profile</div>
          <div class="value">${escapeHtml(result.profile.name || 'n/a')}</div>
        </div>
        <div class="card">
          <div class="label">Email</div>
          <div class="value">${escapeHtml(result.profile.email || 'n/a')}</div>
        </div>
        <div class="card">
          <div class="label">Person ID</div>
          <div class="value">${escapeHtml(result.personId || 'n/a')}</div>
        </div>
        <div class="card">
          <div class="label">Organization ID</div>
          <div class="value">${escapeHtml(result.organizationId || 'n/a')}</div>
        </div>
        <div class="card">
          <div class="label">Author URN</div>
          <div class="value">${escapeHtml(result.selectedAuthorUrn || 'n/a')}</div>
        </div>
        <div class="card">
          <div class="label">Expires In</div>
          <div class="value">${escapeHtml(result.expiresIn ? `${result.expiresIn} seconds` : 'n/a')}</div>
        </div>
      </div>
      <p style="margin-top:18px">If you want to publish as an organization, restart from <code>/linkedin/connect?mode=organization&amp;organizationId=YOUR_ORG_ID</code>.</p>
    </section>
  </main>
</body>
</html>`;
}

module.exports = {
  buildAuthorizationUrl,
  buildOAuthResult,
  consumeState,
  exchangeCodeForToken,
  fetchUserInfo,
  getRedirectUri,
  renderCallbackHtml
};
