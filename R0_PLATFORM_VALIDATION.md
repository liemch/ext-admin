# R0 — Kiểm kê nền tảng và xác minh API tạo bài

Ngày kiểm tra source/remote: 17/09/2026. Tài liệu này không chứa cookie, CSRF,
token, project ref hoặc dữ liệu bài thật.

## Đã xác minh read only

- Branch bắt đầu từ commit `7a11342`.
- Remote đang có bốn Edge Functions ACTIVE: `nvidia-proxy` v4, `admin-api` v5,
  `engagement-api` v11 và `post-sync-api` v7.
- Remote chưa có `publishing-api`.
- Migration history remote không khớp thư mục local: remote có nhiều version
  timestamp trong tháng 08/2026 không có file local; các migration local
  `001`–`016` và `20260911100410` không xuất hiện là đã áp trong kết quả kiểm kê.
  Vì vậy không được chạy `db push` hoặc setup script lên remote trước khi pull,
  đối chiếu và repair migration history có chủ đích.
- Contract đọc hiện dùng:
  - `GET /api/v1/articles/?username=<username>&page=<n>`
  - `GET /api/v1/articles/<uuid>/`
  - `GET /api/v1/articles/<uuid>/comments/?sort=new`
- Contract tạo bài mục tiêu theo đặc tả nghiệp vụ:
  `POST https://techhub.fpt.net/api/v1/articles/` với `title`, `body`,
  `community`, `terms`, `description`, `featured`, `main_image`, `author` và
  `body_type`.
- `HEAD /api/v1/articles/` không có phiên đăng nhập trả HTTP 401, header
  `Allow: GET, POST, HEAD, OPTIONS` và `WWW-Authenticate: Bearer realm="api"`.
  Điều này xác nhận route nhận POST; chưa xác định cơ chế xác thực của phiên user.

## Chưa xác minh vì cần tạo dữ liệu TechHub thật

Ngày 17/09/2026 user đã cho phép tạo một bài mẫu. Phiên chạy hiện chưa có
trình duyệt TechHub được kết nối và không có credential phiên trong môi trường,
nên chưa gửi POST. Khi có phiên, dùng một tiêu đề duy nhất ghi rõ "Bài kiểm thử
My Angel" và body ngắn giải thích bài này để xác minh API; chỉ tạo một bài,
sau đó đọc detail/list để ghi fixture đã ẩn dữ liệu nhạy cảm.

Auto publish vẫn phải giữ feature flag tắt cho tới khi một người được phép dùng
tài khoản kiểm thử chạy spike thủ công và lưu fixture đã xóa dữ liệu nhạy cảm.
Spike cần ghi lại:

1. Header CSRF/cookie tối thiểu và status code.
2. Response create có `id`, `uuid`, URL và trạng thái publish ở field nào.
3. `author: null` có dùng đúng tài khoản session hay không.
4. Ý nghĩa và quyền của `community = 35`, `terms = [178, 368, 274]`.
5. Response detail/list ngay sau create.
6. Kết quả khi title/body trùng, khi thiếu quyền, khi 429 và khi timeout sau POST.
7. TechHub có hỗ trợ idempotency key hoặc receipt kiểm chứng được hay không.

Fixture sau khi thử chỉ giữ shape và giá trị giả, ví dụ ID/UUID đã thay thế;
không lưu cookie, CSRF, tên user, email hoặc nội dung nội bộ. R6 không được gửi
POST tự động trước khi checklist này hoàn tất.
