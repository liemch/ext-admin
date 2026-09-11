# Hướng dẫn cho coding agent

## Phạm vi dự án

Đây là Chrome Extension Manifest V3 tên **My Angel**. Extension chạy trên
TechHub, lưu dữ liệu ở Supabase và dùng bốn Edge Functions:
`nvidia-proxy`, `admin-api`, `engagement-api`, `post-sync-api`.

Các file JavaScript ở thư mục gốc là plain script, không có bundler và không có
`package.json`. Thứ tự nạp script trong `background.js` và `popup.html` là một
phần của contract runtime. Không đổi sang ESM hoặc thêm framework nếu task không
yêu cầu rõ ràng.

## Bản đồ code

- `background.js`: service worker, session TechHub, alarm và điều phối worker.
- `popup.html`, `popup.css`, `popup.js`: side panel và trang quản trị.
- `supabase-client.js`, `nvidia-client.js`: client dữ liệu và AI.
- `engagement-*.js`, `discussion-import.js`: campaign, task vote/comment và chuỗi
  thảo luận nhiều turn.
- `post-sync-*.js`: hint, leader sync, feed discovery và UI đồng bộ bài.
- `supabase/functions/`: Edge Functions chạy bằng Deno.
- `supabase/migrations/`: migration PostgreSQL chạy theo số tăng dần.
- `scripts/test-*.mjs`: test offline không cần Supabase hoặc TechHub.
- `PLAN_CROSS_USER_ENGAGEMENT.md`, `PLAN_POST_SYNC.md`: contract nghiệp vụ đã
  chốt; cập nhật plan khi thay đổi kiến trúc hoặc hành vi chính.

## Cách làm việc với hai agent/chat

Trước khi sửa, chạy `git status --short --branch` và đọc diff đang có. Xem mọi
thay đổi chưa commit là công việc của người hoặc agent khác; không xóa, reset,
format hàng loạt hay ghi đè chúng.

Mỗi agent nên làm một phạm vi độc lập trên branch/worktree riêng. Dùng tên branch
ngắn mô tả nhiệm vụ. Nếu buộc phải dùng chung working tree, thống nhất trước danh
sách file mỗi agent sở hữu và không cùng sửa một file tại một thời điểm.

Commit nhỏ theo một mục đích. Trước khi bàn giao, ghi rõ:

1. commit/branch hiện tại;
2. file đã đổi và hành vi mới;
3. lệnh test đã chạy cùng kết quả;
4. migration, secret hoặc Edge Function nào còn phải deploy;
5. rủi ro hay giả định còn lại.

Không force-push, rebase, reset, stash hoặc xóa branch/worktree của agent khác.
Khi cần tích hợp, fetch trước, so sánh lịch sử và merge/cherry-pick commit đã
hoàn chỉnh. Remote chính hiện dùng GitLab, nhánh mặc định là `main`; kiểm tra
`git remote -v` trước khi push.

## Quy tắc triển khai

- Giữ tương thích Manifest V3 và service worker. Không dùng API DOM trong
  `background.js`.
- Mọi thao tác tự động nền phải im lặng. Không mở popup/thông báo khi cài
  extension, khi alarm chạy hoặc khi session TechHub hết. Chỉ hiển thị yêu cầu
  đăng nhập trong UI khi người dùng chủ động mở extension.
- User thường chỉ xem và điều khiển phần của mình. Chức năng campaign, vận hành,
  sync leader và quản lý user thuộc admin.
- Máy user không được quét feed hàng loạt. User chỉ gửi post hint nhẹ; máy admin
  leader nhận job tập trung, có lease, cooldown và giới hạn request.
- Task tương tác chỉ chạy với bài `verification_status = verified`. Giữ tính
  idempotent cho vote/comment/reply và mọi thao tác complete/retry.
- Khi thêm action API, cập nhật đồng bộ client, worker/background, Edge Function,
  UI và test contract tương ứng.
- Giữ nội dung tiếng Việt hiện có và tránh format cả file vì repo đang có cả LF
  lẫn CRLF.

## Secret và dữ liệu nhạy cảm

`config.js` bị ignore và là file local có secret. Không đọc/in toàn bộ file vào
log, không commit, không chép token vào test, plan, README hoặc `AGENTS.md`.
Chỉ sửa `config.example.js` bằng placeholder.

Không log cookie, CSRF, NVIDIA key, Supabase service-role key, `ADMIN_TOKEN`,
`PROXY_TOKEN` hoặc device token. Edge Function lấy secret từ environment. Không
đưa cookie TechHub về Supabase.

Không chạy toàn bộ `scripts/setup-supabase.sh` trên project đang hoạt động chỉ
để deploy một thay đổi: script sinh lại token. Với thay đổi nhỏ, deploy function
hoặc migration mục tiêu riêng.

## Kiểm tra bắt buộc

Chạy kiểm tra phù hợp với phạm vi đã sửa:

```bash
node scripts/test-engagement.mjs
node scripts/test-post-sync.mjs
node --check background.js
node --check popup.js
git diff --check
```

Với plain JS khác, chạy thêm `node --check <file>`. Với UI, reload unpacked
extension và kiểm tra cả side panel lẫn tab đầy đủ nếu môi trường cho phép.
Không gọi API ghi dữ liệu TechHub thật trong test tự động.

## Definition of done

Code, UI, API và migration phải khớp contract; test liên quan pass; không có
secret trong diff; working tree chỉ chứa thay đổi thuộc task. Nếu có thay đổi
Supabase, bàn giao phải nói chính xác migration/function nào cần áp dụng và thứ
tự deploy.

