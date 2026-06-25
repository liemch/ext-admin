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

// Xuất config để sử dụng trong các file khác
if (typeof module !== "undefined" && module.exports) {
  module.exports = SUPABASE_CONFIG;
}
