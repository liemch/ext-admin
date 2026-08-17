// Cấu hình Supabase
// ⚠️ QUAN TRỌNG: Copy file này thành config.js và thay thế các giá trị

const SUPABASE_CONFIG = {
  // URL của Supabase project
  url: "https://xxxxx.supabase.co",

  // Anon/Public key của Supabase
  anonKey: "your-supabase-anon-key",

  // Tên bảng users
  tableName: "users",
};

// NVIDIA NIM (phase 2 auto-reply / discussion AI)
// Lấy key tại: https://build.nvidia.com/settings/api-keys
const NVIDIA_CONFIG = {
  apiKey: "YOUR_NVIDIA_API_KEY",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  maxTokens: 256,
  temperature: 1,
  topP: 0.95,
  enableThinking: false,
};

// Xuất config để sử dụng trong các file khác
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SUPABASE_CONFIG, NVIDIA_CONFIG };
}
