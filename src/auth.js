const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKENS_PATH = path.join(__dirname, '..', '.tokens.json');
const MT_BASE = 'https://getsweatstudio.marianatek.com';
const CLIENT_ID = 'sbLziNCoF5HcOhkSV6zRL8O7betwd3mDDIQbWZa3';
const REDIRECT_URI = 'https://getsweatstudio.marianaiframes.com/iframe/callback/';

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function loadCachedCredentials() {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    if (Date.now() > data.expiresAt) {
      console.log('[auth] Cached credentials expired');
      return null;
    }
    console.log('[auth] Using cached credentials');
    return data;
  } catch {
    return null;
  }
}

function saveCredentials(tokenData) {
  const data = {
    auth: { type: 'bearer', value: tokenData.access_token },
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in * 1000) - 60000, // 1 min buffer
    cachedAt: Date.now()
  };
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(data, null, 2));
  console.log(`[auth] Token cached (expires in ${Math.round(tokenData.expires_in / 3600)}h)`);
}

async function refreshAccessToken(refreshToken) {
  console.log('[auth] Refreshing token...');
  const resp = await axios.post(`${MT_BASE}/o/token/`, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return resp.data;
}

async function loginWithCredentials() {
  const email = process.env.MT_EMAIL;
  const password = process.env.MT_PASSWORD;

  if (!email || !password) {
    throw new Error('MT_EMAIL and MT_PASSWORD must be set in .env');
  }

  const { verifier, challenge } = generatePKCE();

  // Step 1: Build authorize URL and get login page
  const authorizeParams = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    response_mode: 'query',
    scope: 'read:account',
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const loginNext = `/o/authorize/?${authorizeParams}`;

  console.log('[auth] Logging in via API...');
  const loginPageResp = await axios.get(`${MT_BASE}/auth/login/?next=${encodeURIComponent(loginNext)}`, {
    maxRedirects: 0,
    validateStatus: s => s < 400
  });

  const setCookies = loginPageResp.headers['set-cookie'] || [];
  const csrfMatch = loginPageResp.data.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
  if (!csrfMatch) throw new Error('Could not find CSRF token on login page');

  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: Submit credentials
  const loginResp = await axios.post(
    `${MT_BASE}/auth/login/?next=${encodeURIComponent(loginNext)}`,
    new URLSearchParams({
      csrfmiddlewaretoken: csrfMatch[1],
      username: email,
      password: password,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
        'Referer': `${MT_BASE}/auth/login/`,
      },
      maxRedirects: 0,
      validateStatus: s => s === 302
    }
  );

  const postCookies = loginResp.headers['set-cookie'] || [];
  const allCookies = [...setCookies, ...postCookies].map(c => c.split(';')[0]).join('; ');

  // Step 3: Follow redirect to /o/authorize/ to get auth code
  let redirectUrl = loginResp.headers['location'];
  if (!redirectUrl) throw new Error('Login failed — no redirect. Check credentials.');
  if (redirectUrl.startsWith('/')) redirectUrl = MT_BASE + redirectUrl;

  const authResp = await axios.get(redirectUrl, {
    headers: { 'Cookie': allCookies },
    maxRedirects: 0,
    validateStatus: s => s === 302
  });

  const callbackUrl = authResp.headers['location'];
  const codeMatch = callbackUrl?.match(/[?&]code=([^&]+)/);
  if (!codeMatch) throw new Error('OAuth failed — no authorization code returned');

  // Step 4: Exchange code for token
  const tokenResp = await axios.post(`${MT_BASE}/o/token/`, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: codeMatch[1],
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  console.log('[auth] Login successful');
  return tokenResp.data;
}

let invalidated = false;

async function getAuth() {
  if (!invalidated) {
    const cached = loadCachedCredentials();
    if (cached) {
      // Try refresh if we have a refresh token and token is expiring within 1 hour
      if (cached.refreshToken && cached.expiresAt - Date.now() < 3600000) {
        try {
          const tokenData = await refreshAccessToken(cached.refreshToken);
          saveCredentials(tokenData);
          return { type: 'bearer', value: tokenData.access_token };
        } catch {
          console.log('[auth] Refresh failed, doing full login');
        }
      } else {
        return cached.auth;
      }
    }
  }

  const tokenData = await loginWithCredentials();
  saveCredentials(tokenData);
  invalidated = false;
  return { type: 'bearer', value: tokenData.access_token };
}

function invalidateAuth() {
  invalidated = true;
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      fs.unlinkSync(TOKENS_PATH);
      console.log('[auth] Credentials invalidated');
    }
  } catch {}
}

module.exports = { getAuth, invalidateAuth };
