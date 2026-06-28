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

// 多 User-Agent 轮换
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
];
let uaIndex = 0;
function nextUA() {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex++;
  return ua;
}

// ========== Cookie 生成 ==========
function randStr(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}
function makeBuvid3() {
  return `${randStr(8)}-${randStr(4)}-${randStr(4)}-${randStr(4)}-${randStr(12)}infoc`;
}
function makeFp() {
  const ts = Date.now();
  const r1 = Math.floor(Math.random() * 1e7);
  const r2 = Math.floor(Math.random() * 1e7);
  return `${ts}_${r1}_${r2}`;
}
function makeCookies() {
  const b3 = makeBuvid3();
  const fp = makeFp();
  return [
    `buvid3=${b3}`,
    `buvid4=${randStr(16)}`,
    `_uuid=${randStr(32)}`,
    `fingerprint=${fp}`,
    `buvid_fp=${fp}`,
    `buvid_fp_clean=${fp}`,
    `b_nut=${Date.now()}`,
    `buvid_ts=${Math.floor(Date.now() / 1000)}`,
    `rpdid=|(${randStr(8)}${randStr(4)})`,
  ].join('; ');
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
    // 获取密钥前先随机延迟，降低被识别风险
    await sleep(500 + Math.random() * 1500);
    const data = await biliFetch('/x/web-interface/nav');
    const img = data.data?.wbi_img;
    if (!img) throw new Error('获取WBI密钥失败');
    const imgKey = img.img_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    const subKey = img.sub_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    wbiKeys = { imgKey, subKey };
    // 2小时刷新，减少nav接口调用
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

// ========== 带重试的 B 站 API 请求 ==========
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function biliFetch(path, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await biliFetchOnce(path);
      if (result && result.code === -799) {
        // 被限流，等一会重试
        const wait = 2000 * (attempt + 1) + Math.random() * 3000;
        await sleep(wait);
        continue;
      }
      return result;
    } catch (e) {
      if (attempt < retries - 1) {
        await sleep(1500 + Math.random() * 2000);
      } else {
        throw e;
      }
    }
  }
  return null;
}

function biliFetchOnce(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, `https://${BILI_API}`);
    const opts = {
      hostname: BILI_API, port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': nextUA(),
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        'Cookie': makeCookies(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
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

      const rawInfo = await biliFetch(`/x/space/acc/info?${qs}`);
      // 两个请求之间随机延迟，避免触发频率限制
      await sleep(1000 + Math.random() * 2000);
      const statParams = await wbiSign({ mid });
      const statQs = Object.entries(statParams).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      const rawStat = await biliFetch(`/x/space/upstat?${statQs}`);

      res.end(JSON.stringify({ code: 0, info: rawInfo, stat: rawStat }));
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
  console.log(`B站代理服务运行在 http://127.0.0.1:${PORT}`);
});
