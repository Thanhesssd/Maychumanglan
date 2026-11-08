'use strict';
// Máy chủ cửa hàng trong mạng LAN: quầy mua hàng (/), trang quản lý (/quan-ly),
// và cầu nối gửi đơn sang app LAN Chat bảo mật. Chỉ dùng Node.js có sẵn, không cần cài thư viện.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { LanChatBridge } = require('./lanchat-bridge');

const ROOT = __dirname;
const DATA = process.env.SHOP_DATA || path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const PRODUCTS_FILE = path.join(ROOT, 'products.json');
const CONFIG_FILE = path.join(DATA, 'config.json');
const ORDERS_FILE = path.join(DATA, 'orders.json');
fs.mkdirSync(DATA, { recursive: true });

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function log(line) {
  const stamp = new Date().toLocaleString('vi-VN');
  console.log(line);
  try { fs.appendFileSync(path.join(DATA, 'server.log'), `${stamp}  ${line}\n`); } catch { }
}

// ---------- Cấu hình (tạo lần đầu, sửa trong data/config.json hoặc trang quản lý) ----------
const defaults = {
  port: 3000,
  adminPin: String(crypto.randomInt(100000, 1000000)),
  shopName: 'Cửa hàng Cigar & Thuốc lá',
  bank: { bin: '', account: '', owner: '', bankName: '' },
  lanchat: { enabled: true, url: 'http://localhost:8000', name: 'Bot Cửa hàng', password: crypto.randomBytes(18).toString('base64url') },
};
const saved = readJson(CONFIG_FILE, {});
const config = { ...defaults, ...saved, bank: { ...defaults.bank, ...saved.bank }, lanchat: { ...defaults.lanchat, ...saved.lanchat } };
writeJson(CONFIG_FILE, config);
const PORT = +process.env.PORT || config.port;
if (process.env.ADMIN_PIN) config.adminPin = process.env.ADMIN_PIN;
if (process.env.LANCHAT_URL) config.lanchat.url = process.env.LANCHAT_URL;

// ---------- Dữ liệu ----------
const STATUS = { cho_tt: 'Chờ thanh toán', moi: 'Mới', xac_nhan: 'Đã xác nhận', da_giao: 'Đã giao', huy: 'Hủy' };
const PAYMENT = { qr: 'Quét mã QR', bank: 'Chuyển khoản', cod: 'Thanh toán khi nhận hàng' };
const db = readJson(ORDERS_FILE, { seq: 0, orders: [] });
const saveDb = () => writeJson(ORDERS_FILE, db);
const visible = () => db.orders.filter(o => o.status !== 'cho_tt');
const pub = ({ secret, ...o }) => o; // không lộ mã bí mật của quầy ra trang quản lý
const money = n => n.toLocaleString('vi-VN') + 'đ';
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function products() {
  const p = readJson(PRODUCTS_FILE, { products: [] });
  return (p.products || []).filter(x => x.id && x.name && Number.isFinite(x.price));
}

function normPhone(s) {
  let p = String(s || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length === 11) p = '0' + p.slice(2);
  return /^0\d{9}$/.test(p) ? p : null;
}

// Dọn đơn bỏ dở (khách tạo đơn nhưng không thanh toán) sau 1 giờ
setInterval(() => {
  const n = db.orders.length;
  db.orders = db.orders.filter(o => o.status !== 'cho_tt' || Date.now() - o.createdAt < 3600e3);
  if (db.orders.length !== n) saveDb();
}, 600e3);

// ---------- VietQR (chuẩn EMVCo, ngân hàng Việt Nam quét được nếu điền đúng mã BIN và số tài khoản) ----------
function tlv(id, value) { return id + String(value.length).padStart(2, '0') + value; }
function crc16(s) {
  let crc = 0xffff;
  for (const b of Buffer.from(s, 'utf8')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function vietQr(amount, note) {
  const { bin, account } = config.bank;
  if (!bin || !account) return null;
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', 'QRIBFTTA');
  const body = tlv('00', '01') + tlv('01', '12') + tlv('38', merchant) + tlv('53', '704') + tlv('54', String(amount))
    + tlv('58', 'VN') + tlv('62', tlv('08', note)) + '6304';
  return body + crc16(body);
}

// ---------- Mạng LAN ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ iface: name, ip: a.address, netmask: a.netmask, mac: a.mac });
  }
  return out;
}

function deviceName(ua = '') {
  const osName = [['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Android', 'Android'], ['Windows', 'Windows'], ['Mac OS', 'macOS'], ['Linux', 'Linux']].find(([k]) => ua.includes(k))?.[1] || 'Thiết bị';
  const browser = [['Edg/', 'Edge'], ['CriOS', 'Chrome'], ['Chrome/', 'Chrome'], ['Firefox/', 'Firefox'], ['Safari/', 'Safari']].find(([k]) => ua.includes(k))?.[1] || 'trình duyệt';
  return `${osName} · ${browser}`;
}

const clientIp = req => (req.socket.remoteAddress || '').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');

// ---------- Kết nối thời gian thực (Server-Sent Events) ----------
const clients = new Set(); // { res, role, ip, device, since }
let lastOrder = null;

function presence() {
  const count = role => [...clients].filter(c => c.role === role).length;
  return { quay: count('quay'), admin: count('admin'), lastOrderAt: lastOrder?.paidAt || null, lastOrderId: lastOrder?.id || null, lanchat: bridge.status().state };
}

function send(c, event, data) { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data, role) { for (const c of clients) if (!role || c.role === role) send(c, event, data); }
function pushPresence() { broadcast('presence', presence()); broadcast('network', networkInfo(), 'admin'); }

setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);

// ---------- Cầu nối LAN Chat ----------
let chatHealth = null;
const bridge = new LanChatBridge({
  cfg: config.lanchat, dataDir: DATA, log,
  onChange: () => { pushPresence(); broadcast('lanchat', bridge.status(), 'admin'); },
  onMessage: (text, from) => handleChatCommand(text, from),
});

async function checkChatHealth() {
  try { chatHealth = { ok: true, at: Date.now(), ...(await bridge.api('health', null, 5000)) }; }
  catch (e) { chatHealth = { ok: false, at: Date.now(), error: e.message }; }
  broadcast('network', networkInfo(), 'admin');
}
setInterval(checkChatHealth, 30000);

function networkInfo() {
  return {
    hostname: os.hostname(), port: PORT, addresses: lanAddresses(), uptime: Math.round(process.uptime()),
    devices: [...clients].map(c => ({ role: c.role, ip: c.ip, device: c.device, since: c.since })),
    lanchat: { ...bridge.status(), health: chatHealth },
  };
}

function orderText(o, title = '🛒 ĐƠN MỚI') {
  const lines = o.items.map(i => `• ${i.name} × ${i.qty} = ${money(i.price * i.qty)}`);
  return [`${title} #${o.id}`, `Khách: ${o.customer.name} · ${o.customer.phone}`, `Địa chỉ: ${o.customer.address}`, ...lines,
    `Tổng: ${money(o.total)}`, `Thanh toán: ${PAYMENT[o.payment]}${o.payment === 'cod' ? '' : ' (đã thanh toán)'}`,
    `Lúc ${new Date(o.paidAt).toLocaleString('vi-VN')}`, '', `Trả lời "xn ${o.id}", "giao ${o.id}" hoặc "huy ${o.id}" để đổi trạng thái.`].join('\n');
}

// Nhân viên nhắn cho bot trong LAN Chat để xem và xử lý đơn
async function handleChatCommand(text, from) {
  const t = fold(text).trim().replace(/\s+/g, ' ');
  const m = t.match(/^(xn|xac nhan|giao|da giao|huy)\s*#?\s*(?:dh)?\s*(\d+)$/);
  if (m) {
    const status = { xn: 'xac_nhan', 'xac nhan': 'xac_nhan', giao: 'da_giao', 'da giao': 'da_giao', huy: 'huy' }[m[1]];
    const o = visible().find(x => +x.id.slice(2) === +m[2]);
    if (!o) return `Không tìm thấy đơn DH${m[2].padStart(4, '0')}.`;
    setStatus(o, status, `${from.name} (LAN Chat)`);
    return `✅ Đơn #${o.id} → ${STATUS[status]}.`;
  }
  if (/^(don|ds|don moi)$/.test(t)) {
    const open = visible().filter(o => o.status === 'moi' || o.status === 'xac_nhan').slice(-10).reverse();
    if (!open.length) return 'Không có đơn nào đang chờ xử lý.';
    return '📋 Đơn đang chờ:\n' + open.map(o => `#${o.id} · ${STATUS[o.status]} · ${o.customer.name} · ${money(o.total)}`).join('\n');
  }
  if (/^(doanh thu|hom nay|tong)$/.test(t)) {
    const start = new Date().setHours(0, 0, 0, 0);
    const today = visible().filter(o => o.paidAt >= start && o.status !== 'huy');
    return `📊 Hôm nay: ${today.length} đơn, ${new Set(today.map(o => o.customer.phone)).size} khách, doanh thu ${money(today.reduce((s, o) => s + o.total, 0))}.`;
  }
  if (/^ma\s*#?\s*(?:dh)?\s*(\d+)$/.test(t)) {
    const n = +t.match(/(\d+)$/)[1];
    const o = visible().find(x => +x.id.slice(2) === n);
    return o ? orderText(o, `📄 ${STATUS[o.status].toUpperCase()}`) : 'Không tìm thấy đơn này.';
  }
  return `Xin chào ${from.name}, tôi là bot của ${config.shopName}. Các lệnh:\n• don — đơn đang chờ\n• ma DH0001 — xem chi tiết đơn\n• xn DH0001 — xác nhận\n• giao DH0001 — đã giao\n• huy DH0001 — hủy đơn\n• doanh thu — tổng kết hôm nay`;
}

function setStatus(o, status, by) {
  if (o.status === status) return;
  o.status = status;
  o.history.push({ at: Date.now(), status, by });
  saveDb();
  broadcast('update', pub(o), 'admin');
  broadcast('order-status', { id: o.id, status, label: STATUS[status] }, 'quay');
  if (!by.includes('LAN Chat')) bridge.broadcast(`🔄 Đơn #${o.id} (${o.customer.name}) → ${STATUS[status]} · bởi ${by}`, `st:${o.id}:${status}:${Date.now()}`);
}

// ---------- HTTP ----------
function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100000) { reject(new Error('Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
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
  if (!pin) return false; // trang chưa có mã PIN thì không tính là nhập sai
  const a = Buffer.from(String(pin).trim()), b = Buffer.from(config.adminPin);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) fails.delete(ip);
  else fails.set(ip, f.n + 1 >= 5 ? { n: 0, until: Date.now() + 60000 } : { n: f.n + 1, until: 0 });
  return ok;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PAGES = { '/': 'quay.html', '/quay': 'quay.html', '/quan-ly': 'quan-ly.html' };

function serveStatic(res, urlPath) {
  const name = PAGES[urlPath] || urlPath.replace(/^\/+/, '');
  const full = path.join(PUBLIC, name);
  if (!full.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(full)] || !fs.existsSync(full)) return json(res, { error: 'Không tìm thấy trang' }, 404);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)], 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const isAdmin = p.startsWith('/api/admin/');

  if (isAdmin) {
    const ok = pinOk(req, req.headers['x-pin']);
    if (ok?.locked) return json(res, { error: `Nhập sai mã PIN nhiều lần. Thử lại sau ${ok.locked} giây`, wait: ok.locked }, 429);
    if (!ok) return json(res, { error: 'Sai mã PIN quản lý. Mã PIN in ở cửa sổ máy chủ' }, 401);
  }

  if (req.method === 'GET' && p === '/api/events') {
    const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'quay';
    if (role === 'admin' && pinOk(req, url.searchParams.get('pin')) !== true) return json(res, { error: 'Sai mã PIN quản lý' }, 401);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const c = { res, role, ip: clientIp(req), device: deviceName(req.headers['user-agent']), since: Date.now() };
    clients.add(c);
    send(c, 'presence', presence());
    if (role === 'admin') { send(c, 'lanchat', bridge.status()); send(c, 'network', networkInfo()); }
    pushPresence();
    req.on('close', () => { clients.delete(c); pushPresence(); });
    return;
  }

  if (req.method === 'GET' && p === '/api/info') {
    return json(res, { shopName: config.shopName, products: products(), presence: presence(), bank: { ...config.bank, qr: !!(config.bank.bin && config.bank.account) } });
  }

  if (req.method === 'POST' && p === '/api/orders') {
    const b = await readBody(req);
    const list = products();
    const items = [];
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const prod = list.find(x => x.id === it.id);
      const qty = Math.floor(+it.qty);
      if (!prod || !(qty >= 1 && qty <= 99)) return json(res, { error: 'Giỏ hàng có sản phẩm không hợp lệ' }, 400);
      items.push({ id: prod.id, name: prod.name, price: prod.price, qty });
    }
    const name = String(b.customer?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const phone = normPhone(b.customer?.phone);
    const address = String(b.customer?.address || '').trim().slice(0, 200);
    if (!items.length) return json(res, { error: 'Giỏ hàng đang trống' }, 400);
    if (name.length < 2) return json(res, { error: 'Vui lòng nhập họ tên' }, 400);
    if (!phone) return json(res, { error: 'Số điện thoại cần 10 số, bắt đầu bằng 0' }, 400);
    if (address.length < 5) return json(res, { error: 'Vui lòng nhập địa chỉ giao hàng' }, 400);
    if (!PAYMENT[b.payment]) return json(res, { error: 'Chọn cách thanh toán' }, 400);
    if (b.adult !== true) return json(res, { error: 'Sản phẩm thuốc lá chỉ bán cho người từ 18 tuổi' }, 400);
    db.seq += 1;
    const o = {
      id: 'DH' + String(db.seq).padStart(4, '0'), secret: crypto.randomBytes(12).toString('hex'), createdAt: Date.now(), paidAt: null,
      status: 'cho_tt', customer: { name, phone, address }, items, total: items.reduce((s, i) => s + i.price * i.qty, 0),
      payment: b.payment, history: [{ at: Date.now(), status: 'cho_tt', by: 'Quầy' }],
    };
    db.orders.push(o);
    saveDb();
    const note = `${o.id} ${fold(name).toUpperCase()}`.replace(/[^A-Z0-9 ]/g, '').slice(0, 25);
    return json(res, { id: o.id, secret: o.secret, total: o.total, note, qr: o.payment === 'qr' ? vietQr(o.total, note) : null });
  }

  let m = p.match(/^\/api\/orders\/(DH\d+)\/(paid|abandon)$/);
  if (req.method === 'POST' && m) {
    const b = await readBody(req);
    const o = db.orders.find(x => x.id === m[1]);
    if (!o || o.secret !== b.secret || o.status !== 'cho_tt') return json(res, { error: 'Không tìm thấy đơn đang chờ thanh toán' }, 404);
    if (m[2] === 'abandon') {
      db.orders = db.orders.filter(x => x !== o);
      saveDb();
      return json(res, { ok: true });
    }
    o.status = 'moi';
    o.paidAt = Date.now();
    o.history.push({ at: o.paidAt, status: 'moi', by: o.payment === 'cod' ? 'Khách đặt hàng (COD)' : 'Khách đã thanh toán' });
    saveDb();
    lastOrder = o;
    broadcast('order', pub(o), 'admin');
    pushPresence();
    const sentTo = bridge.broadcast(orderText(o), `order:${o.id}`);
    log(`Đơn mới ${o.id} · ${o.customer.name} · ${money(o.total)} · báo LAN Chat cho ${sentTo} người`);
    return json(res, { ok: true, id: o.id, paidAt: o.paidAt, admins: presence().admin, lanchat: sentTo });
  }

  // ---------- Quản lý ----------
  if (req.method === 'GET' && p === '/api/admin/data') {
    return json(res, { shopName: config.shopName, orders: visible().map(pub), statuses: STATUS, payments: PAYMENT, lanchat: bridge.status(), network: networkInfo(), products: products() });
  }

  m = p.match(/^\/api\/admin\/orders\/(DH\d+)\/status$/);
  if (req.method === 'POST' && m) {
    const b = await readBody(req);
    const o = visible().find(x => x.id === m[1]);
    if (!o) return json(res, { error: 'Không tìm thấy đơn' }, 404);
    if (!STATUS[b.status] || b.status === 'cho_tt') return json(res, { error: 'Trạng thái không hợp lệ' }, 400);
    setStatus(o, b.status, 'Trang quản lý');
    return json(res, pub(o));
  }

  if (req.method === 'POST' && p === '/api/admin/lanchat/friend') {
    const b = await readBody(req);
    if (!['accept', 'decline', 'remove', 'request', 'cancel'].includes(b.action)) return json(res, { error: 'Thao tác không hợp lệ' }, 400);
    await bridge.friend(+b.id, b.action);
    return json(res, bridge.status());
  }

  if (req.method === 'GET' && p === '/api/admin/lanchat/users') {
    return json(res, { users: await bridge.findUser(url.searchParams.get('q') || '') });
  }

  if (req.method === 'POST' && p === '/api/admin/lanchat/test') {
    const n = bridge.broadcast(`🔔 Tin thử từ ${config.shopName} lúc ${new Date().toLocaleTimeString('vi-VN')}. Kết nối LAN Chat hoạt động tốt.`);
    return json(res, { sent: n });
  }

  if (req.method === 'POST' && p === '/api/admin/lanchat/config') {
    const b = await readBody(req);
    const url2 = String(b.url || '').trim();
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    if (!url2) return json(res, { error: 'Nhập địa chỉ máy chủ LAN Chat' }, 400);
    if (name.length < 2 || name.length > 60) return json(res, { error: 'Tên bot cần 2–60 ký tự' }, 400);
    if (name !== config.lanchat.name) config.lanchat.password = crypto.randomBytes(18).toString('base64url');
    Object.assign(config.lanchat, { url: url2, name, enabled: b.enabled !== false });
    writeJson(CONFIG_FILE, config);
    await bridge.restart(config.lanchat);
    checkChatHealth();
    return json(res, bridge.status());
  }

  if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);
  json(res, { error: 'Không tìm thấy' }, 404);
}

const server = http.createServer((req, res) => {
  route(req, res).catch(e => { if (!res.headersSent) json(res, { error: e.message || 'Lỗi máy chủ' }, e.status && e.status < 500 ? 400 : 500); });
});

server.on('error', e => {
  log(e.code === 'EADDRINUSE' ? `Cổng ${PORT} đang được dùng: có thể app đã chạy ở cửa sổ khác.` : e.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  log(`${config.shopName} đang chạy:`);
  log(`  Trên máy này:  http://localhost:${PORT}/  (quầy)   http://localhost:${PORT}/quan-ly  (quản lý)`);
  for (const a of lanAddresses()) log(`  Trong mạng LAN (${a.iface}): http://${a.ip}:${PORT}/`);
  log(`  Mã PIN trang quản lý: ${config.adminPin}  (đổi trong data/config.json)`);
  log(`  LAN Chat: ${config.lanchat.enabled ? config.lanchat.url + ' · bot "' + config.lanchat.name + '"' : 'đang tắt'}`);
  bridge.start();
  checkChatHealth();
});
