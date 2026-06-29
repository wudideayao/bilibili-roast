const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logFile() {
  return path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, msg) {
  ensureDir(LOG_DIR);
  const line = `[${ts()}] [${level}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logFile(), line + '\n'); } catch {}
}

const logger = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
};

module.exports = logger;
