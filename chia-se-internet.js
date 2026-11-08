'use strict';
// Mở đường hầm Cloudflare (miễn phí, không cần tài khoản) để người ở ngoài mạng LAN mở được app.
// Cần cài trước: winget install --id Cloudflare.cloudflared
// Link https://….trycloudflare.com được ghi vào data/public_url.txt; link đổi mỗi lần chạy lại.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || (JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8')).port || 3000);
const OUT = path.join(__dirname, 'data', 'public_url.txt');

function findCloudflared() {
  const candidates = ['cloudflared',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch { }
  }
  console.error('Chưa có cloudflared. Cài bằng lệnh:  winget install --id Cloudflare.cloudflared');
  process.exit(1);
}

const clear = () => { try { fs.unlinkSync(OUT); } catch { } };
clear();
const cf = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let found = false;
const onData = buf => {
  const m = !found && String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m) return;
  found = true;
  fs.writeFileSync(OUT, m[0]);
  console.log('\n==============================================');
  console.log(' Link Internet cho mọi người:');
  console.log(' ' + m[0]);
  console.log('==============================================');
  console.log('Giữ cửa sổ này mở. Đóng cửa sổ là link ngừng hoạt động.\n');
};
cf.stdout.on('data', onData);
cf.stderr.on('data', onData);
cf.on('exit', code => { clear(); console.log('Đường hầm đã đóng (mã ' + code + ').'); process.exit(code || 0); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { clear(); cf.kill(); });
