# Máy chủ mạng LAN: trang cung cấp địa chỉ IP

Trang web nhỏ chạy trong mạng LAN. Nó hiện **địa chỉ IP và mã QR** để các máy khác kết nối tới máy chủ
[LAN Chat bảo mật & ký số PDF](https://github.com/Thanhesssd/hethongungdungchatbaomat-kysopdf).

## 🔗 Link truy cập app

**https://scenarios-accessing-throughout-frontpage.trycloudflare.com**

Link cố định (không đổi, tự chuyển tới app): **https://thanhesssd.github.io/Maychumanglan/**

Mở được trên Chrome ở mọi nơi (Wi‑Fi, 4G). Link chỉ hoạt động khi máy chủ đang bật, và **đổi mỗi lần bật lại đường hầm**:
khi đó chủ máy chủ cập nhật link mới vào đây. GitHub chỉ lưu code; app chạy trên máy chủ của chủ sở hữu.

## Chạy máy chủ

1. Bấm đúp `chay-trang-dia-chi.bat` (hoặc `node server.js`). Cần Node.js 18 trở lên, không phải cài thư viện.
   Luôn mở qua `http://localhost:3000/`, không mở thẳng file HTML.
2. Lần đầu: bấm đúp `tao-quan-tri.bat` để tạo tài khoản quản trị (hoặc đăng ký tại `http://localhost:3000/` trên máy chủ).
3. Bật máy chủ LAN Chat (`chay-may-chu.bat` bên repo LAN Chat). Ở trang quản trị, ô **Địa chỉ máy chủ LAN Chat**
   để `http://localhost:8000` nếu cùng máy, hoặc `IP:8443` nếu khác máy.
4. Muốn người ngoài mạng LAN mở được: cài một lần `winget install --id Cloudflare.cloudflared`, rồi bấm đúp
   `chia-se-internet.bat`. Cửa sổ in ra link `https://….trycloudflare.com`; giữ cửa sổ mở thì link còn chạy.

| Trang | Địa chỉ | Dùng để |
|---|---|---|
| Trang chủ | `http://localhost:3000/`, máy khác: `http://<IP máy này>:3000/` | Đăng ký, đăng nhập. Tài khoản đã được cấp quyền thấy IP máy chủ LAN Chat, mã QR, link cài chứng chỉ |
| Trang quản trị | `http://localhost:3000/quan-ly` | Cấp quyền / thu hồi / chặn tài khoản, đặt địa chỉ máy chủ LAN Chat, tự tìm máy chủ trong LAN, xem card mạng và thiết bị |

## Tài khoản và cấp quyền

1. **Tài khoản đầu tiên là quản trị viên** và chỉ tạo được **trên chính máy chủ** (mở `http://localhost:3000/`).
   Máy khác trong mạng hoặc khách qua link Internet đăng ký lúc chưa có quản trị viên sẽ bị từ chối,
   nên người lạ không chiếm được quyền quản trị.
2. Người khác đăng ký sẽ ở trạng thái **Chờ cấp quyền**, chưa thấy địa chỉ IP.
3. Quản trị viên vào trang quản trị bấm **Cấp quyền**. Trang của người đó tự hiện địa chỉ IP ngay, không cần tải lại.
4. **Thu hồi** đưa tài khoản về chờ cấp quyền; **Chặn** đăng xuất người đó ngay và không cho đăng nhập lại.
5. **Mời người dùng:** ở trang quản trị nhập tên người cần mời và bấm **Tạo link mời**, rồi sao chép link gửi đi.
   Người đó đăng ký qua link là được cấp quyền ngay. Link dùng một lần, hết hạn sau 7 ngày; khi đường hầm Internet
   đang bật, link mời dùng link Internet.

Mật khẩu được băm bằng scrypt, không lưu dạng đọc được. Quên mật khẩu quản trị: tắt máy chủ, xóa `data/users.json`,
bật lại rồi đăng ký lại trên máy chủ.

Máy khác cùng Wi‑Fi không vào được thì chạy `mo-cong-mang.bat` một lần để mở cổng 3000.

## Cách hoạt động

1. Trang địa chỉ hỏi máy chủ LAN Chat (`/api/health`) mỗi 15 giây để lấy danh sách IP của nó.
2. Trang kết nối hiện địa chỉ Wi‑Fi/LAN thật lên đầu, card mạng ảo (VMware, Hyper‑V) xuống cuối.
3. Máy chủ LAN Chat đổi IP thì trang tự cập nhật, mã QR cũng đổi theo.

Mặc định trang tìm máy chủ LAN Chat ở `http://localhost:8000` (cùng máy). Nếu máy chủ LAN Chat chạy ở máy khác,
vào trang quản lý, bấm **Bắt đầu quét** hoặc nhập `IP:8443`.
