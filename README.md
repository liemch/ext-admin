# TechHub Profile Sync - Chrome Extension

Chrome Extension để đồng bộ thông tin profile từ TechHub (techhub.fpt.net) với Supabase.

## Tính năng

- 🔐 Tự động capture Cookie và X-CSRFToken từ requests đến TechHub API
- 👤 Hiển thị thông tin profile người dùng từ localStorage
- 🔄 Đồng bộ thông tin với Supabase database
- ✨ Tự động tạo mới hoặc cập nhật user khi mở popup

## Cài đặt

### 1. Cấu hình Supabase

Mở file `config.js` và thay thế các giá trị:

```javascript
const SUPABASE_CONFIG = {
  url: "YOUR_SUPABASE_URL", // Ví dụ: 'https://xxxxx.supabase.co'
  anonKey: "YOUR_SUPABASE_ANON_KEY", // Anon/Public key
  tableName: "users",
};
```

### 2. Tạo bảng trong Supabase

Chạy SQL sau trong Supabase SQL Editor:

```sql
-- Tạo bảng users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150),
    username VARCHAR(100) UNIQUE,
    email VARCHAR(255),
    avatar TEXT,
    cookie TEXT,
    x_csrf_token VARCHAR(255),
    last_update TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tạo index cho username để tìm kiếm nhanh hơn
CREATE INDEX idx_users_username ON users(username);

-- Tạo bảng posts
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    title TEXT,
    status VARCHAR(50),
    techhub_id BIGINT UNIQUE,
    techhub_uuid VARCHAR(100),
    username VARCHAR(100),
    url TEXT,
    votes_score FLOAT DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    feed_score FLOAT DEFAULT 0,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tạo index cho posts
CREATE INDEX idx_posts_username ON posts(username);
CREATE INDEX idx_posts_techhub_id ON posts(techhub_id);
```

### 3. Cấu hình RLS (Row Level Security) trong Supabase

Nếu bật RLS, cần tạo policy cho phép insert/update:

```sql
-- Disable RLS for testing (hoặc tạo policy phù hợp)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE posts DISABLE ROW LEVEL SECURITY;

-- Hoặc tạo policy cho phép tất cả operations
CREATE POLICY "Allow all operations" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON posts FOR ALL USING (true) WITH CHECK (true);
```

### 4. Thêm Icons

Tạo các file icon với kích thước tương ứng trong thư mục `icons/`:

- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

Bạn có thể tạo icon đơn giản hoặc sử dụng logo TechHub.

### 5. Cài đặt Extension

1. Mở Chrome và truy cập `chrome://extensions/`
2. Bật **Developer mode** (góc phải trên)
3. Click **Load unpacked**
4. Chọn thư mục `techhub-extension`

## Cách sử dụng

1. **Đăng nhập TechHub**: Mở https://techhub.fpt.net và đăng nhập tài khoản
2. **Trigger capture**: Truy cập trang profile hoặc thực hiện các thao tác gọi API profile
3. **Mở Popup**: Click vào icon extension để mở popup
4. **Đồng bộ**: Extension sẽ tự động đồng bộ hoặc click nút "Đồng bộ với Supabase"

## Cấu trúc thư mục

```
techhub-extension/
├── manifest.json         # Cấu hình extension
├── background.js         # Service worker - capture headers
├── popup.html           # Giao diện popup
├── popup.css            # Styles cho popup
├── popup.js             # Logic xử lý popup
├── config.js            # Cấu hình Supabase
├── supabase-client.js   # Client tương tác với Supabase
├── icons/               # Thư mục chứa icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md            # Hướng dẫn này
```

## Luồng hoạt động

1. **Background Script** lắng nghe requests đến `https://techhub.fpt.net/api/v1/accounts/profile`
2. Khi có request, extract Cookie và X-CSRFToken từ headers
3. Lưu credentials vào `chrome.storage.local`
4. Khi mở **Popup**:
   - Đọc `userProfile` từ localStorage của tab TechHub
   - Đọc credentials từ storage
   - Kiểm tra user trong Supabase:
     - Nếu chưa có → Tạo mới
     - Nếu đã có → Cập nhật Cookie và CSRF Token

## Troubleshooting

### Extension không capture được headers

- Đảm bảo đã mở tab TechHub và đăng nhập
- Thử refresh trang TechHub và truy cập profile

### Lỗi kết nối Supabase

- Kiểm tra `SUPABASE_URL` và `SUPABASE_ANON_KEY` trong config.js
- Đảm bảo đã tạo bảng `users` trong Supabase
- Kiểm tra RLS policy nếu đã bật

### Không thấy thông tin profile

- Đảm bảo đã đăng nhập TechHub
- Kiểm tra `userProfile` trong localStorage của techhub.fpt.net

## License

MIT License
