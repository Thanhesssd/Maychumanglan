'use strict';
// Tạo tài khoản quản trị đầu tiên ngay trong cửa sổ lệnh, không cần mở trình duyệt.
// Gửi yêu cầu tới máy chủ qua localhost, nên máy chủ coi đây là thao tác trên chính máy chủ.

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

let port = +process.env.PORT || 3000;
if (!process.env.PORT) try { port = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8')).port || 3000; } catch { }

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port, path: p, method, timeout: 5000,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) } }, res => {
      let s = '';
      res.on('data', c => (s += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(s) }); } catch { reject(new Error('Máy chủ trả lời không hợp lệ')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Máy chủ không phản hồi')));
    req.on('error', reject);
    req.end(data);
  });
}

// Đọc từng dòng vào hàng đợi, để chạy đúng cả khi gõ tay lẫn khi dữ liệu được đưa vào sẵn
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines = [], waiting = [];
let closed = false, muted = false;
rl.on('line', l => (waiting.length ? waiting.shift()(l) : lines.push(l)));
rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
// Ẩn mật khẩu khi gõ: thay ký tự hiện ra bằng dấu *
const writeOut = rl._writeToOutput.bind(rl);
rl._writeToOutput = s => writeOut(muted && !/^[\r\n]+$/.test(s) ? s.replace(/[^\r\n]/g, '*') : s);
function ask(q, hidden = false) {
  process.stdout.write(q);
  muted = hidden;
  return new Promise(resolve => {
    const done = l => {
      muted = false;
      if (!process.stdin.isTTY) process.stdout.write('\n');
      if (l === null) { console.log('\nĐã thoát.'); process.exit(0); }
      resolve(hidden ? l : l.trim());
    };
    if (lines.length) done(lines.shift()); else if (closed) done(null); else waiting.push(done);
  });
}
const askHidden = q => ask(q, true);

(async () => {
  let me;
  try { me = (await request('GET', '/api/auth/me')).data; }
  catch {
    console.log(`\nMáy chủ chưa chạy ở cổng ${port}. Bấm đúp chay-trang-dia-chi.bat trước, rồi chạy lại file này.`);
    return rl.close();
  }
  if (!me.needSetup) {
    console.log('\nĐã có quản trị viên. Đăng nhập tại http://localhost:' + port + '/quan-ly');
    console.log('Quên mật khẩu: tắt máy chủ, xóa data\\users.json, bật lại rồi chạy file này.');
    return rl.close();
  }
  console.log('\n=== TẠO TÀI KHOẢN QUẢN TRỊ ===');
  for (;;) {
    const name = await ask('Họ và tên: ');
    const username = (await ask('Tên đăng nhập (chữ không dấu, số, . _ -): ')).toLowerCase();
    const password = await askHidden('Mật khẩu (ít nhất 6 ký tự): ');
    const again = await askHidden('Nhập lại mật khẩu: ');
    if (password !== again) { console.log('→ Hai mật khẩu không khớp, nhập lại.\n'); continue; }
    const r = await request('POST', '/api/auth/register', { name, username, password }).catch(e => ({ status: 0, data: { error: e.message } }));
    if (r.status === 200) {
      console.log(`\n✅ Đã tạo quản trị viên "${r.data.user.name}" (${r.data.user.username}).`);
      console.log(`Mở http://localhost:${port}/quan-ly và đăng nhập bằng tài khoản này.`);
      break;
    }
    console.log('→ ' + r.data.error + '\n');
    if (r.status !== 400 && r.status !== 409) break;
  }
  rl.close();
})();
