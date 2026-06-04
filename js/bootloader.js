/**
 * Bootloader — 启动时从远程拉取 JS 并执行。
 * 
 * 工作方式：
 * 1. 启动时访问 GITHUB_RAW_URL/boot/boot.js
 * 2. 如果有 .sig 文件，验证 ECDSA 签名
 * 3. 在沙盒上下文中执行 JS
 * 4. 失败时静默继续（网络不通、签名错误等）
 * 
 * 远程脚本可以：
 * - 显示更新通知/横幅
 * - 修改内置行为
 * - 推送动态配置
 * - 强制最低版本检查
 */

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// 发布后改这个仓库地址
const GITHUB_RAW = 'https://raw.githubusercontent.com/THEWINDOWS11/guichu-tool/main';
const BOOT_SCRIPT_URL = GITHUB_RAW + '/boot/boot.js';
const BOOT_SIGNATURE_URL = GITHUB_RAW + '/boot/boot.js.sig';

// 内嵌公钥（ECDSA P-256），发布前替换为真实密钥对
// 生成：openssl ecparam -genkey -name prime256v1 -out private.pem
//       openssl ec -in private.pem -pubout -out public.pem
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEuKqHHqF6qhq2FEDuBGl/TJtRMOvS
v1j3GjWNIEKp2o4jV7f3QG/tZSoePpeB4qsn+pEaSI/0Gi7pQkLzfl5Z3A==
-----END PUBLIC KEY-----`;

/**
 * 启动引导流程
 * @param {object} api - 暴露给远程脚本的 API（app,窗口,设置等）
 */
function bootstrap(api) {
  fetchScript(BOOT_SCRIPT_URL).then(code => {
    if (!code) return;
    // 尝试验证签名
    verifySignature(code).then(valid => {
      if (!valid) {
        console.warn('[bootloader] 签名验证失败，跳过执行');
        return;
      }
      executeScript(code, api);
    }).catch(() => {
      // 没有签名文件时直接执行（开发模式）
      executeScript(code, api);
    });
  }).catch(() => {
    // 网络不通等，静默继续
  });
}

function fetchScript(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'guichu-tool-bootloader' },
      timeout: 10000,
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function verifySignature(code) {
  try {
    const sigRaw = await fetchScript(BOOT_SIGNATURE_URL);
    if (!sigRaw) return false;
    const sig = Buffer.from(sigRaw.trim(), 'base64');
    const verify = crypto.createVerify('SHA256');
    verify.update(code, 'utf-8');
    return verify.verify(PUBLIC_KEY_PEM, sig);
  } catch {
    return false;
  }
}

function executeScript(code, api) {
  try {
    // 用 vm 模块在沙盒中执行，限制访问敏感 API
    const vm = require('vm');
    const context = {
      console: console,
      setTimeout: setTimeout,
      setInterval: setInterval,
      fetch: (url) => fetchScript(url),
      api: api,
      __boot_version: '1.0.0',
    };
    vm.createContext(context);
    vm.runInContext(code, context, { filename: 'boot.js', timeout: 5000 });
    console.log('[bootloader] 远程脚本执行成功');
  } catch (e) {
    console.warn('[bootloader] 脚本执行失败:', e.message);
  }
}

module.exports = { bootstrap };
