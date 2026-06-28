const http = require('http');
const https = require('https');
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

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ========== 固定的浏览器指纹（复用，不每次生成） ==========
function randStr(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}
const FIXED_COOKIES = (() => {
  const ts = Date.now();
  const fp = `${ts}_${Math.floor(Math.random() * 1e7)}_${Math.floor(Math.random() * 1e7)}`;
  return [
    `buvid3=${randStr(8)}-${randStr(4)}-${randStr(4)}-${randStr(4)}-${randStr(12)}infoc`,
    `buvid4=${randStr(16)}`,
    `fingerprint=${fp}`,
    `buvid_fp=${fp}`,
    `buvid_fp_clean=${fp}`,
    `b_nut=${ts}`,
    `buvid_ts=${Math.floor(ts / 1000)}`,
    `rpdid=|(${randStr(8)}${randStr(4)})`,
  ].join('; ');
})();

// ========== WBI 签名 ==========
let wbiKeys = null;
let wbiFetching = false;
let wbiQueue = [];

async function getWbiKeys() {
  if (wbiKeys) return wbiKeys;
  if (wbiFetching) return new Promise(r => wbiQueue.push(r));
  wbiFetching = true;
  try {
    const data = await biliFetch('/x/web-interface/nav');
    const img = data.data?.wbi_img;
    if (!img) throw new Error('获取WBI密钥失败');
    const imgKey = img.img_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    const subKey = img.sub_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    wbiKeys = { imgKey, subKey };
    // 12 小时刷新
    setTimeout(() => { wbiKeys = null; }, 12 * 60 * 60 * 1000);
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

// ========== 响应缓存（避免重复请求） ==========
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ========== 请求队列（序列化 + 降频 + 重试） ==========
const requestQueue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (requestQueue.length > 0) {
    const { path, retries, resolve, reject } = requestQueue.shift();
    let result = null;
    let lastErr = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        result = await biliFetchOnce(path);
        if (result && result.code === -799) {
          const wait = 5000 * (attempt + 1) + Math.random() * 3000;
          await sleep(wait);
          continue;
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < retries - 1) {
          await sleep(2000 + Math.random() * 2000);
        }
      }
    }
    if (lastErr) { reject(lastErr); processing = false; return; }
    resolve(result);
    // 请求间隔至少 2 秒
    if (requestQueue.length > 0) await sleep(4000 + Math.random() * 2000);
  }
  processing = false;
}

function biliFetch(path, retries = 3) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ path, retries, resolve, reject });
    processQueue();
  });
}

function biliFetchOnce(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, `https://${BILI_API}`);
    const opts = {
      hostname: BILI_API, port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        'Cookie': FIXED_COOKIES,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
      },
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

      // 检查缓存
      const cacheKey = `user:${mid}`;
      const cached = getCache(cacheKey);
      if (cached) {
        res.end(JSON.stringify({ code: 0, info: cached.info, search: cached.search, relation: cached.relation, cached: true }));
        return;
      }

      await getWbiKeys();
      const infoParams = await wbiSign({ mid });
      const qs = Object.entries(infoParams).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

      const rawInfo = await biliFetch(`/x/space/acc/info?${qs}`, 4);
      const rawRelation = await biliFetch(`/x/relation/stat?vmid=${mid}`, 2).catch(() => null);
      const searchParams = await wbiSign({ mid, ps: 1, pn: 1 });
      const searchQs = Object.entries(searchParams).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      const rawSearch = await biliFetch(`/x/space/arc/search?${searchQs}`, 2).catch(() => null);

      setCache(cacheKey, { info: rawInfo, search: rawSearch, relation: rawRelation });

      res.end(JSON.stringify({ code: 0, info: rawInfo, search: rawSearch, relation: rawRelation }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: '未知路径' }));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[B站代理] http://127.0.0.1:${PORT}`);
  // 预加载 WBI 密钥（第一次请求慢，但后续快）
  getWbiKeys().then(() => console.log('[WBI] 密钥已缓存')).catch(() => {});
});
