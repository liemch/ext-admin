# My Angel

Chrome Extension (MV3) hỗ trợ quản lý bài viết trên [TechHub](https://techhub.fpt.net): quét bài, AI trả lời comment, AI tự thảo luận, tương tác chéo giữa các user, auto comment và hẹn xóa bài.

## Tính năng

- Capture phiên TechHub (cookie / CSRF) trong background
- Quét bài của user (bỏ bài đã `published_at`) → lưu Supabase
- Hiển thị điểm bài: `1 cmt = 0.2` · `1 vote = 0.1` · `1 medal = 6`
- **Tương tác chéo giữa các user**: hàng đợi trung tâm (`engagement-api`) chia task vote/comment
  cho từng máy theo campaign — phân phối công bằng, cooldown, giới hạn ngày, claim atomic;
  chạy nền im lặng, hết phiên TechHub thì dừng và báo đăng nhập lại trong panel
- **Kịch bản thảo luận A/B**: import JSON 2–4 turn (hoặc format cũ `discussion`/`answer`),
  máy khách và máy chủ bài thay phiên comment/reply nối chuỗi, admin sửa và chạy lại từng turn
- **AI trả lời comment**: đọc nội dung bài + chuỗi hội thoại → NVIDIA gen → lưu `reply_drafts` → reply
- **AI tự thảo luận**: gen comment gốc trên chính bài viết, đếm mục tiêu từng bài,
  chạy ngẫu nhiên mỗi 1–5 phút → lưu `discussion_drafts`
- **Auto comment** trên bài của mình hoặc nhập ID bài thành viên khác, tự chia nhịp để hoàn thành đủ số lượng trong thời gian đã chọn, chạy ngay hoặc hẹn giờ; có thể tự xóa cuốn chiếu và xem nhật ký xóa từng comment
- **Quản lý người dùng**: xem danh sách user dùng extension, cấp/thu quyền admin,
  khóa/mở khóa (user bị khóa không mở được panel), xem số bài đã lưu và comment hôm nay
- **Hẹn xóa bài** qua `DELETE /api/v1/articles/{uuid}/`
- **Đồng bộ bài viết (post-sync)** — máy admin/leader quét feed và verify hint tự động;
  máy user chỉ gửi gợi ý nhẹ khi mở bài (không quét feed, không gây tải TechHub từ máy người dùng).
  Campaign tương tác chéo chỉ chọn bài `verification_status = verified`, và tự hủy
  các task nhắm vào bài đã đóng/xóa/rejected. Chi tiết: [`PLAN_POST_SYNC.md`](PLAN_POST_SYNC.md).
- UI dashboard: sidebar tính năng, bảng bài viết có tìm kiếm, tự co gọn trong side panel;
  mở full tab bằng nút "Mở dạng tab"

## Cài đặt nhanh

### 1. Cấu hình

Copy `config.example.js` → `config.js` (nếu chưa có) và điền.
`config.js` đã nằm trong `.gitignore` — **không bao giờ commit key lên repo**.

NVIDIA có 2 chế độ:

- **`mode: "proxy"` (khuyên dùng)** — extension gọi qua Supabase Edge Function,
  key NVIDIA nằm trong Supabase secret, người cài extension không đọc được key.
  Deploy theo [`supabase/functions/nvidia-proxy/README.md`](supabase/functions/nvidia-proxy/README.md).
- **`mode: "direct"`** — key nằm thẳng trong `config.js`. Ai cài extension cũng đọc được
  (chrome://extensions → xem nguồn). Chỉ dùng khi extension chạy trên máy của riêng mình.

```javascript
const SUPABASE_CONFIG = {
  url: "https://xxxxx.supabase.co",
  anonKey: "your-supabase-anon-key",
  tableName: "users",
};

const NVIDIA_CONFIG = {
  mode: "proxy", // "proxy" | "direct"
  proxyUrl: "https://<project-ref>.supabase.co/functions/v1/nvidia-proxy",
  proxyToken: "your-proxy-token",
  apiKey: "", // chỉ điền khi mode: "direct"
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  maxTokens: 256,
  temperature: 1,
  topP: 0.95,
  enableThinking: false,
};
```

API key NVIDIA: https://build.nvidia.com/settings/api-keys

> ⚠️ **Nếu key từng bị commit lên repo (kể cả repo private): coi như key đã lộ —
> revoke ngay và tạo key mới.** Key cũ vẫn nằm trong git history dù đã xóa file.

### 2. Setup Supabase

**Cách nhanh (khuyên dùng):** chạy script một phát — deploy 3 edge functions
(`nvidia-proxy` che NVIDIA key, `admin-api` quản lý user, `engagement-api` hàng đợi
tương tác chéo), set secrets, áp migration `011` (chặn anon tự cấp `is_admin`) và
`012` (hàng đợi tương tác), test và in sẵn khối `config.js` (bản admin đủ token,
bản user chỉ có URL):

```bash
bash scripts/setup-supabase.sh
```

**Thủ công:** trong SQL Editor, chạy lần lượt:

1. `supabase/migrations/001_init_schema.sql`
2. `supabase/migrations/002_seed_settings_and_templates.sql` (sửa `YOUR_TECHHUB_USERNAME`)
3. `supabase/migrations/003_auto_reply.sql` (chỉ khi upgrade DB cũ)
4. `supabase/migrations/004_ai_reply_drafts.sql`
5. `supabase/migrations/005_ai_discussion.sql`
6. `006` → `010` (thảo luận gốc, medals, queue draft, community)
7. `supabase/migrations/011_restrict_users_writes.sql` — **bắt buộc**: chặn anon
   tự cấp `is_admin` / xóa user (cần deploy `admin-api` trước — script trên làm sẵn)
8. `supabase/migrations/012_cross_user_engagement.sql` — hàng đợi tương tác chéo
   (`engagement_*`, `discussion_threads/turns`) + RPC claim atomic (cần deploy
   `engagement-api` — xem [`supabase/functions/engagement-api/README.md`](supabase/functions/engagement-api/README.md))

Chi tiết bảng / kiểm tra: xem [`supabase/README.md`](supabase/README.md).

### 3. Load extension

1. Mở `chrome://extensions/`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục project này
4. Đăng nhập https://techhub.fpt.net rồi mở **My Angel** (side panel hoặc tab)

Máy user thường chỉ cần thêm URL hàng đợi (không cần token — thiết bị tự đăng ký,
server chỉ lưu hash để thu hồi từng máy khi cần):

```javascript
const ENGAGEMENT_API_CONFIG = {
  url: "https://<project-ref>.supabase.co/functions/v1/engagement-api",
  adminToken: "", // máy admin điền ADMIN_TOKEN, máy user để trống
};
```

Phân quyền theo bảng `users`:

- `is_admin = true`: thấy toàn bộ menu (Tự động hóa, Bài người khác, Nguy hiểm, Người dùng)
- `is_admin = false`: chỉ thấy Bài viết + Thống kê + Tương tác (bật/tắt máy mình, xem tiến độ)
- `is_locked = true`: bị chặn khỏi extension

## Cách dùng

| Menu | Việc làm |
|------|----------|
| **Bài của tôi** | Quét bài, chọn bài, xem điểm |
| **Người dùng** | Xem danh sách user, cấp/thu quyền admin, khóa/mở khóa, xóa user |
| **AI trả lời** | Bật tự trả lời / chạy 1 lần (NVIDIA hoặc template), phạm vi tất cả bài hoặc chỉ bài đã chọn |
| **AI thảo luận** | Bật / chạy 1 lần gen comment độc lập, có phạm vi như trên |
| **Auto comment** | Chọn bài → nhập số cmt → Bắt đầu |
| **Hẹn xóa bài** | Nhập `techhub_id` + thời gian, hoặc Xóa ngay |
| **Tương tác** (mọi user) | Bật hàng đợi → máy tự nhận task vote/comment khi campaign chạy; hết phiên thì đăng nhập lại theo banner |
| **Tương tác** (admin) | Tạo campaign, import kịch bản JSON, xem task/threads, vận hành (kill switch, thiết bị, dọn log) |

Chi tiết kiến trúc và phân phối task: xem [`PLAN_CROSS_USER_ENGAGEMENT.md`](PLAN_CROSS_USER_ENGAGEMENT.md).

Nút mở rộng (góc header) mở UI dạng tab full.

## Cấu trúc

```
ext-admin/
├── manifest.json
├── background.js          # Service worker (jobs, TechHub API)
├── popup.html / .css / .js
├── config.js              # Secrets (không commit public)
├── config.example.js
├── supabase-client.js
├── nvidia-client.js
├── engagement-client.js   # Gọi engagement-api (device token + admin token)
├── engagement-worker.js   # Worker hàng đợi: claim → vote/comment/reply → báo kết quả
├── engagement-ui.js       # Panel Tương tác (user + admin)
├── discussion-import.js   # Validate kịch bản thảo luận JSON (dùng chung UI + test)
├── icons/angel.png
├── privacy_policy.html
├── scripts/
│   ├── setup-supabase.sh  # Deploy functions + migrations + in config mẫu
│   └── test-engagement.mjs# Kiểm thử offline (`node scripts/test-engagement.mjs`)
├── supabase/
│   ├── README.md
│   ├── functions/engagement-api/
│   └── migrations/
└── README.md
```

## Luồng chính

1. Background bắt session TechHub → lưu `chrome.storage.local`
2. Quét bài → `posts` (chưa publish)
3. Auto-reply: fetch nội dung bài + comments → AI/template → reply (`ancestry`) → `interactions` + `reply_drafts`
4. AI thảo luận: gen comment độc lập → `discussion_drafts` + `interactions`
5. Auto-comment / hẹn xóa chạy qua alarm + storage state
6. Tương tác chéo: admin tạo campaign → server sinh task → máy user heartbeat +
   claim 1 task/lease → vote/comment/reply trên TechHub → báo kết quả; kịch bản
   thảo luận mở dần từng turn theo comment ID thật

## Troubleshooting

- **Không có quyền admin** → set `is_admin = true` cho username trong bảng `users`
- **AI lỗi / key** → kiểm tra `NVIDIA_CONFIG.apiKey` trong `config.js`
- **Banner "cần đăng nhập lại TechHub"** → mở techhub.fpt.net đăng nhập, quay lại
  panel Tương tác bấm "Kiểm tra phiên" để mở lại task
- **Máy báo "thiết bị đã bị thu hồi"** → admin mở Tương tác → Vận hành → bỏ thu hồi máy đó
- **Kiểm thử offline** → `node scripts/test-engagement.mjs` (validate kịch bản JSON,
  logic worker thuần, đối chiếu UI/background/edge/migration)
- **Không lấy comment / reply** → mở TechHub đã đăng nhập, reload extension
- **Thiếu bảng draft** → chạy migration `004` và `005`

## License

MIT License
