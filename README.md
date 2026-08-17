# My Angel

Chrome Extension (MV3) hỗ trợ quản lý bài viết trên [TechHub](https://techhub.fpt.net): quét bài, AI trả lời comment, AI tự thảo luận, auto comment và hẹn xóa bài.

## Tính năng

- Capture phiên TechHub (cookie / CSRF) trong background
- Quét bài của user (bỏ bài đã `published_at`) → lưu Supabase
- Hiển thị điểm bài: `1 cmt = 0.2` · `1 vote = 0.1` · `1 medal = 6`
- **AI trả lời comment**: đọc nội dung bài + chuỗi hội thoại → NVIDIA gen → lưu `reply_drafts` → reply
- **AI tự thảo luận**: gen comment gốc trên chính bài viết, đếm mục tiêu từng bài,
  chạy ngẫu nhiên mỗi 1–5 phút → lưu `discussion_drafts`
- **Auto comment** 1 bài (random 2–5 giây, đủ số lượng thì dừng), chạy ngay hoặc hẹn giờ bắt đầu
- **Hẹn xóa bài** qua `DELETE /api/v1/articles/{uuid}/`
- UI dashboard: sidebar tính năng, bảng bài viết có tìm kiếm, tự co gọn trong side panel;
  mở full tab bằng nút "Mở dạng tab"

## Cài đặt nhanh

### 1. Cấu hình

Copy `config.example.js` → `config.js` (nếu chưa có) và điền:

```javascript
const SUPABASE_CONFIG = {
  url: "https://xxxxx.supabase.co",
  anonKey: "your-supabase-anon-key",
  tableName: "users",
};

const NVIDIA_CONFIG = {
  apiKey: "nvapi-...",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  maxTokens: 256,
  temperature: 1,
  topP: 0.95,
  enableThinking: false,
};
```

API key NVIDIA: https://build.nvidia.com/settings/api-keys

### 2. Setup Supabase

Trong SQL Editor, chạy lần lượt:

1. `supabase/migrations/001_init_schema.sql`
2. `supabase/migrations/002_seed_settings_and_templates.sql` (sửa `YOUR_TECHHUB_USERNAME`)
3. `supabase/migrations/003_auto_reply.sql` (chỉ khi upgrade DB cũ)
4. `supabase/migrations/004_ai_reply_drafts.sql`
5. `supabase/migrations/005_ai_discussion.sql`

Chi tiết bảng / kiểm tra: xem [`supabase/README.md`](supabase/README.md).

### 3. Load extension

1. Mở `chrome://extensions/`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục project này
4. Đăng nhập https://techhub.fpt.net rồi mở **My Angel** (side panel hoặc tab)

User trong DB cần `is_admin = true` mới vào được panel admin.

## Cách dùng

| Menu | Việc làm |
|------|----------|
| **Bài của tôi** | Quét bài, chọn bài, xem điểm |
| **AI trả lời** | Bật tự trả lời / chạy 1 lần (NVIDIA hoặc template), phạm vi tất cả bài hoặc chỉ bài đã chọn |
| **AI thảo luận** | Bật / chạy 1 lần gen comment độc lập, có phạm vi như trên |
| **Auto comment** | Chọn bài → nhập số cmt → Bắt đầu |
| **Hẹn xóa bài** | Nhập `techhub_id` + thời gian, hoặc Xóa ngay |

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
├── icons/angel.png
├── privacy_policy.html
├── supabase/
│   ├── README.md
│   └── migrations/
└── README.md
```

## Luồng chính

1. Background bắt session TechHub → lưu `chrome.storage.local`
2. Quét bài → `posts` (chưa publish)
3. Auto-reply: fetch nội dung bài + comments → AI/template → reply (`ancestry`) → `interactions` + `reply_drafts`
4. AI thảo luận: gen comment độc lập → `discussion_drafts` + `interactions`
5. Auto-comment / hẹn xóa chạy qua alarm + storage state

## Troubleshooting

- **Không có quyền admin** → set `is_admin = true` cho username trong bảng `users`
- **AI lỗi / key** → kiểm tra `NVIDIA_CONFIG.apiKey` trong `config.js`
- **Không lấy comment / reply** → mở TechHub đã đăng nhập, reload extension
- **Thiếu bảng draft** → chạy migration `004` và `005`

## License

MIT License
