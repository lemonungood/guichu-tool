const https = require('https');
const { app } = require('electron');

const APP_VERSION = app.getVersion() || '1.0.0';
// GitHub repo for releases — change when publishing
const GITHUB_REPO = 'THEWINDOWS11/guichu-tool';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Fetch latest version from GitHub releases.
 * Returns { latestVersion, downloadUrl, releaseNotes, hasUpdate, error }
 */
function checkForUpdate() {
  return new Promise((resolve) => {
    const req = https.get(RELEASES_URL, {
      headers: { 'User-Agent': 'guichu-tool/' + APP_VERSION, 'Accept': 'application/vnd.github.v3+json' },
      timeout: 8000,
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.tag_name) {
            const latest = data.tag_name.replace(/^v/, '');
            const current = APP_VERSION.replace(/^v/, '');
            const hasUpdate = compareVersions(latest, current) > 0;
            resolve({
              latestVersion: latest,
              currentVersion: APP_VERSION,
              downloadUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
              releaseNotes: data.body || '',
              hasUpdate,
              error: null,
            });
          } else {
            resolve({ error: '无法解析版本信息', latestVersion: null, hasUpdate: false });
          }
        } catch (e) {
          resolve({ error: '解析失败: ' + e.message, latestVersion: null, hasUpdate: false });
        }
      });
    });
    req.on('error', (e) => {
      // Network failure (offline, repo doesn't exist yet, etc.) — not an error for the user
      resolve({ error: null, latestVersion: null, hasUpdate: false, networkError: true });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: null, latestVersion: null, hasUpdate: false, networkError: true }); });
  });
}

// Simple semver comparison: "1.2.3" > "1.2.0"
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

module.exports = { checkForUpdate, APP_VERSION };
