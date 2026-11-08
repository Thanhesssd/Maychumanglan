# Máy chủ mạng LAN: trang cung cấp địa chỉ IP

Trang web nhỏ chạy trong mạng LAN. Nó hiện **địa chỉ IP và mã QR** để các máy khác kết nối tới máy chủ
[LAN Chat bảo mật & ký số PDF](https://github.com/Thanhesssd/hethongungdungchatbaomat-kysopdf).

Chạy: bấm đúp `chay-trang-dia-chi.bat` (hoặc `node server.js`). Cần Node.js 18 trở lên, không phải cài thư viện.

| Trang | Địa chỉ | Dùng để |
|---|---|---|
| Trang kết nối | `http://localhost:3000/`, máy khác: `http://<IP máy này>:3000/` | Xem IP máy chủ LAN Chat, quét mã QR, sao chép link, cài chứng chỉ |
| Trang quản lý | `http://localhost:3000/quan-ly` | Đặt địa chỉ máy chủ LAN Chat, tự tìm máy chủ trong LAN, xem card mạng và thiết bị đang mở trang |

Mã PIN trang quản lý in ở cửa sổ máy chủ và lưu trong `data/config.json` (mục `adminPin`).
Máy khác cùng Wi‑Fi không vào được thì chạy `mo-cong-mang.bat` một lần để mở cổng 3000.

## Cách hoạt động

1. Trang địa chỉ hỏi máy chủ LAN Chat (`/api/health`) mỗi 15 giây để lấy danh sách IP của nó.
2. Trang kết nối hiện địa chỉ Wi‑Fi/LAN thật lên đầu, card mạng ảo (VMware, Hyper‑V) xuống cuối.
3. Máy chủ LAN Chat đổi IP thì trang tự cập nhật, mã QR cũng đổi theo.

Mặc định trang tìm máy chủ LAN Chat ở `http://localhost:8000` (cùng máy). Nếu máy chủ LAN Chat chạy ở máy khác,
vào trang quản lý, bấm **Bắt đầu quét** hoặc nhập `IP:8443`.
