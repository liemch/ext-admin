// Cấu hình Supabase
// ⚠️ QUAN TRỌNG: Thay thế các giá trị này bằng thông tin Supabase của bạn

const SUPABASE_CONFIG = {
  // URL của Supabase project
  url: "https://emzziaiwnnlhzzrvmrvl.supabase.co", // Ví dụ: 'https://xxxxx.supabase.co'

  // Anon/Public key của Supabase
  anonKey: "sb_publishable_DhWyR6hAV8tQMcDnC1bMGw_U3jNeDkJ", // Ví dụ: 'eyJhbGciOiJIUzI1...'

  // Tên bảng users
  tableName: "users",
};

// Xuất config để sử dụng trong các file khác
if (typeof module !== "undefined" && module.exports) {
  module.exports = SUPABASE_CONFIG;
}
