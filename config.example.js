// Cấu hình Supabase
// ⚠️ QUAN TRỌNG: Copy file này thành config.js và điền thông tin của bạn.
// config.js đã nằm trong .gitignore — KHÔNG BAO GIỜ commit key lên repo.

const SUPABASE_CONFIG = {
  // URL của Supabase project
  url: "https://xxxxx.supabase.co",

  // Anon/Public key của Supabase
  anonKey: "your-supabase-anon-key",

  // Tên bảng users
  tableName: "users",
};

// Admin API — edge function quản lý user (danh sách / cấp-thu quyền / khóa / xóa)
// ⚠️ CHỈ điền trên máy quản trị viên. Token (ADMIN_TOKEN) sinh bởi
// scripts/setup-supabase.sh — tuyệt đối không gửi cho user thường.
// User thường để: { url: "", token: "" }
const ADMIN_API_CONFIG = {
  url: "https://xxxxx.supabase.co/functions/v1/admin-api",
  token: "your-admin-token",
};

// NVIDIA NIM (AI trả lời / thảo luận)
//
// Có 2 chế độ:
//
// 1) mode: "proxy" — KHUYÊN DÙNG, nhất là khi chia sẻ extension cho người khác.
//    Extension gọi qua Supabase Edge Function, key NVIDIA nằm trong Supabase
//    secret nên KHÔNG nằm trong extension. Deploy theo:
//    supabase/functions/nvidia-proxy/README.md
//
// 2) mode: "direct" — gọi thẳng NVIDIA bằng apiKey dưới đây.
//    ⚠️ Key nằm thẳng trong file này: bất kỳ ai cài extension đều đọc được
//    (mở chrome://extensions → xem nguồn extension). Chỉ dùng khi extension
//    này chạy trên máy của riêng mình.
//
const NVIDIA_CONFIG = {
  mode: "proxy",

  // ---- Chế độ proxy ----
  // URL edge function: https://<project-ref>.supabase.co/functions/v1/nvidia-proxy
  proxyUrl: "YOUR_EDGE_FUNCTION_URL",
  // Giống PROXY_TOKEN đã đặt: supabase secrets set PROXY_TOKEN=...
  proxyToken: "your-proxy-token",

  // ---- Chế độ direct (để trống khi dùng proxy) ----
  apiKey: "",
  baseUrl: "https://integrate.api.nvidia.com/v1",

  // ---- Chung cho cả 2 chế độ ----
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  maxTokens: 256,
  temperature: 1,
  topP: 0.95,
  // Tắt thinking cho reply/thảo luận ngắn (nhanh hơn, tiết kiệm token)
  enableThinking: false,
};

// Engagement API — edge function điều phối tương tác giữa các user
// (hàng đợi task, campaign, kịch bản thảo luận). Xem:
// supabase/functions/engagement-api/README.md
//
// - Mọi máy (kể cả user thường) đều điền `url` để nhận task từ hàng đợi
//   trung tâm. Thiết bị tự đăng ký bằng device token riêng, server chỉ lưu
//   hash để khóa/thu hồi từng máy.
// - `adminToken` CHỈ điền trên máy quản trị viên (giống ADMIN_API_CONFIG.token)
//   để tạo campaign / nhập kịch bản / xem vận hành. User thường để "".
// - Bỏ trống `url` → worker chạy chế độ máy đơn (legacy) như bản cũ.
const ENGAGEMENT_API_CONFIG = {
  url: "https://xxxxx.supabase.co/functions/v1/engagement-api",
  adminToken: "",
};

// Xuất config để sử dụng trong các file khác
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SUPABASE_CONFIG, NVIDIA_CONFIG };
}
