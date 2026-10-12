# Hóa đơn dịch vụ - miễn phí (Google Sheets + Apps Script + Cloudflare Pages)

Chọn dịch vụ → tự tính tiền → xuất hóa đơn (in hoặc lưu PDF). Dữ liệu nằm trong Google Sheets của bạn.

## Bước 0: Thử ngay trên máy (không cần Google)

```bash
cd web
npm install
npm run dev
```
Mở địa chỉ hiện ra. Khi chưa có `VITE_API_URL`, app chạy "chế độ thử" và lưu tạm trong trình duyệt.

## Bước 1: Backend trên Google Sheets

1. Tạo Google Sheet mới (sheets.new).
2. Vào **Tiện ích mở rộng → Apps Script**, xóa code mẫu, dán toàn bộ `apps-script/Code.gs`.
3. Chọn hàm `setup` rồi bấm **Chạy**, cấp quyền khi được hỏi. Hàm này tạo các sheet `Services`, `Invoices`, `InvoiceItems` và 3 dịch vụ mẫu.
4. Mở **Execution log** để lấy **MÃ TRUY CẬP** (8 ký tự). Giữ kín mã này.
5. **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**:
   - Thực thi dưới dạng: **Tôi**
   - Ai có quyền truy cập: **Bất kỳ ai**
   - Sao chép URL kết thúc bằng `/exec`.
   (Mỗi lần sửa Code.gs phải triển khai lại phiên bản mới.)

Bảo mật: URL là công khai, nhưng mọi thao tác đều cần mã truy cập; giá tiền luôn được tính lại ở server.

## Bước 2: Đưa web lên Cloudflare Pages (miễn phí)

1. Tạo file `web/.env` với nội dung: `VITE_API_URL=<URL /exec ở trên>`
2. Đẩy thư mục dự án lên GitHub.
3. Cloudflare → Workers & Pages → Create → Pages → kết nối repo.
   - Root directory: `web`
   - Build command: `npm run build`
   - Output directory: `dist`
   - Biến môi trường: `VITE_API_URL` = URL `/exec`
4. Nhận link `*.pages.dev`.
5. Trên iPhone: Safari → Chia sẻ → **Thêm vào Màn hình chính**.
6. Vào tab **Cài đặt**: nhập tên cửa hàng, thông tin, và **mã truy cập** (mỗi thiết bị nhập một lần).

## Cách dùng

- **Dịch vụ**: thêm/sửa giá/ẩn dịch vụ.
- **Tạo hóa đơn**: bấm +/− số lượng, nhập khách, giảm giá → **Xuất hóa đơn** → **In / Lưu PDF**.
- **Hóa đơn**: xem lại hóa đơn cũ.

## Giai đoạn sau (đã chừa chỗ)

Chụp ảnh + Drive (theo file đặc tả), thuế VAT, thanh toán/QR, đăng nhập từng người, báo cáo doanh thu.
