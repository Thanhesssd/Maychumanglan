// Cấu hình trang Quanlymanglan bản GitHub.
// SUPABASE_URL và SUPABASE_ANON_KEY lấy ở Supabase > Project Settings > API.
// Khóa "anon" là khóa CÔNG KHAI (an toàn khi đặt trên trang web, quyền đã được chặn bằng bảo mật theo dòng).
// TUYỆT ĐỐI không dán khóa "service_role" vào đây.
// Còn để trống thì trang dùng tạm máy chủ trên laptop như trước.
window.CAU_HINH = {
  SUPABASE_URL: 'https://sqneggastdqdboumkrun.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_s5tQTmY29VONWnsAqlaF7w_aNcsUjAu',
  // Máy chủ LAN Chat tự ghi địa chỉ hiện tại vào file này (xem repo hethongungdungchatbaomat-kysopdf)
  LANCHAT_DIRECTORY: 'https://thanhesssd.github.io/hethongungdungchatbaomat-kysopdf/ui/ui/ui/may-chu.json',
  // App LAN Chat bản GitHub: tự đọc địa chỉ máy chủ và kết nối
  CHAT_WEB: 'https://thanhesssd.github.io/hethongungdungchatbaomat-kysopdf/ui/ui/ui/'
    + encodeURIComponent('Ứng dụng Chat LAN Bảo mật & Ký số PDF.html'),
};
