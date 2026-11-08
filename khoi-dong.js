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

// Chạy ngầm thì không có cửa sổ: ghi mọi dòng ra data/khoi-dong.log để xem bằng trang-thai.bat
const LOG = path.join(ROOT, 'data', 'khoi-dong.log');
try { if (fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.cu'); } catch { }
const origLog = console.log.bind(console);
console.log = (...a) => {
  try { origLog(...a); } catch { }
  try { fs.appendFileSync(LOG, `${new Date().toLocaleString('vi-VN')}  ${a.join(' ')}\n`); } catch { }
};
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
let stopping = false;
// Chương trình con bị dừng bất ngờ (lỗi, mất mạng làm đường hầm rớt…) thì tự bật lại,
// để điện thoại bấm "Mở app" lúc nào cũng vào được. Dừng liên tục 5 lần trong 2 phút thì thôi, tránh lặp vô tận.
function run(tag, cmd, args, cwd, restarts = []) {
  const p = spawn(cmd, args, { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p);
  const out = buf => String(buf).split(/\r?\n/).filter(l => l.trim() && !/^\d{4}-\d\d-\d\dT.*(INF|DBG)/.test(l))
    .forEach(l => console.log(`[${tag}] ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('error', e => console.log(`[${tag}] ⚠ Không chạy được ${cmd}: ${e.message}`));
  p.on('exit', code => {
    children.splice(children.indexOf(p), 1);
    if (stopping) return;
    const recent = [...restarts.filter(t => Date.now() - t < 120000), Date.now()];
    if (recent.length > 5) return console.log(`[${tag}] ⚠ đã dừng nhiều lần liên tiếp (mã ${code}), không tự bật lại nữa. Xem lỗi ở trên.`);
    console.log(`[${tag}] đã dừng (mã ${code}), tự bật lại sau 3 giây…`);
    setTimeout(() => { if (!stopping) run(tag, cmd, args, cwd, recent); }, 3000);
  });
  return p;
}

function stopAll() {
  stopping = true;
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

  // Đường hầm đang chạy thì không bật thêm, để link Internet không bị đổi mỗi lần bấm "Mở app"
  const lanchatNet = hasLanChat && fs.existsSync(path.join(LANCHAT, 'data', 'public_url.txt'));
  const pageNet = await tunnelAlive();

  if (hasLanChat) {
    if (lanchatNet && await listening(8000)) console.log('[Net LAN Chat] đã chạy sẵn');
    else if (await waitPort(8000)) run('Net LAN Chat', PY, ['chia_se_internet.py'], LANCHAT);
    else console.log('[LAN Chat] ⚠ không mở được cổng 8000, xem lỗi ở trên');
  }
  if (pageNet) console.log('[Net Trang] đã chạy sẵn: ' + pageNet);
  else if (await waitPort(PORT)) run('Net Trang', process.execPath, ['chia-se-internet.js'], ROOT);
  else console.log('[Trang] ⚠ không mở được cổng ' + PORT + ', xem lỗi ở trên');

  console.log('\nLink cho mọi người (tự cập nhật sau khoảng 1 phút):');
  console.log('  https://m23931716-coder.github.io/Quanlymanglan/');
  console.log('  https://thanhesssd.github.io/Maychumanglan/\n');
  if (!children.length) {
    console.log('Mọi thứ đã chạy sẵn ở cửa sổ khác, không cần bật thêm. Cửa sổ này tự đóng sau 8 giây.');
    setTimeout(() => process.exit(0), 8000);
  }
})();

// Link Internet của trang còn sống không: hỏi /api/ping qua chính link đó
async function tunnelAlive() {
  let url;
  try { url = fs.readFileSync(path.join(ROOT, 'data', 'public_url.txt'), 'utf8').trim(); } catch { return null; }
  if (!url) return null;
  try {
    const r = await fetch(url + '/api/ping', { signal: AbortSignal.timeout(8000) });
    return (await r.json()).ok ? url : null;
  } catch { return null; }
}
