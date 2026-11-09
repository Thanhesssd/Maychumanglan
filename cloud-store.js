'use strict';
// Lưu dữ liệu (tài khoản, phiên đăng nhập, cấu hình) lên Supabase khi chạy trên máy chủ đám mây.
// Máy chủ đám mây miễn phí (Render) xóa ổ đĩa mỗi lần ngủ/khởi động lại, nên:
//   - lúc khởi động: tải dữ liệu từ Supabase về thư mục data/
//   - mỗi lần ghi file: gửi bản mới lên Supabase (gom lại 2 giây/lần)
// Không đặt SUPABASE_URL và SUPABASE_SERVICE_KEY thì module này không làm gì (chạy trên laptop như cũ).
//
// Bảng cần tạo một lần trong Supabase (SQL Editor):
//   create table kv (key text primary key, value jsonb not null, updated_at timestamptz default now());
//   alter table kv enable row level security;   -- chặn truy cập công khai; khóa service_role vẫn dùng được

const fs = require('fs');
const path = require('path');

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const enabled = !!(BASE && KEY);
const FILES = ['config.json', 'users.json', 'sessions.json'];
const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });

async function pull(dir) {
  if (!enabled) return 0;
  const r = await fetch(`${BASE}/rest/v1/kv?select=key,value`, { headers: headers(), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Supabase trả lỗi ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const row of await r.json()) {
    if (!FILES.includes(row.key)) continue;
    fs.writeFileSync(path.join(dir, row.key), JSON.stringify(row.value, null, 2));
    n++;
  }
  return n;
}

const timers = {};
const dirty = new Map(); // key -> đường dẫn file chưa gửi
async function upload(key) {
  const file = dirty.get(key);
  if (!file) return;
  dirty.delete(key);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = await fetch(`${BASE}/rest/v1/kv`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.error(`⚠ Chưa lưu được ${key} lên Supabase (${e.message}), thử lại sau 10 giây`);
    if (!dirty.has(key)) dirty.set(key, file);
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => upload(key), 10000);
  }
}

function push(file) {
  if (!enabled) return;
  const key = path.basename(file);
  if (!FILES.includes(key)) return;
  dirty.set(key, file);
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => upload(key), 2000);
}

// Máy chủ sắp tắt (Render gửi SIGTERM trước khi cho ngủ): gửi ngay mọi thay đổi còn chờ
async function flush() {
  if (!enabled) return;
  for (const k of Object.keys(timers)) clearTimeout(timers[k]);
  await Promise.all([...dirty.keys()].map(upload));
}

module.exports = { enabled, pull, push, flush };
