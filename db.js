const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'roast.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logger.info(`创建数据目录: ${DATA_DIR}`);
}

let db;

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS roast_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      uname TEXT,
      fans INTEGER DEFAULT 0,
      total_views INTEGER DEFAULT 0,
      total_likes INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      grade TEXT,
      roast_text TEXT,
      ai_roast TEXT,
      ip_hash TEXT,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_uid ON roast_records(uid);
    CREATE INDEX IF NOT EXISTS idx_grade ON roast_records(grade);
    CREATE INDEX IF NOT EXISTS idx_created_at ON roast_records(created_at);
    CREATE INDEX IF NOT EXISTS idx_fans ON roast_records(fans);
  `);

  logger.info(`数据库已初始化: ${DB_PATH}`);
  return db;
}

function saveRoast(record) {
  const stmt = db.prepare(`
    INSERT INTO roast_records (uid, uname, fans, total_views, total_likes, video_count, level, grade, roast_text, ai_roast, ip_hash)
    VALUES (@uid, @uname, @fans, @total_views, @total_likes, @video_count, @level, @grade, @roast_text, @ai_roast, @ip_hash)
  `);
  const result = stmt.run(record);
  return result.lastInsertRowid;
}

function getLeaderboard({ sort = 'fans', period = 'all', limit = 20 }) {
  const allowedSort = ['fans', 'total_views', 'total_likes', 'created_at', 'grade'];
  if (!allowedSort.includes(sort)) sort = 'fans';

  let where = '';
  if (period === 'today') {
    where = "WHERE created_at >= datetime('now', '-1 day', 'localtime')";
  } else if (period === 'week') {
    where = "WHERE created_at >= datetime('now', '-7 days', 'localtime')";
  }

  const orderMap = {
    fans: 'MAX(fans) DESC',
    total_views: 'MAX(total_views) DESC',
    total_likes: 'MAX(total_likes) DESC',
    created_at: 'MAX(created_at) DESC',
    grade: "CASE MAX(grade) WHEN 'S' THEN 6 WHEN 'A' THEN 5 WHEN 'B' THEN 4 WHEN 'C' THEN 3 WHEN 'D' THEN 2 WHEN 'F' THEN 1 ELSE 0 END DESC",
  };

  const rows = db.prepare(`
    SELECT
      uid, uname,
      MAX(fans) AS fans,
      MAX(total_views) AS total_views,
      MAX(total_likes) AS total_likes,
      MAX(video_count) AS video_count,
      MAX(level) AS level,
      MAX(grade) AS grade,
      COUNT(*) AS searched_count,
      (
        SELECT roast_text FROM roast_records r2
        WHERE r2.uid = roast_records.uid
        ORDER BY r2.created_at DESC LIMIT 1
      ) AS roast_text
    FROM roast_records
    ${where}
    GROUP BY uid
    ORDER BY ${orderMap[sort]}
    LIMIT ?
  `).all(limit);

  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

function getRecentUids(limit = 10) {
  return db.prepare(`
    SELECT DISTINCT uid, uname, MAX(created_at) AS last_seen
    FROM roast_records
    GROUP BY uid
    ORDER BY last_seen DESC
    LIMIT ?
  `).all(limit);
}

function getStats() {
  return db.prepare(`
    SELECT
      COUNT(*) AS total_roasts,
      COUNT(DISTINCT uid) AS total_users,
      COALESCE(MAX(fans), 0) AS max_fans,
      COALESCE(MAX(total_views), 0) AS max_views
    FROM roast_records
  `).get();
}

function close() {
  if (db) db.close();
}

module.exports = { initDB, saveRoast, getLeaderboard, getRecentUids, getStats, close };
