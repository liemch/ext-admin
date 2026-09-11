# Hướng dẫn cho agent trong `scripts/`

File trong thư mục này là công cụ setup hoặc test offline. Áp dụng thêm các quy
tắc ở `../AGENTS.md`.

## Setup script

`setup-supabase.sh` dành cho lần khởi tạo project và có thể sinh lại
`PROXY_TOKEN`/`ADMIN_TOKEN`. Không dùng script này như lệnh deploy thường ngày.
Mọi thay đổi phải giữ `set -euo pipefail`, quote biến shell và không in secret
ngoài phần output mà người vận hành chủ động yêu cầu.

Khi thêm migration hoặc Edge Function, cập nhật số lượng, thứ tự deploy, phần
kiểm tra và config mẫu trong script. Không nhúng project ref, API key hay token
thật.

Kiểm tra tối thiểu:

```bash
bash -n scripts/setup-supabase.sh
git diff --check
```

## Test offline

Các file `test-*.mjs` phải chạy trực tiếp bằng Node, không cần package install,
network, Supabase hay phiên TechHub. Ưu tiên kiểm tra contract giữa HTML, client,
worker, background, Edge Function và migration; tránh test lặp lại nguyên văn
implementation.

Nếu thêm action hoặc DOM id, cập nhật test của feature tương ứng. Test phải trả
exit code khác 0 khi có lỗi và không đọc `config.js`.

