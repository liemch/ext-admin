// Supabase Edge Function: admin-api
// Quản lý user (danh sách / cấp-thu quyền / khóa / xóa) qua SERVICE ROLE —
// bypass RLS nên vẫn hoạt động sau khi migration 011 chặn anon ghi vào users.
//
// Bảo vệ: secret ADMIN_TOKEN — CHỈ nằm trong config.js của máy quản trị viên,
// không nằm trong config gửi cho user thường.
//
// Deploy: xem scripts/setup-supabase.sh

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

// Đầu ngày theo giờ Việt Nam (UTC+7) — khớp cách đếm "cmt hôm nay" của extension
function startOfTodayVnIso() {
  const offsetMs = 7 * 3600 * 1000;
  const shifted = new Date(Date.now() + offsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMs).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Bắt buộc khớp ADMIN_TOKEN — token này không được phát cho user thường
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  const authHeader = req.headers.get("Authorization") || "";
  if (!adminToken || authHeader !== `Bearer ${adminToken}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { error: "Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env mặc định của edge function)." },
      500
    );
  }

  const restHeaders: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const usersTable = `${supabaseUrl}/rest/v1/users`;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON không hợp lệ." }, 400);
  }

  const action = String(body.action || "");
  const username =
    typeof body.username === "string" ? body.username.trim() : "";

  try {
    // ===== Danh sách user + thống kê cho panel Người dùng =====
    if (action === "getUsersOverview") {
      const [usersRes, postsRes, interactionsRes] = await Promise.all([
        fetch(`${usersTable}?order=created_at.desc&select=*&limit=1000`, {
          headers: restHeaders,
        }),
        fetch(`${supabaseUrl}/rest/v1/posts?select=username&limit=10000`, {
          headers: restHeaders,
        }),
        fetch(
          `${supabaseUrl}/rest/v1/interactions?created_at=gte.${startOfTodayVnIso()}&interaction_type=eq.comment&select=username&limit=10000`,
          { headers: restHeaders }
        ),
      ]);

      if (!usersRes.ok) {
        throw new Error(`Không đọc được bảng users: HTTP ${usersRes.status}`);
      }
      const users = await usersRes.json();

      const postCounts: Record<string, number> = {};
      if (postsRes.ok) {
        for (const row of await postsRes.json()) {
          if (row?.username) {
            postCounts[row.username] = (postCounts[row.username] || 0) + 1;
          }
        }
      }

      const todayInteractionCounts: Record<string, number> = {};
      if (interactionsRes.ok) {
        for (const row of await interactionsRes.json()) {
          if (row?.username) {
            todayInteractionCounts[row.username] =
              (todayInteractionCounts[row.username] || 0) + 1;
          }
        }
      }

      return json({ users, postCounts, todayInteractionCounts });
    }

    // ===== Cấp / thu quyền admin, khóa / mở khóa =====
    if (action === "updateUserStatus") {
      if (!username || username.length > 100) {
        return json({ error: "username không hợp lệ." }, 400);
      }
      const payload: Record<string, unknown> = {
        last_update: new Date().toISOString(),
      };
      if (typeof body.isAdmin === "boolean") payload.is_admin = body.isAdmin;
      if (typeof body.isLocked === "boolean") payload.is_locked = body.isLocked;

      const res = await fetch(
        `${usersTable}?username=eq.${encodeURIComponent(username)}&select=*`,
        {
          method: "PATCH",
          headers: restHeaders,
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cập nhật thất bại: HTTP ${res.status} ${errText.slice(0, 200)}`);
      }
      const rows = await res.json();
      return json({ user: rows?.[0] || null });
    }

    // ===== Xóa user =====
    if (action === "deleteUser") {
      if (!username || username.length > 100) {
        return json({ error: "username không hợp lệ." }, 400);
      }
      const res = await fetch(
        `${usersTable}?username=eq.${encodeURIComponent(username)}`,
        { method: "DELETE", headers: restHeaders }
      );
      if (!res.ok) {
        throw new Error(`Xóa thất bại: HTTP ${res.status}`);
      }
      return json({ ok: true });
    }

    return json({ error: `Action không hỗ trợ: ${action}` }, 400);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
