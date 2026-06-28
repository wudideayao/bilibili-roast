const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = 3456;
const BILI_API = 'api.bilibili.com';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
  0, 57, 39, 55, 59, 13, 40, 1, 38, 24, 54, 26, 21, 16, 25, 11,
  51, 44, 34, 20, 48, 41, 36, 6, 17, 60, 22, 22, 62, 63, 61, 4,
];

function randStr(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

// ========== 代理池（启动时自动获取免费代理，轮换 IP） ==========
let proxyPool = [];
let proxyIdx = 0;

// 多个免费代理源（国内可访问 + 国际）
const PROXY_SOURCES = [
  'http://api.89ip.cn/tqdl.html?num=60&protocol=http',
  'http://api.89ip.cn/tqdl.html?num=60&protocol=https',
];

async function fetchProxies() {
  const all = new Set();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  for (const url of PROXY_SOURCES) {
    try {
      const data = await new Promise((resolve) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { signal: controller.signal }, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
        });
        req.on('error', () => resolve(''));
        req.setTimeout(6000, () => { req.destroy(); resolve(''); });
      });
      data.trim().split('\n').filter(Boolean).forEach(line => {
        const parts = line.trim().split(':');
        if (parts.length >= 2) all.add(`${parts[0]}:${parts[1]}`);
      });
    } catch (_) {}
  }
  clearTimeout(timer);
  const arr = [...all].map(p => {
    const [host, port] = p.split(':');
    return { host, port: parseInt(port) };
  });
  console.log(`[代理] 获取到 ${arr.length} 个代理`);
  return arr;
}

// 测试代理是否可用（带超时）
function testProxy(proxy, timeout = 3000) {
  return new Promise(resolve => {
    const req = http.request({
      hostname: proxy.host, port: proxy.port,
      method: 'CONNECT', path: 'www.baidu.com:443',
      timeout,
    });
    req.on('connect', () => { req.destroy(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// 初始化代理池（并行测试，大幅提速）
async function initProxyPool() {
  const all = await fetchProxies();
  const toTest = all.slice(0, 60);
  if (toTest.length === 0) {
    console.log('[代理] 无代理可测试');
    return;
  }
  console.log(`[代理] 测试 ${Math.min(toTest.length, 60)} 个代理连通性...`);
  // 并发测试，每批 20 个
  const working = [];
  for (let i = 0; i < toTest.length && working.length < 5; i += 20) {
    const batch = toTest.slice(i, i + 20);
    const results = await Promise.all(batch.map(p => testProxy(p, 3000)));
    batch.forEach((p, idx) => {
      if (results[idx]) working.push(p);
    });
  }
  if (working.length > 0) {
    proxyPool = working;
    console.log(`[代理] ${working.length} 个代理可用: ${working.map(p => `${p.host}:${p.port}`).join(', ')}`);
  } else {
    console.log('[代理] 无可用代理，将使用直连');
  }
}

// 获取下一个代理
function nextProxy() {
  if (proxyPool.length === 0) return null;
  proxyIdx = (proxyIdx + 1) % proxyPool.length;
  return proxyPool[proxyIdx];
}

// 每 30 分钟刷新代理池
setInterval(() => initProxyPool(), 30 * 60 * 1000);

// ========== 通过代理发送 HTTPS 请求 ==========
function biliFetchOnce(path, useProxy = true) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, `https://${BILI_API}`);
    const proxy = useProxy ? nextProxy() : null;

    // 生成每个请求独立的 Cookie（更像真实用户）
    const ts = Date.now();
    const fp = `${ts}_${Math.floor(Math.random() * 1e7)}_${Math.floor(Math.random() * 1e7)}`;
    const cookies = [
      `buvid3=${randStr(8)}-${randStr(4)}-${randStr(4)}-${randStr(4)}-${randStr(12)}infoc`,
      `buvid4=${randStr(16)}`,
      `_uuid=${randStr(32)}`,
      `fingerprint=${fp}`,
      `buvid_fp=${fp}`,
      `buvid_fp_clean=${fp}`,
      `b_nut=${ts}`,
      `buvid_ts=${Math.floor(ts / 1000)}`,
      `rpdid=|(${randStr(8)}${randStr(4)})`,
    ].join('; ');

    const headers = {
      'User-Agent': (() => {
        const uas = [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
        ];
        return uas[Math.floor(Math.random() * uas.length)];
      })(),
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com',
      'Cookie': cookies,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    };

    const doRequest = (socket) => {
      const opts = socket ? {
        socket, host: BILI_API, path: u.pathname + u.search,
        method: 'GET', headers, rejectUnauthorized: false,
      } : {
        hostname: BILI_API, port: 443, path: u.pathname + u.search,
        method: 'GET', headers, rejectUnauthorized: false,
      };
      const req = https.request(opts, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('非JSON响应')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('超时')); });
      req.end();
    };

    if (proxy) {
      // 通过 HTTP 代理建立 CONNECT 隧道
      const conn = http.request({
        hostname: proxy.host, port: proxy.port,
        method: 'CONNECT', path: `${BILI_API}:443`,
        timeout: 10000,
      });
      conn.on('connect', (res, socket) => {
        const tlsSocket = tls.connect({
          socket, host: BILI_API, servername: BILI_API,
          rejectUnauthorized: false,
        }, () => doRequest(tlsSocket));
        tlsSocket.on('error', reject);
      });
      conn.on('error', (err) => {
        // 代理挂了，移出池子，降级直连
        proxyPool = proxyPool.filter(p => p.host !== proxy.host || p.port !== proxy.port);
        doRequest();
      });
      conn.on('timeout', () => { conn.destroy(); doRequest(); });
      conn.end();
    } else {
      doRequest();
    }
  });
}

// ========== WBI 签名 ==========
let wbiKeys = null;
let wbiFetching = false;
let wbiQueue = [];

async function getWbiKeys() {
  if (wbiKeys) return wbiKeys;
  if (wbiFetching) return new Promise(r => wbiQueue.push(r));
  wbiFetching = true;
  try {
    await sleep(200 + Math.random() * 800);
    const data = await biliFetch('/x/web-interface/nav', false);
    const img = data.data?.wbi_img;
    if (!img) throw new Error('获取WBI密钥失败');
    const imgKey = img.img_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    const subKey = img.sub_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    wbiKeys = { imgKey, subKey };
    setTimeout(() => { wbiKeys = null; }, 2 * 60 * 60 * 1000);
  } finally {
    wbiFetching = false;
    wbiQueue.forEach(r => r());
    wbiQueue = [];
  }
  return wbiKeys;
}

function getMixinKey(imgKey, subKey) {
  let mixin = '';
  for (let i = 0; i < 32; i++) mixin += (imgKey + subKey)[MIXIN_KEY_ENC_TAB[i]];
  return mixin;
}

async function wbiSign(params) {
  const keys = await getWbiKeys();
  const mixinKey = getMixinKey(keys.imgKey, keys.subKey);
  const wts = Math.floor(Date.now() / 1000);
  params.wts = wts;
  const sorted = Object.keys(params).sort()
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
  params.w_rid = crypto.createHash('md5').update(sorted + mixinKey).digest('hex');
  return params;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== 请求队列（序列化请求、降频、自动重试） ==========
const requestQueue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (requestQueue.length > 0) {
    const { path, retries, resolve, reject, useProxy } = requestQueue.shift();
    let result = null;
    let lastErr = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        result = await biliFetchOnce(path, useProxy);
        if (result && result.code === -799) {
          const wait = 3000 * (attempt + 1) + Math.random() * 2000;
          await sleep(wait);
          continue;
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < retries - 1) {
          await sleep(1500 + Math.random() * 1500);
        }
      }
    }
    if (lastErr) { reject(lastErr); processing = false; return; }
    resolve(result);
    if (requestQueue.length > 0) await sleep(1500 + Math.random() * 1500);
  }
  processing = false;
}

function biliFetch(path, useProxy = true, retries = 3) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ path, retries, resolve, reject, useProxy });
    processQueue();
  });
}

// ========== HTTP 服务 ==========
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/user') {
      const mid = url.searchParams.get('mid');
      if (!mid) { res.statusCode = 400; res.end(JSON.stringify({ error: '缺少mid参数' })); return; }

      await getWbiKeys();
      const infoParams = await wbiSign({ mid });
      const qs = Object.entries(infoParams).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

      const rawInfo = await biliFetch(`/x/space/acc/info?${qs}`, true, 3);
      await sleep(1000 + Math.random() * 1500);
      const searchParams = await wbiSign({ mid, ps: 1, pn: 1 });
      const searchQs = Object.entries(searchParams).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      const rawSearch = await biliFetch(`/x/space/arc/search?${searchQs}`, true, 3).catch(() => null);

      res.end(JSON.stringify({ code: 0, info: rawInfo, search: rawSearch }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: '未知路径' }));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

// 启动：先启动服务，后台初始化代理池
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[B站代理] 运行在 http://127.0.0.1:${PORT}`);
  initProxyPool().then(() => {
    console.log(`[代理] 初始化完成，${proxyPool.length} 个可用`);
  }).catch(err => {
    console.log('[代理] 初始化失败，将使用直连:', err.message);
  });
});
