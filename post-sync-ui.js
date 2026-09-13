// post-sync-ui.js — UI cho panel admin "Đồng bộ bài viết" và cache "Bài viết của tôi".
//
// File này gắn hàm render vào global (window.PopUp / PostSyncUI) để popup.js gọi.

(function (global) {
  "use strict";

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  function statusBadge(status) {
    const cls = {
      verified: "ok",
      rejected: "bad",
      stale: "warn",
      unverified: "muted",
      succeeded: "ok",
      partial: "warn",
      failed: "bad",
      session_required: "bad",
      pending: "muted",
      claimed: "info",
      running: "info",
      retry_wait: "warn",
      cancelled: "muted",
      hint: "info",
      feed: "muted",
      user_reconcile: "muted",
      legacy: "muted",
    }[status] || "muted";
    const label = {
      verified: "Đã xác minh",
      rejected: "Không hợp lệ",
      stale: "Cần kiểm tra lại",
      unverified: "Chưa xác minh",
      succeeded: "Thành công",
      partial: "Một phần",
      failed: "Thất bại",
      session_required: "Cần đăng nhập",
      pending: "Đang chờ",
      claimed: "Đã nhận",
      running: "Đang chạy",
      retry_wait: "Chờ thử lại",
      cancelled: "Đã hủy",
      post_hint: "User mở bài",
      feed_discovery: "Quét chuyên mục",
      user_reconcile: "Theo tác giả",
      hint: "User mở bài",
      feed: "Quét chuyên mục",
      legacy: "Dữ liệu cũ",
    }[status] || status || "?";
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  async function refreshPostSyncOverview() {
    if (!PostSyncClient.isPostSyncLeader()) {
      el("postSyncOverview").innerHTML =
        `<p class="muted">Chức năng dành cho máy admin — cấu hình <code>POST_SYNC_API_CONFIG.adminToken</code> để làm leader.</p>`;
      return;
    }
    try {
      const s = await PostSyncClient.getPostSyncStatus();
      const leader = (s.activeLeaders || [])[0];
      const stored = await chrome.storage.local.get("engagementDevice");
      const currentDeviceId = stored.engagementDevice?.deviceId || null;
      const isThisMachine = !!leader && leader.claimed_by_device === currentDeviceId;
      const queue = s.queue || {};
      const waitingCount = Object.entries(queue).reduce((sum, [status, value]) => {
        return ["pending", "retry_wait", "claimed", "running"].includes(status)
          ? sum + (Number(value) || 0)
          : sum;
      }, 0);
      const machineText = leader
        ? isThisMachine
          ? "Máy này đang hoạt động"
          : "Máy admin khác đang xử lý"
        : "Chưa có máy xử lý";
      const guidance = s.sessionRequiredCount > 0
        ? `<div class="post-sync-guidance bad">Có ${s.sessionRequiredCount} yêu cầu thiếu phiên đăng nhập. Mở TechHub, đăng nhập lại rồi bấm <strong>Đồng bộ ngay</strong>.</div>`
        : waitingCount > 0
          ? `<div class="post-sync-guidance warn">Có ${waitingCount} yêu cầu đang chờ. Bấm <strong>Đồng bộ ngay</strong> để xử lý ngay.</div>`
          : `<div class="post-sync-guidance ok">Không có yêu cầu tồn đọng. Hệ thống vẫn tự kiểm tra định kỳ.</div>`;
      el("postSyncOverview").innerHTML = `
        ${guidance}
        <div class="grid-2">
          <div class="card mini"><div class="label">Máy phụ trách</div><div class="value">${escapeHtml(machineText)}</div><div class="sub muted">Tự động kiểm tra mỗi 5 phút</div></div>
          <div class="card mini"><div class="label">Đang chờ xử lý</div><div class="value">${waitingCount} yêu cầu</div><div class="sub muted">${waitingCount ? "Có thể bấm Đồng bộ ngay" : "Hàng đợi đã trống"}</div></div>
          <div class="card mini"><div class="label">Kết quả 24 giờ</div><div class="value">${s.newPosts24h || 0} bài mới</div><div class="sub muted">${s.updated24h || 0} bài được cập nhật</div></div>
          <div class="card mini"><div class="label">Đăng nhập TechHub</div><div class="value">${s.sessionRequiredCount > 0 ? "Cần kiểm tra lại" : "Sẵn sàng"}</div><div class="sub muted">${s.sessionRequiredCount || 0} yêu cầu đang thiếu phiên</div></div>
        </div>
        <details class="post-sync-inline-detail">
          <summary>Xem trạng thái kỹ thuật</summary>
          <div>Leader: ${leader ? escapeHtml(leader.claimed_by_device || "—") : "—"} · hết quyền lúc ${leader ? formatTime(leader.lease_until) : "—"}</div>
          <div>Queue: ${Object.entries(queue).map(([key, value]) => `${escapeHtml(key)}: ${Number(value) || 0}`).join(" · ") || "trống"} · request 24h: ${s.requestCount24h || 0}</div>
        </details>
      `;
    } catch (error) {
      el("postSyncOverview").innerHTML = `<p class="bad">Không tải được trạng thái: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function refreshNewPosts() {
    const days = Number(el("postSyncNewDays")?.value || 7);
    const filter = el("postSyncNewFilter")?.value || "";
    try {
      const data = await PostSyncClient.listNewPosts(days, 50, null, filter || null);
      const posts = data.posts || [];
      el("postSyncNewList").innerHTML = posts.length === 0
        ? `<p class="muted">Không có bài mới trong ${days} ngày qua.</p>`
        : `<table class="data-table">
            <thead><tr><th>Bài</th><th>Tác giả</th><th>Nguồn</th><th>Trạng thái</th><th>Xác minh</th></tr></thead>
            <tbody>
              ${posts.map((p) => `
                <tr>
                  <td><a href="${escapeHtml(p.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(p.title || `#${p.techhub_id}`)}</a></td>
                  <td>@${escapeHtml(p.username || "—")}</td>
                  <td>${statusBadge(p.discovered_by)}</td>
                  <td>${statusBadge(p.verification_status)}</td>
                  <td class="muted">${formatTime(p.last_verified_at)}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
    } catch (error) {
      el("postSyncNewList").innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
    }
  }

  async function refreshRunHistory() {
    try {
      const data = await PostSyncClient.listPostSyncRuns(30);
      const runs = data.runs || [];
      el("postSyncRuns").innerHTML = runs.length === 0
        ? `<p class="muted">Chưa có run nào.</p>`
        : `<table class="data-table">
            <thead><tr><th>Bắt đầu</th><th>Loại</th><th>Kết quả</th><th>Req</th><th>Trang</th><th>Mới</th><th>Cập nhật</th><th>Lỗi</th></tr></thead>
            <tbody>
              ${runs.map((r) => `
                <tr>
                  <td class="muted">${formatTime(r.started_at)}</td>
                  <td>${escapeHtml(r.job_id ? `#${r.job_id}` : "—")}</td>
                  <td>${statusBadge(r.outcome)}</td>
                  <td>${r.request_count || 0}</td>
                  <td>${r.page_count || 0}</td>
                  <td class="ok">${r.new_count || 0}</td>
                  <td>${r.updated_count || 0}</td>
                  <td class="bad">${r.error_summary ? escapeHtml(String(r.error_summary).slice(0, 120)) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
    } catch (error) {
      el("postSyncRuns").innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
    }
  }

  async function refreshSources() {
    try {
      const s = await PostSyncClient.getPostSyncStatus();
      const sources = s.sources || [];
      el("postSyncSources").innerHTML = sources.length === 0
        ? `<p class="muted">Chưa có nguồn nào được cấu hình.</p>`
        : `<table class="data-table">
            <thead><tr><th>Loại</th><th>Key</th><th>Lần chạy cuối</th><th>Kế tiếp</th><th>Lỗi</th></tr></thead>
            <tbody>
              ${sources.map((src) => `
                <tr>
                  <td>${escapeHtml(src.type)}</td>
                  <td><code>${escapeHtml(src.source_key)}</code></td>
                  <td>${formatTime(src.last_success_at || src.last_checked_at)}</td>
                  <td>${formatTime(src.next_check_at)}</td>
                  <td class="bad">${src.last_error ? escapeHtml(String(src.last_error).slice(0, 120)) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
    } catch (error) {
      el("postSyncSources").innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
    }
  }

  async function syncPostsNow() {
    const slug = el("postSyncCommunitySlug")?.value.trim() || "cai-tien-moi-ngay";
    const button = el("postSyncFeedBtn");
    const originalText = button?.textContent || "Đồng bộ ngay";
    if (button) {
      button.disabled = true;
      button.textContent = "Đang đồng bộ…";
    }
    try {
      const session = await chrome.runtime.sendMessage({ action: "postSyncCheckSession" });
      if (!session?.success || !session.ok) {
        throw new Error(session?.error || "Phiên TechHub chưa sẵn sàng. Hãy mở TechHub và đăng nhập lại.");
      }
      await PostSyncClient.requestPostSync("feed", { communitySlug: slug });
      flash("Đã tạo yêu cầu, đang lấy bài mới…", "warn");
      let handledCount = 0;
      let feedCompleted = false;
      for (let i = 0; i < 5; i += 1) {
        const result = await runLeaderNow({ announce: false, refresh: false });
        if (!result || result.error) {
          throw new Error(result?.error || "Không thể chạy đồng bộ.");
        }
        if (result.handled === 0) break;
        handledCount += 1;
        if (result.outcome === "success" && result.jobType === "feed_discovery") {
          feedCompleted = true;
          break;
        }
      }
      flash(
        feedCompleted
          ? "Đồng bộ bài mới hoàn tất."
          : handledCount > 0
            ? `Đã xử lý ${handledCount} yêu cầu; phần còn lại sẽ tiếp tục tự chạy.`
            : "Yêu cầu đã được xếp hàng và sẽ do máy leader xử lý.",
        feedCompleted ? "ok" : "warn"
      );
      await refreshAllPostSync();
    } catch (error) {
      flash(`Không đồng bộ được: ${error.message}`, "bad");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function requestUserScan() {
    const username = el("postSyncUsernameInput")?.value.trim();
    if (!username) return flash("Nhập username cần quét.", "warn");
    try {
      const res = await PostSyncClient.requestPostSync("user", { username });
      if (res.queued === false) {
        flash(`Cooldown ${res.cooldownMinutes} phút, thử lại sau.`, "warn");
      } else {
        flash(`Đã xếp hàng quét @${username}.`);
        await runLeaderNow();
      }
    } catch (error) {
      flash(`Lỗi: ${error.message}`, "bad");
    }
  }

  async function runLeaderNow(options = {}) {
    const { announce = true, refresh = true } = options;
    const button = el("postSyncRunNowBtn");
    if (button) button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: "postSyncRunLeaderTick" });
      if (!response?.success) throw new Error(response?.error || "Leader không chạy được.");
      const result = response.result || {};
      const message = result.outcome === "success"
        ? `Leader đã xử lý ${result.jobType || "job"}${result.username ? ` @${result.username}` : ""}.`
        : result.handled === 0
          ? "Đã nhận leader; hiện không có job tới hạn."
          : result.error
            ? `Leader lỗi: ${result.error}`
            : "Leader đã chạy một lượt.";
      if (announce) flash(message, result.error ? "bad" : "ok");
      if (refresh) await refreshAllPostSync();
      return result;
    } catch (error) {
      if (announce) flash(`Lỗi xử lý yêu cầu: ${error.message}`, "bad");
      return { error: error.message, handled: 0 };
    } finally {
      if (button) button.disabled = false;
    }
  }

  function flash(msg, kind = "ok") {
    const t = el("postSyncFlash");
    if (!t) return;
    t.textContent = msg;
    t.className = `flash ${kind}`;
    setTimeout(() => {
      if (t.textContent === msg) t.textContent = "";
    }, 4000);
  }

  async function refreshAllPostSync() {
    if (!PostSyncClient.isPostSyncLeader()) {
      await refreshPostSyncOverview();
      return;
    }
    await Promise.all([
      refreshPostSyncOverview(),
      refreshNewPosts(),
      refreshRunHistory(),
      refreshSources(),
    ]);
  }

  // ---- "Bài viết của tôi" (user thường) — chỉ đọc cache ----

  async function renderMyPostsCache(username) {
    const container = el("myPostsCacheList");
    if (!container) return;
    if (!username) {
      container.innerHTML = `<p class="muted">Đăng nhập TechHub để xem bài đã cache.</p>`;
      return;
    }
    try {
      const data = await PostSyncClient.getMySyncedPosts({ username, limit: 20, days: 30 });
      const posts = data.posts || [];
      if (!posts || posts.length === 0) {
        container.innerHTML = `<p class="muted">Chưa có bài nào trong cache. Mở bài để gửi hint hoặc chờ leader quét.</p>`;
        return;
      }
      container.innerHTML = posts.map((p) => `
        <div class="my-post-item">
          <div class="my-post-title"><a href="${escapeHtml(p.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(p.title || `#${p.techhub_id}`)}</a></div>
          <div class="my-post-meta">
            ${statusBadge(p.verification_status)}
            <span class="muted">· ${statusBadge(p.discovered_by)}</span>
            <span class="muted">· xác minh ${formatTime(p.last_verified_at)}</span>
            <span class="muted">· 💬 ${p.comments_count || 0} · 👍 ${p.votes_score || 0}</span>
          </div>
        </div>
      `).join("");
    } catch (error) {
      container.innerHTML = `<p class="bad">Không đọc được cache: ${escapeHtml(error.message)}</p>`;
    }
  }

  function bindPostSyncUI() {
    el("postSyncRefreshBtn")?.addEventListener("click", refreshAllPostSync);
    el("postSyncRunNowBtn")?.addEventListener("click", runLeaderNow);
    el("postSyncFeedBtn")?.addEventListener("click", syncPostsNow);
    el("postSyncUserBtn")?.addEventListener("click", requestUserScan);
    el("postSyncNewDays")?.addEventListener("change", refreshNewPosts);
    el("postSyncNewFilter")?.addEventListener("change", refreshNewPosts);
    el("postSyncCheckSessionBtn")?.addEventListener("click", async () => {
      const r = await chrome.runtime.sendMessage({ action: "postSyncCheckSession" });
      flash(
        r?.success && r.ok
          ? "Đăng nhập TechHub đang hoạt động."
          : `Phiên TechHub chưa sẵn sàng${r?.error ? `: ${r.error}` : "."}`,
        r?.success && r.ok ? "ok" : "bad"
      );
    });
  }

  global.PostSyncUI = {
    refreshAllPostSync,
    refreshPostSyncOverview,
    refreshNewPosts,
    refreshRunHistory,
    refreshSources,
    runLeaderNow,
    renderMyPostsCache,
    bindPostSyncUI,
    statusBadge,
    formatTime,
    escapeHtml,
    flash,
  };
})(typeof window !== "undefined" ? window : globalThis);
