'use strict';
// Bật mọi thứ để thiết bị khác truy cập được, mỗi phần một cửa sổ riêng:
//   1. Máy chủ LAN Chat (repo hethongungdungchatbaomat-kysopdf)
//   2. Trang đăng ký / cấp địa chỉ IP (thư mục này)
//   3. Link Internet cho máy chủ LAN Chat (để thiết bị dùng 4G/khác mạng kết nối được máy chủ)
//   4. Link Internet cho trang đăng ký (tự cập nhật link GitHub cố định)
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

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Cổng đã có chương trình nghe thì không bật thêm bản thứ hai
const listening = port => new Promise(resolve => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
async function waitPort(port, sec = 30) {
  for (let i = 0; i < sec; i++) { if (await listening(port)) return true; await sleep(1000); }
  return false;
}

function openWindow(title, dir, bat) {
  // "start" mở cửa sổ mới tách hẳn khỏi cửa sổ này, đóng cửa sổ này không ảnh hưởng
  spawn('cmd.exe', ['/c', 'start', `"${title}"`, '/d', dir, 'cmd', '/k', bat], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  console.log('  ✓ ' + title);
}

(async () => {
  console.log('Đang bật máy chủ…');
  const hasLanChat = fs.existsSync(path.join(LANCHAT, 'chay-may-chu.bat'));
  if (!hasLanChat) console.log(`  ⚠ Không thấy máy chủ LAN Chat ở ${LANCHAT}. Đặt "lanchatDir" trong data/config.json.`);

  if (hasLanChat && !(await listening(8000))) openWindow('May chu LAN Chat', LANCHAT, 'chay-may-chu.bat');
  else if (hasLanChat) console.log('  • Máy chủ LAN Chat đã chạy sẵn');

  if (!(await listening(PORT))) openWindow('Trang dang ky - cap dia chi IP', ROOT, 'node server.js');
  else console.log('  • Trang đăng ký đã chạy sẵn');

  if (hasLanChat && await waitPort(8000)) openWindow('Link Internet - LAN Chat', LANCHAT, 'chia-se-internet.bat');
  if (await waitPort(PORT)) openWindow('Link Internet - Trang dang ky', ROOT, 'chia-se-internet.bat');

  console.log('\nXong. Giữ các cửa sổ vừa mở; cửa sổ này tự đóng sau vài giây.');
  console.log('Link cho mọi người: https://thanhesssd.github.io/Maychumanglan/');
  await sleep(6000);
})();
