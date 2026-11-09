'use strict';
// Điểm khởi động khi chạy trên máy chủ đám mây (Render): tải dữ liệu từ Supabase rồi mới chạy server.js.
// Trên laptop vẫn chạy "node server.js" như cũ.
const path = require('path');
const store = require('./cloud-store');

const DATA = process.env.LAN_DATA || path.join(__dirname, 'data');

(async () => {
  if (!store.enabled) {
    console.log('⚠ Chưa đặt SUPABASE_URL / SUPABASE_SERVICE_KEY: dữ liệu chỉ nằm trên ổ đĩa tạm, sẽ mất khi máy chủ ngủ.');
  } else {
    try {
      const n = await store.pull(DATA);
      console.log(`Đã tải ${n} tệp dữ liệu từ Supabase.`);
    } catch (e) {
      // Không tải được thì dừng hẳn, tránh chạy với dữ liệu trống rồi ghi đè mất tài khoản trên Supabase
      console.error('Không tải được dữ liệu từ Supabase: ' + e.message);
      process.exit(1);
    }
  }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await store.flush().catch(() => {}); process.exit(0); });
  require('./server.js');
})();
