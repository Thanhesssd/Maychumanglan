# Cửa hàng LAN: quầy mua hàng + trang quản lý + LAN Chat

Chạy: bấm đúp `chay-cua-hang.bat` (hoặc `node server.js`). Cần Node.js 18 trở lên, không phải cài thư viện.

| Trang | Địa chỉ |
|---|---|
| Quầy mua hàng | `http://localhost:3000/` · máy khác: `http://<IP máy chủ>:3000/` |
| Trang quản lý | `http://localhost:3000/quan-ly` (mã PIN in ở cửa sổ máy chủ, lưu trong `data/config.json`) |

Máy khác cùng Wi‑Fi không vào được thì chạy `mo-cong-mang.bat` một lần để mở cổng 3000.

## Kết nối với LAN Chat (repo hethongungdungchatbaomat-kysopdf)

1. Chạy máy chủ LAN Chat (`ui/ui/ui/chay-may-chu.bat` bên repo đó).
2. Trang quản lý → tab **LAN Chat** → nhập địa chỉ (`http://localhost:8000` nếu cùng máy, `https://<IP>:8443` nếu khác máy) → **Lưu và kết nối lại**. App tự tạo tài khoản bot.
3. Nhân viên mở app LAN Chat, tìm tên bot, gửi lời mời kết bạn → bấm **Đồng ý** trong trang quản lý.
4. Mỗi đơn mới được gửi vào chat, mã hóa đầu‑cuối. Nhân viên nhắn `don`, `ma DH0001`, `xn DH0001`, `giao DH0001`, `huy DH0001`, `doanh thu`.

## Sửa dữ liệu

- `products.json`: bảng giá (đang là **giá mẫu**, thay bằng giá thật). Sửa xong tải lại trang quầy.
- `data/config.json`: tên cửa hàng, PIN, tài khoản ngân hàng (`bank.bin` là mã BIN ngân hàng, `bank.account` là số tài khoản; điền đủ thì mã QR là VietQR thật).
- `data/orders.json`: đơn hàng đã lưu.

Đây là bản demo: nút "Khách đã thanh toán xong" thay cho việc ngân hàng báo tiền về.
