const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { URL } = require('url');
const logger = require('./logger');

const BILI_API = 'api.bilibili.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ========== 全局请求队列（B站限流严重，串行执行） ==========
let requestQueue = Promise.resolve();
let lastRequestTime = 0;
const MIN_REQUEST_GAP = 1200; // 两次请求最小间隔（ms）

function getFixedCookies() {
  const ts = Date.now();
  const rand = () => Math.floor(Math.random() * 1e9);
  const fp = `${ts}_${rand()}_${rand()}`;
  return [
    `buvid3=${crypto.randomBytes(4).toString('hex')}-${rand()}-${rand()}-infoc`,
    `buvid4=${crypto.randomBytes(8).toString('hex')}`,
    `fingerprint=${fp}`,
    `buvid_fp=${fp}`,
    `buvid_fp_clean=${fp}`,
    `b_nut=${ts}`,
    `buvid_ts=${Math.floor(ts / 1000)}`,
    `rpdid=|(${crypto.randomBytes(6).toString('hex')})`,
  ].join('; ');
}

const USER_COOKIE = process.env.BILI_USER_COOKIE || (() => {
  const sessdata = process.env.BILI_SESSDATA;
  if (sessdata) return 'SESSDATA=' + sessdata;
  try { return fs.readFileSync('/opt/bili_cookie', 'utf8').trim(); } catch (e) { return ''; }
})();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 串行化请求，控制频率
function enqueue(fn) {
  return requestQueue = requestQueue.then(async () => {
    const now = Date.now();
    const gap = now - lastRequestTime;
    if (gap < MIN_REQUEST_GAP) await sleep(MIN_REQUEST_GAP - gap);
    lastRequestTime = Date.now();
    return fn();
  });
}

function biliFetchOnce(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const u = new URL(path, `https://${BILI_API}`);
    const cookies = getFixedCookies();
    const opts = {
      hostname: BILI_API, port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        'Cookie': USER_COOKIE ? cookies + '; ' + USER_COOKIE : cookies,
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
        const elapsed = Date.now() - start;
        logger.info(`[BiliFetch] ${u.pathname} ${res.statusCode} ${elapsed}ms`);
        try { resolve(JSON.parse(data)); } catch { reject(new Error('非JSON响应')); }
      });
    });
    req.on('error', e => {
      logger.error(`[BiliFetch] ${u.pathname} ERROR ${e.message}`);
      reject(e);
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('超时')); });
    req.end();
  });
}

async function fetchRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await enqueue(() => biliFetchOnce(url));
      if (r && r.code === -799) {
        const wait = 3000 * (i + 1) + Math.random() * 3000;
        logger.warn(`触发B站限流(-799)，等待${Math.round(wait)}ms后重试 (${i+1}/${retries})`);
        await sleep(wait);
        continue;
      }
      if (r && r.code === -352) {
        const wait = 4000 * (i + 1) + Math.random() * 2000;
        logger.warn(`触发B站风控(-352)，等待${Math.round(wait)}ms后重试 (${i+1}/${retries})`);
        await sleep(wait);
        continue;
      }
      return r;
    } catch (e) {
      if (i < retries - 1) await sleep(2000 + Math.random() * 2000);
      else throw e;
    }
  }
  return null;
}

async function fetchUserData(mid) {
  // 并行获取数据，通过 enqueue 串行化实际 HTTP 请求
  const [rawCard, rawRelation] = await Promise.all([
    fetchCardByMid(mid),
    fetchRetry('/x/relation/stat?vmid=' + mid, 3),
  ]);

  // 从 card 提取数据
  let userInfo = null;
  let videoCount = 0;
  let cardLikeNum = 0;
  if (rawCard && rawCard.code === 0 && rawCard.data?.card) {
    const card = rawCard.data.card;
    // card.data 顶层也有有用字段
    const topData = rawCard.data;
    videoCount = topData.archive_count || 0;
    cardLikeNum = topData.like_num || 0;
    userInfo = {
      code: 0,
      data: {
        mid: card.mid,
        name: card.name,
        face: card.face,
        sign: card.sign || '',
        level: card.level_info?.current_level || 0,
        video_count: videoCount,
        totalViews: 0,
        totalLikes: cardLikeNum,
      },
    };
  }

  // 尝试获取 upstat（需要登录，提供总播放/总点赞，比 card 更准）
  let upstatData = null;
  if (USER_COOKIE) {
    const up = await fetchRetry('/x/space/upstat?mid=' + mid, 3);
    if (up && up.code === 0 && up.data) {
      upstatData = up.data;
    }
  }

  // 合并 upstat 数据
  if (userInfo && upstatData) {
    if (upstatData.archive?.view) userInfo.data.totalViews = upstatData.archive.view;
    if (upstatData.likes) userInfo.data.totalLikes = upstatData.likes;
  }

  const info = userInfo;
  const stat = rawRelation?.data || {};
  const view = info?.data?.totalViews || 0;
  const like = info?.data?.totalLikes || 0;

  return {
    rawInfo: info,
    merged: {
      uid: info?.data?.mid || mid,
      name: info?.data?.name || '未知',
      avatar: info?.data?.face || '',
      sign: info?.data?.sign || '',
      level: info?.data?.level || 0,
      fans: stat.follower || 0,
      following: stat.following || 0,
      totalViews: view,
      totalLikes: like,
      videoCount: info?.data?.video_count || 0,
    },
  };
}

// 尝试多个端点获取用户信息
async function fetchCardByMid(mid) {
  // 策略1: card 端点
  const card = await fetchRetry('/x/web-interface/card?mid=' + mid, 3);
  if (card && card.code === 0) return card;

  // 策略2: 试用 WBI 签名的 acc/info（如果调用方提供了签名）
  // 这里只使用非签名方式
  logger.warn('[Bili] card 端点也失败了，尝试 space/acc/info 裸请求');
  const info = await fetchRetry('/x/space/acc/info?mid=' + mid, 2);
  if (info && info.code === 0) {
    return {
      code: 0,
      data: {
        card: {
          mid: info.data.mid,
          name: info.data.name,
          face: info.data.face,
          sign: info.data.sign || '',
          level_info: { current_level: info.data.level || 0 },
          videos: info.data.video_count || info.data.video || 0,
        },
      },
    };
  }

  return card; // 返回原始错误
}

module.exports = { fetchUserData, fetchRetry, biliFetchOnce, fetchWbiKeys: null };
