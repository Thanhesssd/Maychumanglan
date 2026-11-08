'use strict';
// Bật mọi thứ trong MỘT cửa sổ để thiết bị khác truy cập được:
//   [LAN Chat]      máy chủ LAN Chat (repo hethongungdungchatbaomat-kysopdf)
//   [Trang]         trang đăng ký / cấp địa chỉ IP (thư mục này)
//   [Net LAN Chat]  link Internet cho LAN Chat (thiết bị dùng 4G/khác mạng kết nối được máy chủ)
//   [Net Trang]     link Internet cho trang đăng ký (tự cập nhật link GitHub cố định)
// Giữ cửa sổ này mở. Đóng cửa sổ (hoặc Ctrl+C) là tắt tất cả.
// Thư mục LAN Chat: mục "lanchatDir" trong data/config.json, mặc định ..\Dự án 02\ui\ui\ui

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = __dirname;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')); } catch { }
const PORT = cfg.port || 3000;
const LANCHAT = cfg.lanchatDir || path.join(ROOT, '..', 'Dự án 02', 'ui', 'ui', 'ui');
const PY = process.env.PYTHON || 'python';
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const listening = port => new Promise(resolve => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
async function waitPort(port, sec = 40) {
  for (let i = 0; i < sec; i++) { if (await listening(port)) return true; await sleep(1000); }
  return false;
}

const children = [];
function run(tag, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p);
  const out = buf => String(buf).split(/\r?\n/).filter(l => l.trim() && !/^\d{4}-\d\d-\d\dT.*(INF|DBG)/.test(l))
    .forEach(l => console.log(`[${tag}] ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('error', e => console.log(`[${tag}] ⚠ Không chạy được ${cmd}: ${e.message}`));
  p.on('exit', code => console.log(`[${tag}] đã dừng (mã ${code}).`));
  return p;
}

function stopAll() {
  for (const p of children) { try { p.kill(); } catch { } }
  setTimeout(() => process.exit(0), 500);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, stopAll);

(async () => {
  console.log('=== Đang bật máy chủ. GIỮ CỬA SỔ NÀY MỞ; đóng cửa sổ là tắt tất cả. ===\n');
  const hasLanChat = fs.existsSync(path.join(LANCHAT, 'server.py'));
  if (!hasLanChat) console.log(`⚠ Không thấy máy chủ LAN Chat ở ${LANCHAT}. Đặt "lanchatDir" trong data/config.json.\n`);

  if (hasLanChat) {
    if (await listening(8000)) console.log('[LAN Chat] đã chạy sẵn');
    else run('LAN Chat', PY, ['server.py'], LANCHAT);
  }
  if (await listening(PORT)) console.log('[Trang] đã chạy sẵn');
  else run('Trang', process.execPath, ['server.js'], ROOT);

  if (hasLanChat) {
    if (await waitPort(8000)) run('Net LAN Chat', PY, ['chia_se_internet.py'], LANCHAT);
    else console.log('[LAN Chat] ⚠ không mở được cổng 8000, xem lỗi ở trên');
  }
  if (await waitPort(PORT)) run('Net Trang', process.execPath, ['chia-se-internet.js'], ROOT);
  else console.log('[Trang] ⚠ không mở được cổng ' + PORT + ', xem lỗi ở trên');

  console.log('\nLink cho mọi người (tự cập nhật sau khoảng 1 phút):');
  console.log('  https://m23931716-coder.github.io/Quanlymanglan/');
  console.log('  https://thanhesssd.github.io/Maychumanglan/\n');
})();
