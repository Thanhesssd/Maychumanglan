'use strict';
// Trang cung cấp địa chỉ IP mạng LAN để kết nối máy chủ LAN Chat
// (https://github.com/Thanhesssd/hethongungdungchatbaomat-kysopdf).
//   /         trang kết nối: địa chỉ IP, mã QR, link cài chứng chỉ
//   /quan-ly  trang quản lý mạng LAN (có mã PIN)
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
  adminPin: String(crypto.randomInt(100000, 1000000)),
  title: 'Kết nối máy chủ LAN',
  ...saved,
  lanchat: { url: 'http://localhost:8000', ...(saved.lanchat || {}) },
};
// Bỏ các mục cũ của bản cửa hàng
for (const k of ['shopName', 'bank']) delete config[k];
delete config.lanchat.name; delete config.lanchat.password; delete config.lanchat.enabled;
writeJson(CONFIG_FILE, config);
const PORT = +process.env.PORT || config.port;
if (process.env.ADMIN_PIN) config.adminPin = process.env.ADMIN_PIN;
if (process.env.LANCHAT_URL) config.lanchat.url = process.env.LANCHAT_URL;

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
const clientIp = req => (req.socket.remoteAddress || '').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');

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

let chat = { ok: false, at: 0, error: 'Chưa kiểm tra' };
async function checkChat() {
  try { chat = { ok: true, at: Date.now(), ...(await getHealth(config.lanchat.url)) }; }
  catch (e) {
    const error = e.code === 'ECONNREFUSED' ? 'Máy chủ LAN Chat chưa chạy hoặc sai địa chỉ'
      : e.code === 'ENOTFOUND' ? 'Không tìm thấy địa chỉ này' : e.code === 'TIMEOUT' ? 'Máy chủ không phản hồi' : e.message;
    chat = { ok: false, at: Date.now(), error };
  }
  broadcast('info', publicInfo());
  broadcast('network', networkInfo(), 'admin');
}
setInterval(checkChat, 15000);

// Danh sách địa chỉ để các máy khác kết nối máy chủ LAN Chat
function connectAddresses() {
  if (!chat.ok) return [];
  const list = (chat.lan || []).map(hp => ({ kind: 'lan', url: `https://${hp}/`, host: hp }));
  if (chat.public) list.push({ kind: 'public', url: chat.public.replace(/\/?$/, '/'), host: chat.public.replace(/^https?:\/\//, '') });
  // Ưu tiên địa chỉ Wi‑Fi/LAN thật, đưa card mạng ảo (VMware, Hyper‑V…) xuống cuối
  const virt = new Set(lanAddresses().filter(a => a.virtual).map(a => a.ip));
  return list.sort((a, b) => virt.has(a.host.split(':')[0]) - virt.has(b.host.split(':')[0]));
}

function publicInfo() {
  return { title: config.title, ok: chat.ok, error: chat.ok ? null : chat.error, checkedAt: chat.at, id: chat.id || null, addresses: connectAddresses() };
}

// ---------- Kết nối thời gian thực (Server-Sent Events) ----------
const clients = new Set();
const send = (c, event, data) => c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function broadcast(event, data, role) { for (const c of clients) if (!role || c.role === role) send(c, event, data); }
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);

function networkInfo() {
  return {
    hostname: os.hostname(), port: PORT, uptime: Math.round(process.uptime()), addresses: lanAddresses(),
    devices: [...clients].map(c => ({ role: c.role, ip: c.ip, device: c.device, since: c.since })),
    lanchat: { url: config.lanchat.url, ...chat }, connect: connectAddresses(),
  };
}

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
        if (++done % 50 === 0) broadcast('scan', { done, total: targets.size }, 'admin');
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

// Chống đoán mã PIN quản lý
const fails = new Map();
function pinOk(req, pin) {
  const ip = clientIp(req);
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return { locked: Math.ceil((f.until - Date.now()) / 1000) };
  if (!pin) return false;
  const a = Buffer.from(String(pin).trim()), b = Buffer.from(config.adminPin);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) fails.delete(ip);
  else fails.set(ip, f.n + 1 >= 5 ? { n: 0, until: Date.now() + 60000 } : { n: f.n + 1, until: 0 });
  return ok;
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

  if (p.startsWith('/api/admin/')) {
    const ok = pinOk(req, req.headers['x-pin']);
    if (ok?.locked) return json(res, { error: `Nhập sai mã PIN nhiều lần. Thử lại sau ${ok.locked} giây`, wait: ok.locked }, 429);
    if (!ok) return json(res, { error: 'Sai mã PIN quản lý. Mã PIN in ở cửa sổ máy chủ' }, 401);
  }

  if (req.method === 'GET' && p === '/api/events') {
    const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'xem';
    if (role === 'admin' && pinOk(req, url.searchParams.get('pin')) !== true) return json(res, { error: 'Sai mã PIN quản lý' }, 401);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const c = { res, role, ip: clientIp(req), device: deviceName(req.headers['user-agent']), since: Date.now() };
    clients.add(c);
    send(c, 'info', publicInfo());
    broadcast('network', networkInfo(), 'admin');
    req.on('close', () => { clients.delete(c); broadcast('network', networkInfo(), 'admin'); });
    return;
  }

  if (req.method === 'GET' && p === '/api/info') return json(res, publicInfo());

  if (req.method === 'GET' && p === '/api/admin/data') return json(res, { title: config.title, network: networkInfo() });

  if (req.method === 'POST' && p === '/api/admin/check') { await checkChat(); return json(res, networkInfo()); }

  if (req.method === 'POST' && p === '/api/admin/scan') return json(res, await scanLan());

  if (req.method === 'POST' && p === '/api/admin/config') {
    const b = await readBody(req);
    const u = normUrl(b.url);
    try { new URL(u); } catch { return json(res, { error: 'Địa chỉ không hợp lệ' }, 400); }
    const title = String(b.title || '').trim().slice(0, 60);
    config.lanchat.url = u;
    if (title) config.title = title;
    writeJson(CONFIG_FILE, config);
    await checkChat();
    return json(res, networkInfo());
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
  log(`  Trên máy này:  http://localhost:${PORT}/   ·   quản lý: http://localhost:${PORT}/quan-ly`);
  for (const a of lanAddresses()) log(`  ${a.virtual ? 'Card mạng ảo' : 'Mạng LAN'} (${a.iface}): http://${a.ip}:${PORT}/`);
  log(`  Mã PIN trang quản lý: ${config.adminPin}  (đổi trong data/config.json)`);
  log(`  Máy chủ LAN Chat: ${config.lanchat.url}`);
  checkChat();
});
