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

// Cập nhật link mới lên GitHub Pages (docs/link.txt) để link cố định https://<tài khoản>.github.io/<repo>/
// luôn chuyển tới app. Chỉ đẩy đúng 2 file link, không đụng tới thay đổi khác đang làm dở.
// Tắt bằng biến môi trường KHONG_DAY_GITHUB=1.
function publishToGitHub(url) {
  if (process.env.KHONG_DAY_GITHUB) return;
  const git = (...args) => execFileSync('git', args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    git('rev-parse', '--is-inside-work-tree');
    fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'docs', 'link.txt'), url + '\n');
    const readme = path.join(__dirname, 'README.md');
    if (fs.existsSync(readme)) fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/\*\*https:\/\/[a-z0-9-]+\.trycloudflare\.com\*\*/, `**${url}**`));
    git('add', 'docs/link.txt', 'README.md');
    if (git('diff', '--cached', '--name-only')) git('commit', '-m', 'Cập nhật link truy cập app', '--', 'docs/link.txt', 'README.md');
  } catch (e) {
    return console.log('⚠ Không cập nhật được link: ' + String(e.stderr || e.message).trim().split('\n').pop());
  }
  // Đẩy lên mọi repo GitHub đã nối (origin = Maychumanglan, quanly = Quanlymanglan…).
  // Nhánh gh-pages chứa thư mục docs: GitHub tự bật trang https://<tài khoản>.github.io/<repo>/ cho nhánh này.
  console.log('Đang đẩy link mới lên GitHub…');
  let pages = '';
  try { pages = git('subtree', 'split', '--prefix', 'docs', 'HEAD'); } catch { }
  for (const remote of git('remote').split(/\s+/).filter(Boolean)) {
    const m = git('remote', 'get-url', remote).match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    try {
      git('push', remote, 'HEAD:main');
      if (pages) git('push', '--force', remote, `${pages}:refs/heads/gh-pages`);
      console.log(`✅ ${remote}: đã cập nhật.` + (m ? ` Link: https://${m[1].toLowerCase()}.github.io/${m[2]}/` : ''));
    } catch (e) {
      console.log(`⚠ ${remote}: không đẩy được (${String(e.stderr || e.message).trim().split('\n').pop()})`);
    }
  }
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
  publishToGitHub(m[0]);
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
