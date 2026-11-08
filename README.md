# Máy chủ mạng LAN: trang cung cấp địa chỉ IP

Trang web nhỏ chạy trong mạng LAN. Nó hiện **địa chỉ IP và mã QR** để các máy khác kết nối tới máy chủ
[LAN Chat bảo mật & ký số PDF](https://github.com/Thanhesssd/hethongungdungchatbaomat-kysopdf).

Chạy: bấm đúp `chay-trang-dia-chi.bat` (hoặc `node server.js`). Cần Node.js 18 trở lên, không phải cài thư viện.

| Trang | Địa chỉ | Dùng để |
|---|---|---|
| Trang chủ | `http://localhost:3000/`, máy khác: `http://<IP máy này>:3000/` | Đăng ký, đăng nhập. Tài khoản đã được cấp quyền thấy IP máy chủ LAN Chat, mã QR, link cài chứng chỉ |
| Trang quản trị | `http://localhost:3000/quan-ly` | Cấp quyền / thu hồi / chặn tài khoản, đặt địa chỉ máy chủ LAN Chat, tự tìm máy chủ trong LAN, xem card mạng và thiết bị |

## Tài khoản và cấp quyền

1. **Tài khoản đầu tiên là quản trị viên.** Khi đăng ký phải nhập **mã thiết lập** in ở cửa sổ máy chủ
   (lưu trong `data/config.json`, mục `setupCode`). Nhờ vậy người lạ trong mạng không chiếm được quyền quản trị.
2. Người khác đăng ký sẽ ở trạng thái **Chờ cấp quyền**, chưa thấy địa chỉ IP.
3. Quản trị viên vào trang quản trị bấm **Cấp quyền**. Trang của người đó tự hiện địa chỉ IP ngay, không cần tải lại.
4. **Thu hồi** đưa tài khoản về chờ cấp quyền; **Chặn** đăng xuất người đó ngay và không cho đăng nhập lại.

Mật khẩu được băm bằng scrypt, không lưu dạng đọc được. Quên mật khẩu quản trị: tắt máy chủ, xóa `data/users.json`,
bật lại rồi đăng ký lại với mã thiết lập.

Máy khác cùng Wi‑Fi không vào được thì chạy `mo-cong-mang.bat` một lần để mở cổng 3000.

## Cách hoạt động

1. Trang địa chỉ hỏi máy chủ LAN Chat (`/api/health`) mỗi 15 giây để lấy danh sách IP của nó.
2. Trang kết nối hiện địa chỉ Wi‑Fi/LAN thật lên đầu, card mạng ảo (VMware, Hyper‑V) xuống cuối.
3. Máy chủ LAN Chat đổi IP thì trang tự cập nhật, mã QR cũng đổi theo.

Mặc định trang tìm máy chủ LAN Chat ở `http://localhost:8000` (cùng máy). Nếu máy chủ LAN Chat chạy ở máy khác,
vào trang quản lý, bấm **Bắt đầu quét** hoặc nhập `IP:8443`.
