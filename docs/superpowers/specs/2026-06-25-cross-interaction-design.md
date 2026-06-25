# TechHub Extension - Cross-Interaction Design Specification

## Overview
Mục đích của dự án này là phát triển tính năng "Cross-Like & Comment" cho Chrome Extension TechHub Profile Sync. Tính năng này cho phép các người dùng sử dụng extension tự động tương tác chéo (like và comment) trên các bài viết của nhau nhằm tăng độ tương tác nội bộ, sử dụng cơ sở dữ liệu Supabase làm trung tâm điều phối.

## 1. Database Architecture (Supabase)
Để phục vụ việc bình luận và tránh tương tác lặp lại (spam), hệ thống bổ sung thêm 2 bảng sau trên Supabase:

### Bảng `comment_templates`
Chứa danh sách các câu bình luận mẫu.
- `id` (SERIAL PRIMARY KEY)
- `content` (TEXT): Nội dung câu bình luận.
- `is_active` (BOOLEAN DEFAULT TRUE): Trạng thái hoạt động của mẫu câu.
- `created_at` (TIMESTAMP)

### Bảng `interactions`
Lưu trữ lịch sử tương tác để phục vụ việc loại trừ bài viết đã tương tác.
- `id` (SERIAL PRIMARY KEY)
- `username` (VARCHAR): Tên đăng nhập của người thực hiện hành động.
- `techhub_id` (BIGINT): ID của bài viết được tương tác.
- `interaction_type` (VARCHAR): Loại tương tác (`like` hoặc `comment`).
- `created_at` (TIMESTAMP)

*Chỉ mục (Indexes):* Cần đánh index combo `(username, techhub_id, interaction_type)` để tối ưu tốc độ truy vấn lọc bài viết.

## 2. Background Task Processing
- **Trigger:** Sử dụng `chrome.alarms` để thiết lập tiến trình chạy ngầm (Background Service Worker). Chu kỳ kích hoạt: Mỗi 30 phút một lần (hoặc có thể tuỳ chỉnh).
- **Throttling/Rate Limiting:** Để tránh bị API TechHub nhận diện là bot/spam, mỗi lần chu kỳ `alarm` kích hoạt, extension chỉ chọn ngẫu nhiên tối đa **3-5 bài viết mới** để tương tác.
- **Human Emulation:** Chèn một khoảng delay ngẫu nhiên (VD: 3s đến 7s) giữa các API request (giữa Like và Comment, hoặc giữa các bài viết) để mô phỏng hành vi thao tác của con người.

## 3. Data Flow & Interaction Logic
Khi Background Worker kích hoạt, luồng xử lý như sau:

1. **Kiểm tra trạng thái:** Đọc từ `chrome.storage.local` xem tính năng Auto-Interact có đang được Bật hay không. Đọc `username` hiện tại và credentials (`Cookie`, `X-CSRFToken`).
2. **Lọc bài viết:** Gửi request đến API của Supabase để lấy danh sách bài viết từ bảng `posts` với điều kiện:
   - Thuộc về những user khác (không lấy bài của chính mình).
   - Chưa tồn tại bản ghi trong bảng `interactions` ứng với `username` và `interaction_type` tương ứng.
3. **Lấy Template:** Lấy ngẫu nhiên các nội dung từ bảng `comment_templates`.
4. **Thực thi:**
   - **Like API:** Gọi API TechHub để thả tim. Thành công -> Insert vào bảng `interactions` với type `like`.
   - Delay ngẫu nhiên.
   - **Comment API:** Gọi API TechHub để comment nội dung template. Thành công -> Insert vào bảng `interactions` với type `comment`.

## 4. User Interface (Popup)
- **Cấu hình (Settings Toggle):** Thêm một Switch Button "Bật/Tắt Auto Chéo Bài" trên giao diện Popup. Khi tắt, Background Task sẽ lập tức ngừng xử lý logic ở chu kỳ tiếp theo.
- **Bảng Thống kê:** Bổ sung hiển thị số liệu cơ bản trong thời gian thực:
  - "Số lượt Like tự động: X"
  - "Số lượt Comment tự động: Y"
  - Thống kê này có thể lấy trực tiếp bằng cách Count trong bảng `interactions` theo `username` hiện tại.

## 5. Error Handling & Edge Cases
- **Token hết hạn:** Nếu gọi API TechHub trả về 401/403, tạm dừng logic Auto-Interact và không thử lại cho đến khi user mở lại trang TechHub để extension cào lại Token mới.
- **Network errors:** Có cơ chế retry nhẹ (1-2 lần) hoặc bỏ qua bài viết đó và thử lại ở chu kỳ alarm sau.
