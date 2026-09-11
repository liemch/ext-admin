# nvidia-proxy — che NVIDIA API key

Extension gọi AI qua Edge Function này thay vì gọi thẳng NVIDIA.
API key NVIDIA nằm trong **Supabase secret**, không nằm trong bất kỳ file nào
của extension — người cài extension không đọc được key.

```
Extension ──(proxyUrl + proxyToken)──> nvidia-proxy ──(NVIDIA_API_KEY)──> NVIDIA NIM
```

## Deploy

Yêu cầu: [Supabase CLI](https://supabase.com/docs/guides/cli) đã `login` và link đúng project.

```bash
# 1. Deploy function (không verify JWT vì extension gửi token riêng)
supabase functions deploy nvidia-proxy --no-verify-jwt

# 2. Đặt key NVIDIA (lấy tại https://build.nvidia.com/settings/api-keys)
supabase secrets set NVIDIA_API_KEY=nvapi-xxxxxxxx

# 3. Đặt token bảo vệ — extension phải gửi đúng token này
#    (tự chọn chuỗi ngẫu nhiên dài, ví dụ dùng: openssl rand -hex 24)
supabase secrets set PROXY_TOKEN=<token-cua-ban>
```

## Cấu hình extension

Sửa `config.js` (không commit):

```js
const NVIDIA_CONFIG = {
  mode: "proxy",
  proxyUrl: "https://<project-ref>.supabase.co/functions/v1/nvidia-proxy",
  proxyToken: "<giống PROXY_TOKEN đã set>",
  apiKey: "", // để trống khi dùng proxy
  // model / maxTokens / temperature / topP / enableThinking giữ nguyên
};
```

## Kiểm tra

```bash
curl -s https://<project-ref>.supabase.co/functions/v1/nvidia-proxy \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/nemotron-3.5-lightning-30b-a3b","messages":[{"role":"user","content":"chào"}]}'
```

Trả về JSON dạng OpenAI (`choices[0].message.content`) là chạy đúng.

## Quản lý

| Việc | Lệnh |
|---|---|
| Xem logs | `supabase functions logs nvidia-proxy` |
| Đổi token (thu hồi token cũ) | `supabase secrets set PROXY_TOKEN=<mới>` rồi sửa `config.js` |
| Đổi key NVIDIA | `supabase secrets set NVIDIA_API_KEY=<mới>` — không cần đụng extension |
| Giới hạn max_tokens cao nhất | `supabase secrets set MAX_TOKENS_LIMIT=512` |

## Lưu ý bảo mật

- `PROXY_TOKEN` nằm trong `config.js` của extension nên vẫn đọc được từ máy người dùng —
  nhưng nó **chỉ dùng được với function này**, giới hạn 60 request/phút, giới hạn payload,
  và **thu hồi được trong 1 lệnh** khi nghi ngờ lạm dụng. Khác hẳn lộ thẳng NVIDIA key.
- Nếu không set `PROXY_TOKEN`, function vẫn chạy (ai biết URL cũng gọi được) — luôn nên set.
- Function ép `stream: false` và cắt `max_tokens` theo `MAX_TOKENS_LIMIT` để chống tiêu tốn token.
