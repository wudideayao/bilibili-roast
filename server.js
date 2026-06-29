const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const crypto = require('crypto');

const logger = require('./logger');
const db = require('./db');
const wbi = require('./wbi');
const bili = require('./bili');
const ai = require('./ai');
const roast = require('./roast');

const PORT = 3456;

// ========== 初始化 ==========
db.initDB();
logger.info('B站锐评服务器启动中...');

// ========== 缓存模块 ==========
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

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

function getClientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function ipHash(ip) {
  return crypto.createHash('md5').update(ip + '-bili-roast-salt').digest('hex').slice(0, 8);
}

function json(res, data, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error('无效的 JSON')); }
    });
    req.on('error', reject);
  });
}

// ========== 路由 ==========
const routes = {
  'GET /api/user': handleUser,
  'POST /api/roast': handleRoast,
  'GET /api/leaderboard': handleLeaderboard,
  'GET /api/stats': handleStats,
};

async function handleUser(req, res, url) {
  const mid = url.searchParams.get('mid');
  if (!mid) return json(res, { error: '缺少 mid 参数' }, 400);

  const reqStart = Date.now();
  const cacheKey = `user:${mid}`;
  const cached = getCache(cacheKey);
  if (cached) {
    logger.info(`[API] /api/user?mid=${mid} ${Date.now() - reqStart}ms CACHED`);
    return json(res, { code: 0, data: cached, cached: true });
  }

  const { rawInfo, merged } = await bili.fetchUserData(mid);

  if (!rawInfo) {
    return json(res, { code: -1, error: 'B站API请求失败，请稍后重试' }, 502);
  }
  if (rawInfo.code !== 0) {
    return json(res, { code: -1, error: rawInfo.message || '用户不存在，请检查UID' }, 404);
  }

  const userData = {
    uid: merged.uid,
    name: merged.name,
    avatar: merged.avatar,
    sign: merged.sign,
    level: merged.level,
    fans: merged.fans,
    following: merged.following,
    totalViews: merged.totalViews,
    totalLikes: merged.totalLikes,
    videoCount: merged.videoCount,
  };

  setCache(cacheKey, userData);
  logger.info(`[API] /api/user?mid=${mid} ${Date.now() - reqStart}ms`);

  json(res, { code: 0, data: userData });
}

async function handleRoast(req, res, url) {
  try {
    const data = await readBody(req);
    const userData = {
      name: data.name || '未知',
      fans: Number(data.fans) || 0,
      totalViews: Number(data.totalViews) || 0,
      totalLikes: Number(data.totalLikes) || 0,
      videoCount: Number(data.videoCount) || 0,
      level: Number(data.level) || 0,
      sign: data.sign || '',
      following: Number(data.following) || 0,
      videos: data.videos || [],
    };

    const result = roast.generateRoast(userData);

    let aiRoast = null;
    try {
      aiRoast = await ai.generateDeepSeekRoast(userData);
    } catch (e) {
      logger.warn('AI 锐评异常: ' + e.message);
    }

    const ip = getClientIP(req);
    db.saveRoast({
      uid: String(data.uid || ''),
      uname: userData.name,
      fans: userData.fans,
      total_views: userData.totalViews,
      total_likes: userData.totalLikes,
      video_count: userData.videoCount,
      level: userData.level,
      grade: result.grade,
      roast_text: result.roast + ' ' + result.detail,
      ai_roast: aiRoast || '',
      ip_hash: ipHash(ip),
    });

    json(res, {
      code: 0,
      grade: result.grade,
      title: result.title,
      roast: aiRoast || result.roast,
      detail: result.detail,
      tags: result.tags,
      localRoast: aiRoast ? result.roast : null,
    });
  } catch (err) {
    logger.error(`锐评处理失败: ${err.message}`);
    json(res, { code: -1, error: err.message });
  }
}

async function handleLeaderboard(req, res, url) {
  const sort = url.searchParams.get('sort') || 'fans';
  const period = url.searchParams.get('period') || 'all';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);

  try {
    const data = db.getLeaderboard({ sort, period, limit });
    const stats = db.getStats();
    json(res, { code: 0, data, stats });
  } catch (err) {
    logger.error(`排行榜查询失败: ${err.message}`);
    json(res, { code: -1, error: err.message });
  }
}

async function handleStats(req, res) {
  try {
    const stats = db.getStats();
    const recent = db.getRecentUids(10);
    json(res, { code: 0, stats, recent });
  } catch (err) {
    json(res, { code: -1, error: err.message });
  }
}

// ========== HTTP 服务器 ==========
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, 'http://localhost:' + PORT);
  const routeKey = req.method + ' ' + url.pathname;

  try {
    const handler = routes[routeKey];
    if (handler) {
      await handler(req, res, url);
    } else if (url.pathname === '/' || url.pathname === '/index.html') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    } else {
      json(res, { error: '未知路径' }, 404);
    }
  } catch (err) {
    logger.error('服务器错误: ' + err.message);
    json(res, { error: '服务器内部错误' }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  logger.info('B站锐评服务器运行中 http://127.0.0.1:' + PORT);
  if (process.env.BILI_USER_COOKIE || process.env.BILI_SESSDATA) logger.info('已加载B站登录态');
  wbi.fetchWbiKeys(bili.biliFetchOnce).catch(() => {});
});
