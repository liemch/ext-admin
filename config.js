// Cấu hình Supabase
// ⚠️ QUAN TRỌNG: Thay thế các giá trị này bằng thông tin Supabase của bạn

const SUPABASE_CONFIG = {
  // URL của Supabase project
  url: "https://vpriomitldkkwtpcwdkw.supabase.co",

  // Anon/Public key của Supabase
  anonKey: "sb_publishable_hwJ57Al1vrw4PNx2QIMYBA_eaYjhGva",

  // Tên bảng users
  tableName: "users",
};

// NVIDIA NIM (phase 2 auto-reply / discussion AI)
// Lấy key tại: https://build.nvidia.com/settings/api-keys
const NVIDIA_CONFIG = {
  apiKey: "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",
  baseUrl: "https://integrate.api.nvidia.com/v1",
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
