// 习惯打卡 · 多用户在线版服务器
// 本地模式（默认）：零依赖，node:http + node:sqlite，数据存 data/habits.db
// 云模式：设置 TURSO_URL 与 TURSO_AUTH_TOKEN 后使用 Turso 云 SQLite（需 npm install @libsql/client）
// AI 周总结：设置 DEEPSEEK_API_KEY（DeepSeek 开放平台）后可用
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, sep, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'habits.db');
const PORT = Number(process.env.PORT) || 4321;
const OPEN_BROWSER = !process.argv.includes('--no-open');
const TURSO_URL = process.env.TURSO_URL || '';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const USE_TURSO = !!(TURSO_URL && TURSO_AUTH_TOKEN);// ---------- 数据层（双模式） ----------
let localDb = null;
let tursoClient = null;
if (USE_TURSO) {
  const { createClient } = await import('@libsql/client');
  tursoClient = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });
} else {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  localDb = new DatabaseSync(DB_PATH);
  localDb.exec('PRAGMA foreign_keys = ON');
}

const db = {
  async exec(sql) {
    if (tursoClient) { await tursoClient.executeMultiple(sql); return; }
    localDb.exec(sql);
  },
  async all(sql, args = []) {
    if (tursoClient) return (await tursoClient.execute({ sql, args })).rows;
    return localDb.prepare(sql).all(...args);
  },
  async get(sql, args = []) {
    if (tursoClient) return (await tursoClient.execute({ sql, args })).rows[0];
    return localDb.prepare(sql).get(...args);
  },
  async run(sql, args = []) {
    if (tursoClient) {
      const r = await tursoClient.execute({ sql, args });
      return { changes: Number(r.rowsAffected || 0), lastInsertRowid: Number(r.lastInsertRowid || 0) };
    }
    const r = localDb.prepare(sql).run(...args);
    return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
  },
};// ---------- 建表与旧库迁移 ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

await db.exec(SCHEMA);
// 旧版本本地库迁移：habits 表没有 user_id 列时重建（旧测试数据丢弃）
const habitTable = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='habits'");
if (habitTable && habitTable.sql && !String(habitTable.sql).includes('user_id')) {
  await db.exec('DROP TABLE IF EXISTS checkins; DROP TABLE IF EXISTS habits;');
  await db.exec(SCHEMA);
}// ---------- 工具函数 ----------
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const today = () => fmtDate(new Date());

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const calc = crypto.scryptSync(password, parts[0], 64);
  const expected = Buffer.from(parts[1], 'hex');
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }

async function createSession(userId) {
  const token = newToken();
  await db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId]);
  return token;
}
async function getUserByToken(token) {
  if (!token) return null;
  return db.get(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    [token]
  );
}
function getToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}function isUsableIPv4(addr) {
  if (!addr) return false;
  const parts = String(addr).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  if (parts[0] === 169 && parts[1] === 254) return false; // 链路本地地址
  if (parts[0] === 127) return false; // 回环地址
  return true;
}

async function getLanIP() {
  try {
    const ip = await new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      let done = false;
      const finish = (addr) => {
        if (done) return;
        done = true;
        try { socket.close(); } catch { /* ignore */ }
        resolve(addr);
      };
      socket.once('error', () => finish(null));
      socket.connect(80, '8.8.8.8', () => finish(socket.address().address));
      setTimeout(() => finish(null), 2000);
    });
    if (isUsableIPv4(ip)) return ip;
  } catch { /* 回退到网卡扫描 */ }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && isUsableIPv4(net.address)) return net.address;
    }
  }
  return '127.0.0.1';
}

async function listHabits(userId) {
  const rows = await db.all(
    `SELECT h.id, h.name, h.sort_order,
            (SELECT COUNT(*) FROM checkins c WHERE c.habit_id = h.id AND c.date = ?) AS doneToday
     FROM habits h WHERE h.user_id = ? ORDER BY h.sort_order, h.id`,
    [today(), userId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, sort_order: r.sort_order, doneToday: !!r.doneToday }));
}

async function getStats(userId) {
  const totalRow = await db.get('SELECT COUNT(*) AS c FROM habits WHERE user_id = ?', [userId]);
  const total = Number(totalRow.c);
  const rows = await db.all(
    'SELECT date, COUNT(*) AS c FROM checkins WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?) GROUP BY date',
    [userId]
  );
  const doneByDate = new Map(rows.map((r) => [r.date, Number(r.c)]));
  const t = today();
  const history = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = fmtDate(d);
    history.push({ date: ds, done: doneByDate.get(ds) ?? 0, total });
  }
  let streak = 0;
  if (total > 0) {
    const cursor = new Date(now);
    if ((doneByDate.get(t) ?? 0) < total) cursor.setDate(cursor.getDate() - 1);
    while ((doneByDate.get(fmtDate(cursor)) ?? 0) >= total) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }
  return { today: { done: doneByDate.get(t) ?? 0, total }, streak, history };
}// ---------- 校验与 HTTP 工具 ----------
function validateUsername(raw) {
  if (typeof raw !== 'string') return { error: '用户名格式不正确' };
  const username = raw.trim();
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/.test(username)) {
    return { error: '用户名需为 2-20 位中文、字母、数字、下划线或短横线' };
  }
  return { username };
}
function validatePassword(raw) {
  if (typeof raw !== 'string' || raw.length < 6 || raw.length > 64) {
    return { error: '密码需为 6-64 位字符' };
  }
  return { ok: true };
}
function parseName(raw) {
  if (typeof raw !== 'string') return { error: '习惯名格式不正确' };
  const name = raw.trim();
  if (!name) return { error: '习惯名不能为空' };
  if (name.length > 30) return { error: '习惯名不能超过30个字' };
  return { name };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 20 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}// ---------- API 路由 ----------
async function handleApi(req, res, path) {
  // 注册
  if (req.method === 'POST' && path === '/api/register') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJSON(res, 400, { error: '请求格式不正确' }); }
    const u = validateUsername(body.username);
    if (u.error) return sendJSON(res, 400, { error: u.error });
    const p = validatePassword(body.password);
    if (p.error) return sendJSON(res, 400, { error: p.error });
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [u.username]);
    if (existing) return sendJSON(res, 409, { error: '用户名已被注册' });
    const info = await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [u.username, hashPassword(body.password)]);
    const userId = Number(info.lastInsertRowid);
    const token = await createSession(userId);
    return sendJSON(res, 201, { token, user: { id: userId, username: u.username } });
  }

  // 登录
  if (req.method === 'POST' && path === '/api/login') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJSON(res, 400, { error: '请求格式不正确' }); }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return sendJSON(res, 400, { error: '请输入用户名和密码' });
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return sendJSON(res, 401, { error: '用户名或密码错误' });
    }
    const token = await createSession(user.id);
    return sendJSON(res, 200, { token, user: { id: user.id, username: user.username } });
  }

  // 退出登录
  if (req.method === 'POST' && path === '/api/logout') {
    const token = getToken(req);
    if (token) await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return sendJSON(res, 200, { ok: true });
  }

  // 当前用户（同时用于前端判断登录态）
  if (req.method === 'GET' && path === '/api/me') {
    const user = await getUserByToken(getToken(req));
    if (!user) return sendJSON(res, 401, { error: '请先登录' });
    return sendJSON(res, 200, user);
  }  // 站点信息（公开，也用于 UptimeRobot 保活）
  if (req.method === 'GET' && path === '/api/info') {
    const lan = await getLanIP();
    return sendJSON(res, 200, {
      port: PORT,
      lanUrl: `http://${lan}:${PORT}`,
      localUrl: `http://localhost:${PORT}`,
      mode: USE_TURSO ? 'cloud' : 'local',
    });
  }
  // 需要登录的接口：先校验登录态
  const user = await getUserByToken(getToken(req));
  if (!user) return sendJSON(res, 401, { error: '请先登录' });

  // 习惯列表
  if (req.method === 'GET' && path === '/api/habits') {
    return sendJSON(res, 200, await listHabits(user.id));
  }

  // 新增习惯
  if (req.method === 'POST' && path === '/api/habits') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJSON(res, 400, { error: '请求格式不正确' }); }
    const { name, error } = parseName(body.name);
    if (error) return sendJSON(res, 400, { error });
    const next = await db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM habits WHERE user_id = ?', [user.id]);
    const info = await db.run('INSERT INTO habits (user_id, name, sort_order) VALUES (?, ?, ?)', [user.id, name, Number(next.n)]);
    return sendJSON(res, 201, { id: Number(info.lastInsertRowid), name, sort_order: Number(next.n), doneToday: false });
  }

  const m = path.match(/^\/api\/habits\/(\d+)(?:\/(\w+))?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2] || '';

    // 改名
    if (req.method === 'PUT' && !action) {
      let body;
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJSON(res, 400, { error: '请求格式不正确' }); }
      const { name, error } = parseName(body.name);
      if (error) return sendJSON(res, 400, { error });
      const info = await db.run('UPDATE habits SET name = ? WHERE id = ? AND user_id = ?', [name, id, user.id]);
      if (info.changes === 0) return sendJSON(res, 404, { error: '习惯不存在' });
      return sendJSON(res, 200, { id, name, sort_order: (await db.get('SELECT sort_order FROM habits WHERE id = ?', [id])).sort_order });
    }

    // 删除
    if (req.method === 'DELETE' && !action) {
      const info = await db.run('DELETE FROM habits WHERE id = ? AND user_id = ?', [id, user.id]);
      if (info.changes === 0) return sendJSON(res, 404, { error: '习惯不存在' });
      return sendJSON(res, 200, { ok: true });
    }

    // 打卡 / 取消打卡
    if (req.method === 'POST' && action === 'toggle') {
      const habit = await db.get('SELECT id FROM habits WHERE id = ? AND user_id = ?', [id, user.id]);
      if (!habit) return sendJSON(res, 404, { error: '习惯不存在' });
      const d = today();
      const existing = await db.get('SELECT id FROM checkins WHERE habit_id = ? AND date = ?', [id, d]);
      if (existing) await db.run('DELETE FROM checkins WHERE habit_id = ? AND date = ?', [id, d]);
      else await db.run('INSERT INTO checkins (habit_id, date) VALUES (?, ?)', [id, d]);
      return sendJSON(res, 200, { doneToday: !existing, stats: await getStats(user.id) });
    }
  }

  // 今日统计
  if (req.method === 'GET' && path === '/api/stats') {
    return sendJSON(res, 200, await getStats(user.id));
  }  // AI 周总结（DeepSeek）
  if (req.method === 'POST' && path === '/api/ai/weekly') {
    if (!DEEPSEEK_API_KEY) return sendJSON(res, 503, { error: '服务器未配置 DEEPSEEK_API_KEY' });
    try {
      const stats = await getStats(user.id);
      const nameRows = await db.all('SELECT name FROM habits WHERE user_id = ? ORDER BY sort_order', [user.id]);
      const names = nameRows.map((r) => r.name).join('、') || '（还没有习惯）';
      const historyText = stats.history.map((d) => `${d.date} 完成 ${d.done}/${d.total}`).join('；');
      const prompt = '你是习惯养成教练。以下是某用户最近 7 天的打卡数据：\n'
        + `习惯：${names}\n`
        + `最近 7 天完成情况：${historyText}\n`
        + '请用 1-3 句中文给出简短鼓励与建议，语气温暖、口语化，不要用列表，不要重复数据。';
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 200,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error('DeepSeek API error:', resp.status, errText.slice(0, 200));
        return sendJSON(res, 502, { error: 'AI 服务暂时不可用，请稍后再试' });
      }
      const data = await resp.json();
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) return sendJSON(res, 502, { error: 'AI 返回内容为空' });
      return sendJSON(res, 200, { summary: String(text).trim() });
    } catch (err) {
      console.error('AI weekly error:', err);
      return sendJSON(res, 502, { error: 'AI 服务暂时不可用，请稍后再试' });
    }
  }

  sendJSON(res, 404, { error: '接口不存在' });
}// ---------- 静态文件 ----------
async function serveStatic(res, path) {
  if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(path); } catch { res.writeHead(400); return res.end('Bad Request'); }
  if (rel.includes('\0')) { res.writeHead(400); return res.end('Bad Request'); }
  let filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    if (path === '/') filePath = join(PUBLIC_DIR, 'index.html');
    else { res.writeHead(404); return res.end('Not Found'); }
  }
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const content = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': content.length });
  res.end(content);
}

// ---------- 启动 ----------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    await serveStatic(res, url.pathname);
  } catch (err) {
    if (!res.headersSent) sendJSON(res, 500, { error: '服务器内部错误' });
    console.error(err);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  [错误] 端口 ${PORT} 已被占用，无法启动服务。`);
    console.error(`  请关闭占用该端口的程序后重试；`);
    console.error(`  或换一个端口启动：先执行  set PORT=4322  再运行  node server.js`);
    console.error('');
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', async () => {
  const lan = await getLanIP();
  console.log('');
  console.log('  ── 习惯打卡 · 多用户在线版 已启动 ──');
  console.log(`  数据模式：${USE_TURSO ? 'Turso 云数据库' : '本地 SQLite（data/habits.db）'}`);
  console.log(`  本机访问： http://localhost:${PORT}`);
  console.log(`  局域网：  http://${lan}:${PORT}  （手机需连同一 Wi-Fi）`);
  console.log(`  AI 周总结：${DEEPSEEK_API_KEY ? '已启用' : '未配置 DEEPSEEK_API_KEY（可后补）'}`);
  console.log('  按 Ctrl+C 停止服务。');
  console.log('');
  if (OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  }
});