'use strict';
// Trang cung cấp địa chỉ IP mạng LAN để kết nối máy chủ LAN Chat
// (https://github.com/Thanhesssd/hethongungdungchatbaomat-kysopdf).
//   /         đăng ký, đăng nhập; người đã được cấp quyền thấy địa chỉ IP, mã QR
//   /quan-ly  quản trị: cấp quyền tài khoản, quản lý mạng LAN
// Chỉ dùng Node.js có sẵn, không cần cài thư viện.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = process.env.LAN_DATA || path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(DATA, 'config.json');
const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const SESSION_DAYS = 30;
fs.mkdirSync(DATA, { recursive: true });

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function log(line) {
  console.log(line);
  try { fs.appendFileSync(path.join(DATA, 'server.log'), `${new Date().toLocaleString('vi-VN')}  ${line}\n`); } catch { }
}

// ---------- Cấu hình ----------
const saved = readJson(CONFIG_FILE, {});
const config = {
  port: 3000,
  title: 'Kết nối máy chủ LAN',
  ...saved,
  lanchat: { url: 'http://localhost:8000', ...(saved.lanchat || {}) },
};
for (const k of ['shopName', 'bank', 'adminPin', 'setupCode']) delete config[k];
for (const k of ['name', 'password', 'enabled']) delete config.lanchat[k];
config.extraServers = Array.isArray(config.extraServers) ? config.extraServers.filter(s => s && s.id && s.url) : [];
writeJson(CONFIG_FILE, config);
const PORT = +process.env.PORT || config.port;
if (process.env.LANCHAT_URL) config.lanchat.url = process.env.LANCHAT_URL;

// ---------- Tài khoản ----------
const db = readJson(USERS_FILE, { seq: 0, users: [] });
db.invites ||= []; // link mời: { token, name, createdBy, createdAt, exp, usedBy, usedAt }
const saveUsers = () => writeJson(USERS_FILE, db);
const INVITE_DAYS = 7;
const findInvite = token => db.invites.find(i => i.token === String(token) && !i.usedBy && i.exp > Date.now());
const sessions = new Map(Object.entries(readJson(SESSIONS_FILE, {})).filter(([, s]) => s.exp > Date.now()));
const saveSessions = () => writeJson(SESSIONS_FILE, Object.fromEntries(sessions));
const STATUS = { pending: 'Chờ cấp quyền', approved: 'Đã cấp quyền', blocked: 'Bị chặn' };

const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 32).toString('hex');
const tokenKey = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const hasAdmin = () => db.users.some(u => u.role === 'admin' && u.status === 'approved');
// "Nguyễn Duy Thanh" -> "nguyen.duy.thanh": bỏ dấu, chữ thường, dấu cách thành dấu chấm (giống trang đăng ký)
const normUsername = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().trim().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '');
const findUser = username => db.users.find(u => u.username === normUsername(username));

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, status: u.status, statusLabel: STATUS[u.status],
    createdAt: u.createdAt, lastSeen: u.lastSeen, lastIp: u.lastIp, device: u.device, approvedBy: u.approvedBy, approvedAt: u.approvedAt,
    mustChange: !!u.mustChange, passwordChangedAt: u.passwordChangedAt || null };
}

function setPassword(u, password) {
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPassword(password, u.salt);
  u.passwordChangedAt = Date.now();
}
// Mật khẩu tạm dễ đọc qua điện thoại: bỏ các ký tự dễ nhầm (0/O, 1/l/I)
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join('').replace(/(.{5})(.{5})/, '$1-$2');
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = cookies(req).sid;
  if (!token) return null;
  const s = sessions.get(tokenKey(token));
  if (!s || s.exp < Date.now()) return null;
  return db.users.find(u => u.id === s.uid) || null;
}

function touch(u, req) {
  u.lastSeen = Date.now();
  u.lastIp = clientIp(req);
  u.device = deviceName(req.headers['user-agent']);
}

function startSession(res, u) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(tokenKey(token), { uid: u.id, exp: Date.now() + SESSION_DAYS * 864e5 });
  saveSessions();
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function endSessions(uid) {
  for (const [k, s] of sessions) if (s.uid === uid) sessions.delete(k);
  saveSessions();
}

// Chống dò mật khẩu và đăng ký hàng loạt
const fails = new Map();
const signups = new Map();
function locked(key) {
  const f = fails.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function failed(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  fails.set(key, f.n + 1 >= 5 ? { n: 0, until: Date.now() + 60000 } : { n: f.n + 1, until: 0 });
}

// ---------- Mạng LAN ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const virtual = /vmware|virtualbox|vbox|hyper-v|vethernet|wsl|docker|loopback/i.test(name);
      out.push({ iface: name, ip: a.address, netmask: a.netmask, mac: a.mac, virtual });
    }
  }
  return out.sort((a, b) => a.virtual - b.virtual);
}

function deviceName(ua = '') {
  const osName = [['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Android', 'Android'], ['Windows', 'Windows'], ['Mac OS', 'macOS'], ['Linux', 'Linux']].find(([k]) => ua.includes(k))?.[1] || 'Thiết bị';
  const browser = [['Edg/', 'Edge'], ['CriOS', 'Chrome'], ['Chrome/', 'Chrome'], ['Firefox/', 'Firefox'], ['Safari/', 'Safari']].find(([k]) => ua.includes(k))?.[1] || 'trình duyệt';
  return `${osName} · ${browser}`;
}
const socketIp = req => (req.socket.remoteAddress || '').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
// Qua đường hầm Cloudflare mọi kết nối đều đến từ 127.0.0.1; địa chỉ thật của khách nằm trong header CF-Connecting-IP
const viaTunnel = req => socketIp(req) === '127.0.0.1' && !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
const clientIp = req => viaTunnel(req) ? String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']).split(',')[0].trim() : socketIp(req);
// Yêu cầu đến từ chính máy chủ (localhost hoặc IP của máy này), không phải khách đi qua đường hầm Internet
const onServer = req => { if (viaTunnel(req)) return false; const ip = socketIp(req); return ip === '127.0.0.1' || lanAddresses().some(a => a.ip === ip); };

function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = (/localhost|127\.0\.0\.1|:8000\b/.test(u) ? 'http://' : 'https://') + u;
  return u.replace(/\/+$/, '');
}

// Đọc /api/health của máy chủ LAN Chat. Đây là thông tin công khai (địa chỉ, cổng),
// máy chủ dùng chứng chỉ tự cấp nên chỉ ở bước đọc này mới bỏ qua kiểm tra chứng chỉ.
function getHealth(base, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/health', normUrl(base) + '/');
    const req = (url.protocol === 'https:' ? https : http).get(url, { timeout, rejectUnauthorized: false }, res => {
      let s = '';
      res.on('data', c => { s += c; if (s.length > 20000) req.destroy(); });
      res.on('end', () => {
        try {
          const d = JSON.parse(s);
          if (res.statusCode === 200 && d.ok && d.port) resolve(d); else reject(new Error('Không phải máy chủ LAN Chat'));
        } catch { reject(new Error('Không phải máy chủ LAN Chat')); }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Không phản hồi'), { code: 'TIMEOUT' })));
    req.on('error', reject);
  });
}

async function checkOne(url) {
  try { return { ok: true, at: Date.now(), ...(await getHealth(url)) }; }
  catch (e) {
    const error = e.code === 'ECONNREFUSED' ? 'Máy chủ LAN Chat chưa chạy hoặc sai địa chỉ'
      : e.code === 'ENOTFOUND' ? 'Không tìm thấy địa chỉ này' : e.code === 'TIMEOUT' ? 'Máy chủ không phản hồi' : e.message;
    return { ok: false, at: Date.now(), error };
  }
}

// Máy chủ chính (config.lanchat) và các máy chủ phụ (config.extraServers: máy chủ thứ hai, thứ ba…)
let chat = { ok: false, at: 0, error: 'Chưa kiểm tra' };
const extraState = {}; // id máy chủ phụ -> kết quả kiểm tra
async function checkChat() {
  const [main, ...extras] = await Promise.all([checkOne(config.lanchat.url), ...config.extraServers.map(s => checkOne(s.url))]);
  chat = main;
  config.extraServers.forEach((s, i) => { extraState[s.id] = extras[i]; });
  pushInfo();
  pushAdmin();
}
setInterval(checkChat, 15000);

function serversView() {
  // id = mã trong danh sách (để xóa); serverId = mã máy chủ LAN Chat báo về (để nhận ra hai địa chỉ cùng một máy)
  return config.extraServers.map(s => {
    const st = extraState[s.id] || { ok: false, at: 0, error: 'Chưa kiểm tra' };
    return { ...st, serverId: st.id || null, id: s.id, name: s.name, url: s.url };
  });
}

function addressesOf(state, server) {
  if (!state.ok) return [];
  const list = (state.lan || []).map(hp => ({ kind: 'lan', url: `https://${hp}/`, host: hp, server }));
  if (state.public) list.push({ kind: 'public', url: state.public.replace(/\/?$/, '/'), host: state.public.replace(/^https?:\/\//, ''), server });
  return list;
}

function connectAddresses() {
  const list = addressesOf(chat, 'Máy chủ 1');
  // Máy chủ phụ trùng mã với máy chủ chính (cùng một máy, khác địa chỉ) thì không liệt kê lại
  const seen = new Set(chat.ok && chat.id ? [chat.id] : []);
  for (const s of serversView()) {
    if (s.ok && s.serverId && seen.has(s.serverId)) continue;
    if (s.ok && s.serverId) seen.add(s.serverId);
    list.push(...addressesOf(s, s.name));
  }
  // Link Internet lên đầu (thiết bị ở mạng nào cũng vào được), rồi Wi‑Fi/LAN thật, card mạng ảo (VMware, Hyper‑V…) cuối cùng
  const virt = new Set(lanAddresses().filter(a => a.virtual).map(a => a.ip));
  const rank = a => a.kind === 'public' ? 0 : virt.has(a.host.split(':')[0]) ? 2 : 1;
  return list.sort((a, b) => rank(a) - rank(b));
}

function info() {
  const extras = serversView();
  const ok = chat.ok || extras.some(s => s.ok);
  return { title: config.title, ok, error: ok ? null : chat.error, checkedAt: chat.at, id: chat.id || null, addresses: connectAddresses(),
    servers: [{ name: 'Máy chủ 1', ok: chat.ok }, ...extras.map(s => ({ name: s.name, ok: s.ok }))] };
}

// ---------- Kết nối thời gian thực (Server-Sent Events) ----------
const clients = new Set(); // { res, uid, ip, device, since }
const send = (c, event, data) => c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);
const userOf = c => db.users.find(u => u.id === c.uid);
const isAdmin = u => u && u.role === 'admin' && u.status === 'approved';

const canSee = u => u && u.status === 'approved' && !u.mustChange;
function pushInfo() { for (const c of clients) if (canSee(userOf(c))) send(c, 'info', info()); }
function pushAdmin() { const d = adminData(); for (const c of clients) if (isAdmin(userOf(c))) send(c, 'admin', d); }
function pushMe(uid) {
  for (const c of clients) {
    if (c.uid !== uid) continue;
    const u = userOf(c);
    send(c, 'me', u ? publicUser(u) : null);
    if (canSee(u)) send(c, 'info', info());
  }
}

function networkInfo() {
  return {
    hostname: os.hostname(), port: PORT, uptime: Math.round(process.uptime()), addresses: lanAddresses(), publicUrl: publicUrl(),
    devices: [...clients].map(c => ({ user: userOf(c)?.name || '—', username: userOf(c)?.username, ip: c.ip, device: c.device, since: c.since })),
    lanchat: { url: config.lanchat.url, ...chat }, servers: serversView(), connect: connectAddresses(),
  };
}
// Link mời dùng IP Wi‑Fi/LAN thật của máy này, để máy khác trong mạng mở được
// Link Internet do chia-se-internet.bat ghi ra (đường hầm Cloudflare), nếu đang bật
const PUBLIC_URL_FILE = path.join(DATA, 'public_url.txt');
function publicUrl() {
  try { return fs.readFileSync(PUBLIC_URL_FILE, 'utf8').trim().replace(/\/+$/, '') || null; } catch { return null; }
}
function inviteUrl(token) {
  const pub = publicUrl();
  if (pub) return `${pub}/?moi=${token}`;
  const a = lanAddresses()[0];
  return `http://${a ? a.ip : 'localhost'}:${PORT}/?moi=${token}`;
}
function invitesView() {
  return db.invites.filter(i => !i.usedBy && i.exp > Date.now()).sort((a, b) => b.createdAt - a.createdAt)
    .map(i => ({ token: i.token, name: i.name, createdBy: i.createdBy, createdAt: i.createdAt, exp: i.exp, url: inviteUrl(i.token) }));
}
function adminData() { return { title: config.title, network: networkInfo(), users: db.users.map(publicUser), invites: invitesView(), statuses: STATUS }; }

// ---------- Tự tìm máy chủ LAN Chat trong mạng LAN (quét cổng 8443 trong dải /24) ----------
let scanning = null;
async function scanLan(port = 8443) {
  if (scanning) return scanning;
  scanning = (async () => {
    const targets = new Set();
    for (const a of lanAddresses()) {
      const p = a.ip.split('.');
      for (let i = 1; i < 255; i++) targets.add(`${p[0]}.${p[1]}.${p[2]}.${i}`);
    }
    const queue = [...targets], found = [];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const ip = queue.shift();
        try {
          const h = await getHealth(`https://${ip}:${port}`, 900);
          if (!found.some(f => f.id === h.id)) found.push({ id: h.id, url: `https://${ip}:${port}`, lan: h.lan, public: h.public });
        } catch { }
        if (++done % 50 === 0) for (const c of clients) if (isAdmin(userOf(c))) send(c, 'scan', { done, total: targets.size });
      }
    };
    await Promise.all(Array.from({ length: 64 }, worker));
    return { found, total: targets.size };
  })();
  try { return await scanning; } finally { scanning = null; }
}

// ---------- HTTP ----------
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 20000) { reject(new Error('Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Dữ liệu không hợp lệ')); } });
    req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PAGES = { '/': 'index.html', '/quan-ly': 'quan-ly.html' };
function serveStatic(res, urlPath) {
  const full = path.join(PUBLIC, PAGES[urlPath] || urlPath.replace(/^\/+/, ''));
  if (!full.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(full)] || !fs.existsSync(full)) return json(res, { error: 'Không tìm thấy trang' }, 404);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)], 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const me = currentUser(req);

  // Trang GitHub (github.io) hỏi xem app có đang chạy thật không. Trang lỗi 1033 của Cloudflare không có header này,
  // nên trình duyệt chặn và trang GitHub biết là máy chủ tắt, thay vì chuyển người dùng tới trang lỗi.
  if (req.method === 'GET' && p === '/api/ping') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return json(res, { ok: true, app: 'ket-noi-may-chu-lan', title: config.title });
  }

  // Chặn trang khác gửi yêu cầu thay người dùng (cookie đi kèm): chỉ nhận POST từ chính trang này
  if (req.method === 'POST') {
    let host = req.headers.host;
    try { if (req.headers.origin) host = new URL(req.headers.origin).host; } catch { host = null; }
    if (host !== req.headers.host) return json(res, { error: 'Yêu cầu không hợp lệ' }, 403);
  }

  // ----- Tài khoản -----
  if (req.method === 'GET' && p === '/api/auth/me') {
    if (me) { touch(me, req); saveUsers(); }
    return json(res, { user: me ? publicUser(me) : null, needSetup: !hasAdmin(), onServer: onServer(req), title: config.title });
  }

  if (req.method === 'POST' && p === '/api/auth/register') {
    const b = await readBody(req);
    const username = normUsername(b.username);
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const password = String(b.password || '');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json(res, { error: 'Tên đăng nhập 3–32 ký tự: chữ không dấu, số, dấu . _ -', field: 'username' }, 400);
    if (name.length < 2 || name.length > 60) return json(res, { error: 'Họ tên cần 2–60 ký tự', field: 'name' }, 400);
    if (password.length < 6 || password.length > 200) return json(res, { error: 'Mật khẩu cần ít nhất 6 ký tự', field: 'password' }, 400);
    const ip = clientIp(req), now = Date.now();
    const recent = (signups.get(ip) || []).filter(t => now - t < 3600e3);
    if (recent.length >= 10) return json(res, { error: 'Máy này đã đăng ký nhiều tài khoản. Hãy thử lại sau' }, 429);
    if (findUser(username)) return json(res, { error: 'Tên đăng nhập này đã có người dùng', field: 'username' }, 409);
    const first = !hasAdmin();
    // Tài khoản đầu tiên là quản trị: chỉ tạo được trên chính máy chủ, để người khác trong mạng không chiếm quyền
    if (first && !onServer(req)) return json(res, { error: `Chưa có quản trị viên. Hãy tạo tài khoản quản trị trên chính máy chủ: http://localhost:${PORT}/` }, 403);
    // Đăng ký bằng link mời của quản trị viên: được cấp quyền ngay, link chỉ dùng một lần
    const inv = !first && b.invite ? findInvite(b.invite) : null;
    if (b.invite && !first && !inv) return json(res, { error: 'Link mời đã hết hạn hoặc đã được dùng. Hãy xin quản trị viên link mới' }, 410);
    signups.set(ip, [...recent, now]);
    const salt = crypto.randomBytes(16).toString('hex');
    const approved = first || !!inv;
    const u = { id: ++db.seq, username, name, salt, hash: hashPassword(password, salt), role: first ? 'admin' : 'user',
      status: approved ? 'approved' : 'pending', createdAt: now, approvedAt: approved ? now : null,
      approvedBy: first ? 'Tự động (quản trị đầu tiên)' : inv ? `Link mời của ${inv.createdBy}` : null };
    touch(u, req);
    db.users.push(u);
    if (inv) { inv.usedBy = username; inv.usedAt = now; }
    saveUsers();
    startSession(res, u);
    log(`Đăng ký: ${username} (${name}) từ ${ip}${first ? ' · quản trị' : inv ? ' · cấp quyền qua link mời' : ' · chờ cấp quyền'}`);
    pushAdmin();
    return json(res, { user: publicUser(u) });
  }

  if (req.method === 'POST' && p === '/api/auth/login') {
    const b = await readBody(req);
    const key = 'login:' + clientIp(req) + ':' + normUsername(b.username);
    if (locked(key)) return json(res, { error: `Sai mật khẩu nhiều lần. Thử lại sau ${locked(key)} giây`, wait: locked(key) }, 429);
    const u = findUser(b.username);
    const ok = u && crypto.timingSafeEqual(Buffer.from(u.hash, 'hex'), Buffer.from(hashPassword(b.password || '', u.salt), 'hex'));
    if (!ok) { failed(key); return json(res, { error: 'Sai tên đăng nhập hoặc mật khẩu' }, 401); }
    fails.delete(key);
    if (u.status === 'blocked') return json(res, { error: 'Tài khoản này đã bị chặn. Liên hệ quản trị viên' }, 403);
    touch(u, req);
    saveUsers();
    startSession(res, u);
    pushAdmin();
    return json(res, { user: publicUser(u) });
  }

  // Tự đổi mật khẩu (cả khi vừa đăng nhập bằng mật khẩu tạm do quản trị viên đặt lại)
  if (req.method === 'POST' && p === '/api/auth/password') {
    if (!me) return json(res, { error: 'Cần đăng nhập' }, 401);
    const b = await readBody(req);
    const key = 'pass:' + me.id;
    if (locked(key)) return json(res, { error: `Sai mật khẩu hiện tại nhiều lần. Thử lại sau ${locked(key)} giây` }, 429);
    const ok = crypto.timingSafeEqual(Buffer.from(me.hash, 'hex'), Buffer.from(hashPassword(b.current || '', me.salt), 'hex'));
    if (!ok) { failed(key); return json(res, { error: 'Mật khẩu hiện tại không đúng', field: 'current' }, 403); }
    const next = String(b.next || '');
    if (next.length < 6 || next.length > 200) return json(res, { error: 'Mật khẩu mới cần ít nhất 6 ký tự', field: 'next' }, 400);
    if (next === b.current) return json(res, { error: 'Mật khẩu mới phải khác mật khẩu hiện tại', field: 'next' }, 400);
    fails.delete(key);
    setPassword(me, next);
    delete me.mustChange;
    // Đăng xuất các máy khác (có thể đang dùng mật khẩu cũ), giữ phiên ở máy này
    endSessions(me.id);
    startSession(res, me);
    saveUsers();
    log(`${me.username} đã đổi mật khẩu`);
    pushAdmin();
    return json(res, { user: publicUser(me) });
  }

  if (req.method === 'POST' && p === '/api/auth/logout') {
    const token = cookies(req).sid;
    if (token) { sessions.delete(tokenKey(token)); saveSessions(); }
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(res, { ok: true });
  }

  // Người được mời mở link: chỉ cho biết tên được mời, không lộ gì khác
  if (req.method === 'GET' && p === '/api/invite') {
    const inv = findInvite(url.searchParams.get('t'));
    return inv ? json(res, { name: inv.name, createdBy: inv.createdBy }) : json(res, { error: 'Link mời đã hết hạn hoặc đã được dùng' }, 404);
  }

  // ----- Thời gian thực -----
  if (req.method === 'GET' && p === '/api/events') {
    if (!me || me.status === 'blocked') return json(res, { error: 'Cần đăng nhập' }, 401);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const c = { res, uid: me.id, ip: clientIp(req), device: deviceName(req.headers['user-agent']), since: Date.now() };
    clients.add(c);
    send(c, 'me', publicUser(me));
    if (canSee(me)) send(c, 'info', info());
    if (isAdmin(me)) send(c, 'admin', adminData());
    pushAdmin();
    req.on('close', () => { clients.delete(c); pushAdmin(); });
    return;
  }

  // ----- Địa chỉ IP: chỉ tài khoản đã được cấp quyền -----
  if (req.method === 'GET' && p === '/api/info') {
    if (!me) return json(res, { error: 'Cần đăng nhập' }, 401);
    if (me.status !== 'approved') return json(res, { error: 'Tài khoản chưa được cấp quyền xem địa chỉ IP' }, 403);
    if (me.mustChange) return json(res, { error: 'Hãy đổi mật khẩu tạm trước khi xem địa chỉ IP' }, 403);
    return json(res, info());
  }

  // ----- Quản trị -----
  if (p.startsWith('/api/admin/')) {
    if (!me) return json(res, { error: 'Cần đăng nhập' }, 401);
    if (!isAdmin(me)) return json(res, { error: 'Chỉ quản trị viên được vào trang này' }, 403);

    if (req.method === 'GET' && p === '/api/admin/data') return json(res, adminData());
    if (req.method === 'POST' && p === '/api/admin/check') { await checkChat(); return json(res, adminData()); }
    if (req.method === 'POST' && p === '/api/admin/scan') return json(res, await scanLan());

    if (req.method === 'POST' && p === '/api/admin/invites') {
      const b = await readBody(req);
      const name = String(b.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 60) return json(res, { error: 'Nhập tên người được mời (2–60 ký tự)' }, 400);
      if (db.invites.filter(i => !i.usedBy && i.exp > Date.now()).length >= 100) return json(res, { error: 'Đã có quá nhiều link mời chưa dùng. Hãy hủy bớt' }, 400);
      const inv = { token: crypto.randomBytes(16).toString('base64url'), name, createdBy: me.name, createdAt: Date.now(), exp: Date.now() + INVITE_DAYS * 864e5 };
      // Dọn link đã dùng hoặc hết hạn quá 30 ngày
      db.invites = db.invites.filter(i => Date.now() - (i.usedAt || i.exp) < 30 * 864e5);
      db.invites.push(inv);
      saveUsers();
      log(`${me.username}: tạo link mời cho "${name}"`);
      pushAdmin();
      return json(res, { ...adminData(), created: { name, url: inviteUrl(inv.token) } });
    }

    if (req.method === 'POST' && p === '/api/admin/invites/cancel') {
      const b = await readBody(req);
      db.invites = db.invites.filter(i => i.token !== String(b.token));
      saveUsers();
      pushAdmin();
      return json(res, adminData());
    }

    // Hay nhập nhầm link của chính app này (link mời, link trycloudflare, cổng 3000) vào ô máy chủ LAN Chat
    const badLanchatUrl = u => {
      let parsed;
      try { parsed = new URL(u); } catch { return 'Địa chỉ không hợp lệ'; }
      const own = new Set(['localhost', '127.0.0.1', ...lanAddresses().map(a => a.ip)]);
      const pub = publicUrl();
      if (parsed.searchParams.has('moi') || (pub && parsed.host === new URL(pub).host)
        || (own.has(parsed.hostname) && +(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) === PORT)) {
        return 'Đây là link của chính trang đăng ký này, không phải máy chủ LAN Chat. Cùng máy thì nhập http://localhost:8000, khác máy thì nhập IP:8443 (hoặc bấm Bắt đầu quét)';
      }
      return null;
    };

    // Thêm / xóa máy chủ LAN Chat phụ (máy chủ thứ hai, thứ ba…)
    if (req.method === 'POST' && p === '/api/admin/servers') {
      const b = await readBody(req);
      const u = normUrl(b.url);
      const bad = badLanchatUrl(u);
      if (bad) return json(res, { error: bad }, 400);
      if (u === normUrl(config.lanchat.url) || config.extraServers.some(s => normUrl(s.url) === u)) return json(res, { error: 'Máy chủ này đã có trong danh sách' }, 409);
      if (config.extraServers.length >= 10) return json(res, { error: 'Tối đa 10 máy chủ phụ' }, 400);
      const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) || `Máy chủ ${config.extraServers.length + 2}`;
      config.extraServers.push({ id: crypto.randomBytes(6).toString('hex'), name, url: u });
      writeJson(CONFIG_FILE, config);
      log(`${me.username}: thêm máy chủ "${name}" ${u}`);
      await checkChat();
      return json(res, adminData());
    }
    if (req.method === 'POST' && p === '/api/admin/servers/remove') {
      const b = await readBody(req);
      const s = config.extraServers.find(x => x.id === String(b.id));
      if (!s) return json(res, { error: 'Không tìm thấy máy chủ' }, 404);
      config.extraServers = config.extraServers.filter(x => x !== s);
      delete extraState[s.id];
      writeJson(CONFIG_FILE, config);
      log(`${me.username}: xóa máy chủ "${s.name}"`);
      pushInfo();
      pushAdmin();
      return json(res, adminData());
    }

    if (req.method === 'POST' && p === '/api/admin/config') {
      const b = await readBody(req);
      const u = normUrl(b.url);
      const bad = badLanchatUrl(u);
      if (bad) return json(res, { error: bad }, 400);
      const title = String(b.title || '').trim().slice(0, 60);
      config.lanchat.url = u;
      if (title) config.title = title;
      writeJson(CONFIG_FILE, config);
      await checkChat();
      return json(res, adminData());
    }

    const m = p.match(/^\/api\/admin\/users\/(\d+)$/);
    if (req.method === 'POST' && m) {
      const b = await readBody(req);
      const u = db.users.find(x => x.id === +m[1]);
      if (!u) return json(res, { error: 'Không tìm thấy tài khoản' }, 404);
      if (u.id === me.id && b.action !== 'approve') return json(res, { error: b.action === 'reset-password'
        ? 'Tự đổi mật khẩu của mình ở trang chủ (nút Đổi mật khẩu)' : 'Không tự thu hồi, chặn hay xóa tài khoản của chính mình' }, 400);
      const admins = db.users.filter(isAdmin).length;
      let temp = null;
      switch (b.action) {
        // Người dùng quên mật khẩu: tạo mật khẩu tạm, đăng xuất mọi máy, bắt đổi ngay lần đăng nhập tới
        case 'reset-password': temp = tempPassword(); setPassword(u, temp); u.mustChange = true; endSessions(u.id); break;
        case 'approve': u.status = 'approved'; u.approvedBy = me.name; u.approvedAt = Date.now(); break;
        case 'revoke': u.status = 'pending'; break;
        case 'block': u.status = 'blocked'; endSessions(u.id); break;
        case 'make-admin': u.role = 'admin'; u.status = 'approved'; u.approvedBy ||= me.name; u.approvedAt ||= Date.now(); break;
        case 'remove-admin': if (admins <= 1 && isAdmin(u)) return json(res, { error: 'Cần giữ ít nhất một quản trị viên' }, 400); u.role = 'user'; break;
        case 'delete': db.users = db.users.filter(x => x !== u); endSessions(u.id); break;
        default: return json(res, { error: 'Thao tác không hợp lệ' }, 400);
      }
      saveUsers();
      log(`${me.username}: ${b.action} → ${u.username}`);
      pushMe(u.id);
      if (['block', 'delete', 'reset-password'].includes(b.action)) for (const c of clients) if (c.uid === u.id) c.res.end();
      pushAdmin();
      // Mật khẩu tạm chỉ trả về một lần cho quản trị viên vừa bấm, không lưu dạng đọc được
      return json(res, temp ? { ...adminData(), tempPassword: temp, tempFor: { name: u.name, username: u.username } } : adminData());
    }
  }

  if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);
  json(res, { error: 'Không tìm thấy' }, 404);
}

const server = http.createServer((req, res) => {
  route(req, res).catch(e => { if (!res.headersSent) json(res, { error: e.message || 'Lỗi máy chủ' }, 500); });
});
server.on('error', e => {
  log(e.code === 'EADDRINUSE' ? `Cổng ${PORT} đang được dùng: có thể app đã chạy ở cửa sổ khác.` : e.message);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  log(`${config.title} đang chạy:`);
  log(`  Trên máy này:  http://localhost:${PORT}/   ·   quản trị: http://localhost:${PORT}/quan-ly`);
  for (const a of lanAddresses()) log(`  ${a.virtual ? 'Card mạng ảo' : 'Mạng LAN'} (${a.iface}): http://${a.ip}:${PORT}/`);
  if (!hasAdmin()) log(`  Chưa có quản trị viên. Mở http://localhost:${PORT}/ trên máy này và đăng ký: tài khoản đầu tiên là quản trị viên`);
  else log(`  ${db.users.length} tài khoản · ${db.users.filter(u => u.status === 'pending').length} đang chờ cấp quyền`);
  log(`  Máy chủ LAN Chat: ${config.lanchat.url}`);
  checkChat();
});
