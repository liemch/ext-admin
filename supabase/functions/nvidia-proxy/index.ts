// Supabase Edge Function: nvidia-proxy
// Proxy NVIDIA NIM chat completions — API key NVIDIA nằm trong Supabase secret,
// KHÔNG nằm trong extension. Extension chỉ giữ proxyUrl + proxyToken (thu hồi được).
//
// Deploy (xem README.md cùng thư mục):
//   supabase functions deploy nvidia-proxy --no-verify-jwt
//   supabase secrets set NVIDIA_API_KEY=nvapi-xxx
//   supabase secrets set PROXY_TOKEN=<token-đặt-tự-chọn>

const NVIDIA_BASE_URL =
  Deno.env.get("NVIDIA_BASE_URL") ?? "https://integrate.api.nvidia.com/v1";
const MAX_TOKENS_LIMIT = Number(Deno.env.get("MAX_TOKENS_LIMIT") ?? 1024);
const MAX_MESSAGES = 60;

// Giới hạn tần suất đơn giản (theo isolate — đủ chặn lạm dụng nhẹ, không phải chống DDoS)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateHits: { at: number; token: string }[] = [];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tooManyRequests() {
  return json({ error: "Quá nhiều request, thử lại sau một phút." }, 429);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Bảo vệ: nếu đã set secret PROXY_TOKEN thì Authorization phải khớp.
  const proxyToken = Deno.env.get("PROXY_TOKEN");
  const authHeader = req.headers.get("Authorization") || "";
  if (proxyToken && authHeader !== `Bearer ${proxyToken}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("NVIDIA_API_KEY");
  if (!apiKey) {
    return json(
      { error: "Secret NVIDIA_API_KEY chưa được cấu hình (supabase secrets set NVIDIA_API_KEY=...)" },
      500
    );
  }

  // Rate limit thô theo token caller (chung khi chưa set PROXY_TOKEN)
  const callerKey = proxyToken ? "token" : authHeader || "anonymous";
  const now = Date.now();
  while (rateHits.length && now - rateHits[0].at > RATE_LIMIT_WINDOW_MS) {
    rateHits.shift();
  }
  if (rateHits.filter((h) => h.token === callerKey).length >= RATE_LIMIT_MAX) {
    return tooManyRequests();
  }
  rateHits.push({ at: now, token: callerKey });

  // Đọc và chặn trường an toàn
  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Body JSON không hợp lệ." }, 400);
  }

  const payload: Record<string, unknown> = {
    model: typeof raw.model === "string" ? raw.model : "",
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-MAX_MESSAGES) : [],
    temperature: typeof raw.temperature === "number" ? raw.temperature : 1,
    top_p: typeof raw.top_p === "number" ? raw.top_p : 0.95,
    max_tokens: Math.min(Number(raw.max_tokens) || 256, MAX_TOKENS_LIMIT),
    stream: false,
  };
  const kwargs = raw.chat_template_kwargs as Record<string, unknown> | undefined;
  if (kwargs && typeof kwargs === "object") {
    payload.chat_template_kwargs = {
      enable_thinking: !!kwargs.enable_thinking,
    };
  }
  if (typeof raw.presence_penalty === "number") {
    payload.presence_penalty = raw.presence_penalty;
  }
  if (typeof raw.frequency_penalty === "number") {
    payload.frequency_penalty = raw.frequency_penalty;
  }

  if (!payload.model || (payload.messages as unknown[]).length === 0) {
    return json({ error: "Thiếu model hoặc messages." }, 400);
  }

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return json(
      { error: "Lỗi gọi NVIDIA: " + (error instanceof Error ? error.message : String(error)) },
      502
    );
  }
});
