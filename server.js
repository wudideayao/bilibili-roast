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
    setTimeout(() => { wbiKeys = null; }, 6 * 60 * 60 * 1000);
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

let buvid3 = '';
function getBuvid3() {
  if (!buvid3) {
    const h = () => Math.random().toString(16).slice(2, 10);
    buvid3 = `${h()}${h()}-${h()}-${h()}-${h()}-${h()}${h()}${h()}infoc`;
  }
  return buvid3;
}

function biliFetch(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, `https://${BILI_API}`);
    const opts = {
      hostname: BILI_API, port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': `buvid3=${getBuvid3()}`,
        'Accept': 'application/json, text/plain, */*',
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

      const rawInfo = await biliFetch(`/x/space/acc/info?${qs}`).catch(() => null);
      const statParams = await wbiSign({ mid });
      const statQs = Object.entries(statParams).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      const rawStat = await biliFetch(`/x/space/upstat?${statQs}`).catch(() => null);

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
