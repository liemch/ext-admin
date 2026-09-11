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

// Xuất config để sử dụng trong các file khác
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SUPABASE_CONFIG, NVIDIA_CONFIG };
}
