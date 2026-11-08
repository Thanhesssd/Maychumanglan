'use strict';
// Cầu nối tới máy chủ LAN Chat (https://github.com/Thanhesssd/hethongungdungchatbaomat-kysopdf).
// App cửa hàng đăng nhập vào LAN Chat như một tài khoản bình thường ("bot cửa hàng"),
// mã hóa tin y hệt app chat: AES-256-GCM cho nội dung, khóa AES bọc bằng RSA-OAEP của từng người nhận.
// Máy chủ LAN Chat chỉ chuyển tin đã mã hóa, không đọc được nội dung đơn hàng.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { webcrypto } = require('crypto');

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const b64 = buf => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString('base64');
const unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

async function sha256hex(s) {
  return Buffer.from(await subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s)).toString('hex');
}

// Giống hệt deriveHistKey trong app chat, để có thể đăng nhập tài khoản bot từ trình duyệt bằng cùng mật khẩu
async function deriveKey(password, acct) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('lanchat:' + acct), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

class LanChatBridge {
  constructor({ cfg, dataDir, onChange, onMessage, log }) {
    this.cfg = cfg;
    this.dataDir = dataDir;
    this.onChange = onChange || (() => {});
    this.onMessage = onMessage || (async () => null);
    this.log = log || console.log;
    this.reset();
  }

  reset() {
    this.token = null;
    this.me = null;
    this.keys = null;
    this.seq = 0;
    this.rseq = -1;
    this.people = {}; // id -> { name, pub (CryptoKey), pubB64, online, friend }
    this.incoming = [];
    this.outgoing = [];
    this.seen = new Set();
    this.outbox = [];
    this.state = 'off';
    this.message = '';
    this.startedAt = Date.now();
    this.ca = null;
  }

  status() {
    const friends = Object.entries(this.people).filter(([, p]) => p.friend)
      .map(([id, p]) => ({ id: +id, name: p.name, online: p.online }));
    return {
      enabled: !!this.cfg.enabled, state: this.state, message: this.message, url: this.cfg.url,
      name: this.cfg.name, id: this.me, friends, incoming: this.incoming, outgoing: this.outgoing,
      pending: this.outbox.length,
    };
  }

  setState(state, message = '') {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.onChange();
  }

  start() {
    if (this.running || !this.cfg.enabled) return;
    this.running = true;
    this.loop().catch(e => this.log('LAN Chat dừng bất thường: ' + e.message));
    this.timer = setInterval(() => this.flush(), 5000);
  }

  async restart(cfg) {
    this.running = false;
    clearInterval(this.timer);
    if (this.req) this.req.destroy();
    await sleep(200);
    this.cfg = cfg;
    this.reset();
    this.onChange();
    this.start();
  }

  // ---------- HTTP ----------
  base() {
    let u = (this.cfg.url || '').trim();
    if (!/^https?:\/\//i.test(u)) u = (/:8000\b|localhost|127\.0\.0\.1/.test(u) ? 'http://' : 'https://') + u;
    return new URL(u.replace(/\/+$/, '') + '/');
  }

  // Máy chủ LAN Chat dùng chứng thư gốc tự cấp. Lần đầu tải chứng thư gốc (/ca.crt) rồi lưu lại,
  // các lần sau chỉ tin đúng chứng thư đó (giống cách người dùng cài chứng thư gốc một lần trên mỗi máy).
  async loadCa(url) {
    const file = path.join(this.dataDir, `lanchat-ca-${url.hostname.replace(/[^\w.-]/g, '_')}.pem`);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const pem = await new Promise((resolve, reject) => {
      const req = https.get(new URL('ca.crt', url), { rejectUnauthorized: false, timeout: 8000 }, res => {
        let s = '';
        res.on('data', c => (s += c));
        res.on('end', () => (res.statusCode === 200 && s.includes('BEGIN CERTIFICATE') ? resolve(s) : reject(new Error('Không tải được chứng thư gốc'))));
      });
      req.on('timeout', () => req.destroy(new Error('Hết thời gian chờ')));
      req.on('error', reject);
    });
    fs.writeFileSync(file, pem);
    this.log(`Đã lưu chứng thư gốc của máy chủ LAN Chat ${url.host} vào ${path.basename(file)}`);
    return pem;
  }

  async api(p, body, timeout = 12000) {
    const url = new URL('api/' + p, this.base());
    const secure = url.protocol === 'https:';
    if (secure && !this.ca) this.ca = await this.loadCa(this.base());
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    return new Promise((resolve, reject) => {
      const req = (secure ? https : http).request(url, {
        method: body ? 'POST' : 'GET', timeout, ...(secure ? { ca: this.ca } : {}),
        headers: { 'Content-Type': 'application/json', 'X-Token': this.token || '', ...(payload ? { 'Content-Length': payload.length } : {}) },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          let d = {};
          try { d = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { }
          if (res.statusCode >= 400) reject(Object.assign(new Error(d.error || `Lỗi ${res.statusCode}`), { status: res.statusCode }));
          else resolve(d);
        });
      });
      if (p.startsWith('sync')) this.req = req;
      req.on('timeout', () => req.destroy(Object.assign(new Error('Máy chủ LAN Chat không phản hồi'), { code: 'TIMEOUT' })));
      req.on('error', reject);
      req.end(payload);
    });
  }

  // ---------- Tài khoản ----------
  async auth() {
    const name = this.cfg.name.normalize('NFC').trim();
    const passHash = await sha256hex(this.cfg.password);
    const key = await deriveKey(this.cfg.password, name.toLowerCase());
    let d;
    try {
      d = await this.api('login', { name, passHash });
    } catch (e) {
      if (e.status !== 401) throw e;
      // Chưa có tài khoản: tự tạo, khóa riêng được mã hóa bằng mật khẩu trước khi gửi lên (như app chat)
      const pair = await subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, await subtle.exportKey('pkcs8', pair.privateKey));
      try {
        d = await this.api('register', { name, passHash, pub: b64(await subtle.exportKey('spki', pair.publicKey)), priv: { iv: b64(iv), ct: b64(ct) } });
      } catch (e2) {
        if (e2.status === 409) throw Object.assign(new Error(`Tên "${name}" đã có người dùng với mật khẩu khác. Đổi tên bot trong trang quản lý`), { fatal: true });
        throw e2;
      }
      this.log(`Đã tạo tài khoản LAN Chat "${name}" (#${d.id})`);
    }
    const pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(d.priv.iv) }, key, unb64(d.priv.ct));
    this.keys = {
      privateKey: await subtle.importKey('pkcs8', pkcs8, RSA, false, ['decrypt']),
      publicKey: await subtle.importKey('spki', unb64(d.pub), RSA, false, ['encrypt']),
    };
    this.token = d.token;
    this.me = d.id;
    this.code = d.code;
  }

  // ---------- Mã hóa ----------
  async seal(ids, text) {
    const raw = webcrypto.getRandomValues(new Uint8Array(32));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const aes = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(text));
    const keys = {};
    for (const id of ids) {
      const pub = id === this.me ? this.keys.publicKey : this.people[id]?.pub;
      if (pub) keys[id] = b64(await subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw));
    }
    return { iv: b64(iv), ct: b64(ct), keys };
  }

  async open(env) {
    const wrapped = env.keys[this.me];
    if (!wrapped) throw new Error('Tin không gửi cho bot');
    const raw = await subtle.decrypt({ name: 'RSA-OAEP' }, this.keys.privateKey, unb64(wrapped));
    const aes = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, aes, unb64(env.ct)));
    return (env.z ? zlib.inflateRawSync(plain) : plain).toString('utf8');
  }

  // ---------- Đồng bộ ----------
  async loop() {
    let backoff = 2000;
    while (this.running) {
      try {
        if (!this.token) {
          this.setState('connecting', 'Đang đăng nhập máy chủ LAN Chat…');
          await this.auth();
        }
        const d = await this.api(`sync?since=${this.seq}&rsince=${this.rseq}&wait=${this.state === 'online' ? 1 : 0}`, null, 30000);
        if (!this.running) return;
        await this.applySync(d);
        this.setState('online', this.friendCount() ? '' : 'Chưa có nhân viên nào kết bạn với bot');
        backoff = 2000;
      } catch (e) {
        if (!this.running) return;
        if (e.status === 401 && this.token) { this.token = null; continue; }
        const msg = e.code === 'ECONNREFUSED' ? 'Không kết nối được: máy chủ LAN Chat chưa chạy hoặc sai địa chỉ'
          : e.code === 'ENOTFOUND' ? 'Không tìm thấy địa chỉ máy chủ LAN Chat'
          : /certificate|self.signed|CERT/i.test(e.message || e.code) ? 'Chứng chỉ máy chủ LAN Chat không khớp. Xóa file data/lanchat-ca-*.pem nếu máy chủ đã cài lại'
          : e.message;
        this.setState('error', msg);
        if (e.fatal) { this.running = false; return; }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  friendCount() { return Object.values(this.people).filter(p => p.friend).length; }

  async applySync(d) {
    const before = JSON.stringify(this.status());
    for (const p of Object.values(this.people)) p.friend = false;
    for (const u of d.users) {
      const p = this.people[u.id] ||= {};
      p.name = u.name;
      p.online = u.online;
      p.friend = !!u.friend;
      if (p.pubB64 !== u.pub) {
        p.pubB64 = u.pub;
        p.pub = await subtle.importKey('spki', unb64(u.pub), RSA, false, ['encrypt']);
      }
    }
    this.incoming = d.incoming.map(u => ({ id: u.id, name: u.name, online: u.online }));
    this.outgoing = d.outgoing.map(u => ({ id: u.id, name: u.name }));
    let ack = 0;
    for (const msg of d.messages) {
      if (this.seen.has(msg.seq)) continue;
      this.seen.add(msg.seq);
      if (msg.from === this.me || msg.group != null) continue;
      ack = Math.max(ack, msg.seq);
      if (msg.ts < this.startedAt) continue; // không trả lời lại tin cũ khi vừa khởi động
      let text;
      try { text = await this.open(msg.env); } catch { continue; }
      const reply = await this.onMessage(text, { id: msg.from, name: msg.fromName }).catch(e => '⚠ ' + e.message);
      if (reply) this.queue(msg.from, reply);
    }
    this.seq = Math.max(this.seq, d.seq);
    this.rseq = d.rseq;
    if (ack) this.api('ack', { seq: ack }).catch(() => {});
    this.flush();
    if (JSON.stringify(this.status()) !== before) this.onChange();
  }

  // ---------- Gửi tin ----------
  queue(to, text, mid = webcrypto.randomUUID()) {
    this.outbox.push({ to, text, mid, tries: 0 });
    this.flush();
  }

  // Gửi cho mọi nhân viên đã kết bạn với bot. Trả về số người nhận.
  broadcast(text, midPrefix = webcrypto.randomUUID()) {
    const ids = Object.entries(this.people).filter(([, p]) => p.friend).map(([id]) => +id);
    for (const id of ids) this.queue(id, text, `${midPrefix}:${id}`.slice(0, 64));
    return ids.length;
  }

  async flush() {
    if (this.flushing || !this.token || !this.outbox.length) return;
    this.flushing = true;
    try {
      while (this.outbox.length && this.token) {
        const m = this.outbox[0];
        try {
          if (!this.people[m.to]?.pub) throw Object.assign(new Error('Chưa có khóa công khai của người nhận'), { status: 403 });
          await this.api('send', { to: m.to, env: await this.seal([this.me, m.to], m.text), mid: m.mid });
          this.outbox.shift();
        } catch (e) {
          // Lỗi do yêu cầu (ví dụ đã hủy kết bạn) thì bỏ tin; lỗi mạng thì giữ lại gửi sau
          if (e.status && e.status < 500 && e.status !== 401) { this.outbox.shift(); this.log(`Bỏ tin LAN Chat tới #${m.to}: ${e.message}`); continue; }
          if (e.status === 401) this.token = null;
          break;
        }
      }
    } finally {
      this.flushing = false;
      this.onChange();
    }
  }

  async friend(id, action) {
    if (!this.token) throw new Error('Bot chưa kết nối LAN Chat');
    const d = await this.api('friend', { id, action });
    // Đồng bộ ngay để có khóa công khai của bạn mới
    const s = await this.api(`sync?since=${this.seq}&rsince=${this.rseq}&wait=0`);
    await this.applySync(s);
    return d;
  }

  async findUser(q) {
    if (!this.token) throw new Error('Bot chưa kết nối LAN Chat');
    return (await this.api('users?q=' + encodeURIComponent(q))).users;
  }
}

module.exports = { LanChatBridge };
