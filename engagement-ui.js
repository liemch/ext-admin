// engagement-ui.js — UI mục Tương tác chéo (lớp user + admin) + banner phiên.
//
// Chạy sau popup.js nên dùng chung sendMessage / showAdminMsg / showPanel.
// Lớp user hiện cho mọi tài khoản hợp lệ; các card .admin-only do CSS ẩn
// với user thường (body.not-admin), JS cũng không gọi API admin khi đó.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return "—";
    return new Date(iso).toLocaleString("vi-VN");
  }

  function fmtAgo(iso) {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "vừa xong";
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    return `${Math.floor(hours / 24)} ngày trước`;
  }

  function isAdminView() {
    return !document.body.classList.contains("not-admin");
  }

  function statusBadge(status) {
    const map = {
      pending: "st-pending",
      claimed: "st-running",
      queued: "st-running",
      succeeded: "st-success",
      used: "st-success",
      completed: "st-success",
      failed: "st-failed",
      blocked: "st-failed",
      skipped: "st-muted",
      cancelled: "st-muted",
      active: "st-running",
      paused: "st-pending",
      draft: "st-muted",
    };
    const cls = map[String(status)] || "st-muted";
    return `<span class="st-badge ${cls}">${esc(status)}</span>`;
  }

  function actionBadge(action) {
    return `<span class="st-badge st-action">${esc(action)}</span>`;
  }

  // Chờ popup.js init xong (phân quyền body class) rồi mới tải dữ liệu.
  function waitForInit(timeoutMs = 12000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const adminSection = $("adminSection");
        const ready =
          (adminSection && !adminSection.classList.contains("hidden")) ||
          ($("errorSection") && !$("errorSection").classList.contains("hidden")) ||
          ($("deniedSection") && !$("deniedSection").classList.contains("hidden")) ||
          Date.now() - start > timeoutMs;
        if (ready) resolve();
        else setTimeout(tick, 200);
      };
      tick();
    });
  }

  // ---------------------------------------------------------- banner phiên

  function setSessionBanner(visible) {
    const banner = $("sessionBanner");
    if (banner) banner.classList.toggle("hidden", !visible);
    const dot = $("engagementDot");
    if (dot) dot.classList.toggle("hidden", !visible);
  }

  async function checkSession(showMessage) {
    try {
      const response = await sendMessage({ action: "checkTechHubSession" });
      if (!response?.success) throw new Error(response?.error || "Không kiểm tra được phiên.");
      const needsLogin = response.sessionRequired === true || response.ok === false;
      setSessionBanner(needsLogin);
      if (showMessage) {
        showAdminMsg(
          $("engagementUserMessage"),
          response.ok
            ? "Phiên TechHub còn hiệu lực."
            : `Phiên TechHub cần đăng nhập lại (HTTP ${response.httpStatus ?? "?"}).`,
          response.ok ? "success" : "error"
        );
      }
      return response;
    } catch (error) {
      if (showMessage) {
        showAdminMsg($("engagementUserMessage"), `Lỗi kiểm tra phiên: ${error.message}`, "error");
      }
      return null;
    }
  }

  // ---------------------------------------------------------- lớp user

  async function loadEngagementState() {
    const msgEl = $("engagementUserMessage");
    try {
      const response = await sendMessage({ action: "getEngagementState" });
      if (!response?.success) throw new Error(response?.error || "Không tải được trạng thái.");

      const { settings, status, queueConfigured } = response;
      if ($("engagementEnabled")) {
        $("engagementEnabled").checked = !!settings.enabled;
        $("engagementEnabled").disabled = true;
      }
      if ($("engIntervalMinutes")) $("engIntervalMinutes").value = settings.intervalMinutes;
      if ($("engTasksPerWake")) $("engTasksPerWake").value = settings.tasksPerWake;
      if ($("engDelaySec")) $("engDelaySec").value = settings.delayBetweenTasksSec;
      if ($("engDailyCap")) $("engDailyCap").value = settings.dailyCapPosts;

      const onlineLabel = status.sessionRequired
        ? "Chờ đăng nhập"
        : settings.enabled
          ? "Đang nhận task"
          : "Đang tắt";
      if ($("engagementOnlineState")) $("engagementOnlineState").textContent = onlineLabel;
      if ($("engagementQueueMode")) {
        $("engagementQueueMode").textContent = queueConfigured
          ? "hàng đợi trung tâm"
          : "chế độ máy đơn (legacy)";
      }
      if ($("engagementPendingCount")) {
        $("engagementPendingCount").textContent =
          status.pendingCount ?? (queueConfigured ? "…" : "—");
      }
      if ($("engagementLastRun")) {
        $("engagementLastRun").textContent = status.lastRunAt
          ? fmtAgo(status.lastRunAt)
          : "chưa chạy lần nào";
      }
      if ($("engagementLastTask")) {
        const last = status.lastMessage || "Chưa có nhiệm vụ nào.";
        $("engagementLastTask").textContent =
          `${last}${status.lastRunAt ? ` · ${fmtTime(status.lastRunAt)}` : ""}`;
        $("engagementLastTask").className =
          `msg ${status.sessionRequired ? "err" : status.lastOutcome === "success" ? "ok" : "muted"}`;
      }
      setSessionBanner(status.sessionRequired === true);
      if (status.sessionRequired) {
        showAdminMsg(
          msgEl,
          "Phiên TechHub đã hết hạn. Đăng nhập lại để tiếp tục.",
          "error"
        );
      }

      // Số liệu hôm nay + hoạt động (queue mode).
      if (queueConfigured) {
        try {
          const queue = await sendMessage({ action: "getEngagementQueueStatus" });
          if (queue?.success) {
            const globallyEnabled = queue.engagementEnabled !== false;
            if ($("engagementEnabled")) {
              $("engagementEnabled").checked = globallyEnabled;
              $("engagementEnabled").disabled = true;
            }
            if ($("engagementOnlineState")) {
              $("engagementOnlineState").textContent = queue.killSwitch
                ? "Admin đang tạm dừng"
                : globallyEnabled ? "Admin đã bật — đang nhận task" : "Admin đã tắt";
            }
            if ($("engagementVotesToday")) {
              $("engagementVotesToday").textContent = queue.today?.vote ?? 0;
            }
            if ($("engagementCommentsToday")) {
              $("engagementCommentsToday").textContent =
                (queue.today?.comment ?? 0) + (queue.today?.reply ?? 0);
            }
            if ($("engagementPendingCount")) {
              $("engagementPendingCount").textContent = queue.pendingCount ?? 0;
            }
            renderActivity(queue);
          }
        } catch (error) {
          console.warn("[EngagementUI] queue status failed:", error);
        }
      } else if ($("engagementActivityList")) {
        $("engagementActivityList").innerHTML =
          '<div class="empty">Máy này đang chạy chế độ máy đơn. Cấu hình engagement-api để dùng hàng đợi trung tâm.</div>';
      }
      return { settings, status, queueConfigured };
    } catch (error) {
      showAdminMsg(msgEl, `Lỗi: ${error.message}`, "error");
      return null;
    }
  }

  function renderActivity(queue) {
    const list = $("engagementActivityList");
    if (!list) return;
    const tasks = Array.isArray(queue.recentTasks) ? queue.recentTasks : [];
    if (!tasks.length) {
      list.innerHTML = '<div class="empty">Chưa có hoạt động nào.</div>';
      return;
    }
    list.innerHTML = tasks.slice(0, 12).map((task) => `
      <div class="schedule-item">
        <div class="schedule-main">
          <strong>#${esc(task.techhub_id)} ${actionBadge(task.action)}</strong>
          ${statusBadge(task.status)}
          ${task.target_username ? `<span class="schedule-meta">@${esc(task.target_username)}</span>` : ""}
          ${task.last_error ? `<span class="schedule-meta err-text">${esc(String(task.last_error).slice(0, 160))}</span>` : ""}
        </div>
        <span class="schedule-meta">${esc(fmtAgo(task.updated_at || task.created_at))}</span>
      </div>
    `).join("");
  }

  async function toggleEnabled() {
    const checkbox = $("engagementEnabled");
    if (!checkbox) return;
    const enabled = checkbox.checked;
    checkbox.disabled = true;
    try {
      const response = await sendMessage({ action: "setEngagementEnabled", enabled });
      if (!response?.success) throw new Error(response?.error || "Không cập nhật được.");
      showAdminMsg(
        $("engagementUserMessage"),
        enabled ? "Đã bật nhận nhiệm vụ tương tác." : "Đã tắt nhận nhiệm vụ tương tác.",
        enabled ? "success" : "muted"
      );
      await loadEngagementState();
    } catch (error) {
      checkbox.checked = !enabled;
      showAdminMsg($("engagementUserMessage"), `Lỗi: ${error.message}`, "error");
    } finally {
      checkbox.disabled = false;
    }
  }

  async function runOnce() {
    const button = $("runEngagementOnceBtn");
    if (button) button.disabled = true;
    showAdminMsg($("engagementUserMessage"), "Đang chạy 1 lượt tương tác…", "muted");
    try {
      // Chạy tay từ panel: kiểm tra phiên trước để mở lại task chờ nếu cần.
      await checkSession(false);
      const response = await sendMessage({ action: "runEngagementOnce" });
      if (!response?.success) throw new Error(response?.error || "Chạy thất bại.");
      const result = response.result || {};
      const detail = result.ran === false
        ? `Bỏ qua (${result.reason || "unknown"}).`
        : `Xong ${result.succeeded ?? 0} task, lỗi ${result.failed ?? 0} task.`;
      showAdminMsg($("engagementUserMessage"), detail, result.failed ? "error" : "success");
      await loadEngagementState();
    } catch (error) {
      showAdminMsg($("engagementUserMessage"), `Lỗi: ${error.message}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ---------------------------------------------------------- admin: settings

  async function saveMachineSettings() {
    const payload = {
      intervalMinutes: Number($("engIntervalMinutes")?.value),
      tasksPerWake: Number($("engTasksPerWake")?.value),
      delayBetweenTasksSec: Number($("engDelaySec")?.value),
      dailyCapPosts: Number($("engDailyCap")?.value),
    };
    try {
      const response = await sendMessage({ action: "saveEngagementSettings", settings: payload });
      if (!response?.success) throw new Error(response?.error || "Không lưu được.");
      showAdminMsg($("engSettingsMessage"), "Đã lưu cài đặt máy này.", "success");
    } catch (error) {
      showAdminMsg($("engSettingsMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- admin: campaign

  function splitNames(value) {
    return String(value || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  async function planCampaign() {
    const name = String($("campaignName")?.value || "").trim();
    const actions = [];
    if ($("campaignActionVote")?.checked) actions.push("vote");
    if ($("campaignActionComment")?.checked) actions.push("comment");
    const payload = {
      name,
      actions,
      votesPerPost: Number($("campaignVotesPerPost")?.value),
      commentsPerPost: Number($("campaignCommentsPerPost")?.value),
      maxTasksPerActorDaily: Number($("campaignDailyCap")?.value),
      maxPerPairDaily: Number($("campaignPairCap")?.value),
      cooldownMinutes: Number($("campaignCooldown")?.value),
      jitterMinutes: Number($("campaignJitter")?.value),
      postScope: {
        usernames: splitNames($("campaignUsernames")?.value),
        communitySlug: String($("campaignCommunity")?.value || "").trim() || undefined,
        maxAgeDays: Number($("campaignMaxAge")?.value),
        limit: Number($("campaignLimit")?.value),
      },
      actorUsernames: splitNames($("campaignActors")?.value),
    };
    try {
      const response = await sendMessage({ action: "engagementPlanCampaign", payload });
      if (!response?.success) throw new Error(response?.error || "Tạo campaign thất bại.");
      showAdminMsg(
        $("campaignMessage"),
        `Đã tạo campaign #${response.campaignId}: ${response.tasksCreated} task cho ${response.posts} bài / ${response.actors} actor.`,
        "success"
      );
      await refreshCampaigns();
    } catch (error) {
      showAdminMsg($("campaignMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  async function refreshCampaigns() {
    const list = $("campaignsList");
    if (list) list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const response = await sendMessage({ action: "engagementGetCampaigns" });
      if (!response?.success) throw new Error(response?.error || "Không tải được campaign.");
      const campaigns = Array.isArray(response.campaigns) ? response.campaigns : [];
      if (!list) return;
      if (!campaigns.length) {
        list.innerHTML = '<div class="empty">Chưa có campaign nào.</div>';
        return;
      }
      list.innerHTML = campaigns.map((campaign) => {
        const counts = campaign.taskCounts || {};
        const parts = ["pending", "claimed", "succeeded", "failed", "skipped", "cancelled"]
          .filter((key) => counts[key])
          .map((key) => `${key}: ${counts[key]}`)
          .join(" · ");
        const canPause = campaign.status === "active";
        const canResume = campaign.status === "paused";
        const canCancel = !["completed", "cancelled"].includes(campaign.status);
        return `
          <div class="schedule-item">
            <div class="schedule-main">
              <strong>#${esc(campaign.id)} ${esc(campaign.name)}</strong>
              ${statusBadge(campaign.status)}
              <span class="schedule-meta">${esc((campaign.actions || []).join("+"))} · vote/bài ${esc(campaign.votes_per_post)} · cmt/bài ${esc(campaign.comments_per_post)}</span>
              <span class="schedule-meta">${esc(parts || "chưa có task")}</span>
            </div>
            <div class="schedule-actions">
              ${canPause ? `<button class="mini-btn" data-campaign-pause="${esc(campaign.id)}" type="button">Tạm dừng</button>` : ""}
              ${canResume ? `<button class="mini-btn" data-campaign-resume="${esc(campaign.id)}" type="button">Tiếp tục</button>` : ""}
              ${canCancel ? `<button class="mini-btn danger" data-campaign-cancel="${esc(campaign.id)}" type="button">Hủy</button>` : ""}
            </div>
          </div>
        `;
      }).join("");
    } catch (error) {
      if (list) list.innerHTML = `<div class="empty">Lỗi: ${esc(error.message)}</div>`;
    }
  }

  async function setCampaignStatus(campaignId, action) {
    const verb = action === "engagementPauseCampaign"
      ? "Tạm dừng"
      : action === "engagementResumeCampaign"
        ? "Tiếp tục"
        : "Hủy";
    if (action === "engagementCancelCampaign") {
      const ok = window.confirm(`Hủy campaign #${campaignId}? Toàn bộ task chưa xong sẽ bị hủy.`);
      if (!ok) return;
    }
    try {
      const response = await sendMessage({ action, campaignId });
      if (!response?.success) throw new Error(response?.error || "Không cập nhật được.");
      showAdminMsg($("campaignMessage"), `Đã ${verb.toLowerCase()} campaign #${campaignId}.`, "success");
      await refreshCampaigns();
    } catch (error) {
      showAdminMsg($("campaignMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- admin: threads

  function renderThreadPreview(threads, errors) {
    const list = $("threadPreviewList");
    if (!list) return;
    let html = "";
    if (errors?.length) {
      html += `<div class="msg err">Có ${errors.length} lỗi:\n${errors.map((item) => `· [${esc(item.name)}] ${esc(item.error)}`).join("\n")}</div>`;
    }
    if (!threads?.length) {
      html += '<div class="empty">Không có thread hợp lệ.</div>';
    } else {
      html += threads.map((thread, index) => `
        <div class="thread-card">
          <div class="thread-head">
            <strong>${esc(index + 1)}. ${esc(thread.name)}</strong>
            <span class="schedule-meta">${thread.turns.length} turn · A=${esc(thread.actors.A)} · B=${esc(thread.actors.B)}${thread.format === "legacy" ? " · format cũ" : ""}</span>
          </div>
          ${thread.turns.map((turn, turnIdx) => `
            <div class="turn-row">
              <span class="turn-actor turn-${esc(turn.actor)}">${esc(turn.actor)}</span>
              <span class="turn-content">${esc(turn.content)}</span>
              <span class="turn-index">turn ${turnIdx + 1}</span>
            </div>
          `).join("")}
        </div>
      `).join("");
    }
    list.innerHTML = html;
  }

  function readThreadsInput() {
    const raw = String($("threadJsonInput")?.value || "");
    if (typeof DiscussionImport === "undefined") {
      return { threads: [], errors: [{ index: -1, name: "", error: "Thiếu discussion-import.js." }], raw: [] };
    }
    const result = DiscussionImport.validateThreads(raw);
    let parsed = [];
    try {
      parsed = JSON.parse(raw.trim() || "[]");
    } catch (_) {
      parsed = [];
    }
    return { ...result, raw: parsed };
  }

  async function validateThreads() {
    const { threads, errors, raw } = readThreadsInput();
    renderThreadPreview(threads, errors);
    if (!errors.length && threads.length && Array.isArray(raw)) {
      // Kiểm tra sâu phía server (bài đích, user A/B) mà chưa nhập.
      try {
        const response = await sendMessage({
          action: "engagementImportThreads",
          threads: raw,
          defaults: {
            techhubId: Number($("threadDefaultPostId")?.value) || undefined,
            visitor: String($("threadDefaultVisitor")?.value || "").trim() || undefined,
          },
          dryRun: true,
        });
        if (!response?.success) throw new Error(response?.error || "Kiểm tra thất bại.");
        const serverErrors = response.errors || [];
        if (serverErrors.length) {
          renderThreadPreview(threads, serverErrors);
          showAdminMsg(
            $("threadImportMessage"),
            `Cú pháp đúng ${threads.length} thread, nhưng server báo ${serverErrors.length} lỗi (xem chi tiết phía trên).`,
            "error"
          );
        } else {
          showAdminMsg(
            $("threadImportMessage"),
            `Hợp lệ ${threads.length} thread, sẵn sàng nhập (server đã kiểm tra bài đích và user).`,
            "success"
          );
        }
      } catch (error) {
        showAdminMsg($("threadImportMessage"), `Lỗi kiểm tra server: ${error.message}`, "error");
      }
    } else if (!errors.length) {
      showAdminMsg($("threadImportMessage"), `Hợp lệ ${threads.length} thread (mới kiểm tra cú pháp).`, "success");
    } else {
      showAdminMsg($("threadImportMessage"), `Có ${errors.length} lỗi cú pháp, xem chi tiết phía trên.`, "error");
    }
  }

  async function importThreads() {
    const { threads, errors, raw } = readThreadsInput();
    if (errors.length || !threads.length) {
      renderThreadPreview(threads, errors);
      showAdminMsg($("threadImportMessage"), "JSON còn lỗi, chưa nhập.", "error");
      return;
    }
    try {
      const response = await sendMessage({
        action: "engagementImportThreads",
        threads: raw,
        defaults: {
          techhubId: Number($("threadDefaultPostId")?.value) || undefined,
          visitor: String($("threadDefaultVisitor")?.value || "").trim() || undefined,
        },
        dryRun: false,
      });
      if (!response?.success) throw new Error(response?.error || "Nhập thất bại.");
      const imported = response.imported || [];
      const serverErrors = response.errors || [];
      showAdminMsg(
        $("threadImportMessage"),
        `Đã nhập ${imported.length} chuỗi${serverErrors.length ? `, ${serverErrors.length} lỗi` : ""}.` +
        (serverErrors.length ? ` Lỗi đầu: ${serverErrors[0].error}` : ""),
        serverErrors.length ? "error" : "success"
      );
      if (serverErrors.length) renderThreadPreview([], serverErrors);
      await refreshThreads();
    } catch (error) {
      showAdminMsg($("threadImportMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  async function refreshThreads() {
    const list = $("threadsList");
    if (list) list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const response = await sendMessage({
        action: "engagementGetThreads",
        status: String($("threadStatusFilter")?.value || "") || undefined,
        limit: 30,
      });
      if (!response?.success) throw new Error(response?.error || "Không tải được chuỗi.");
      const threads = Array.isArray(response.threads) ? response.threads : [];
      if (!list) return;
      if (!threads.length) {
        list.innerHTML = '<div class="empty">Chưa có chuỗi nào.</div>';
        return;
      }
      list.innerHTML = threads.map((thread) => `
        <div class="thread-card">
          <div class="thread-head">
            <strong>#${esc(thread.id)} ${esc(thread.name)}</strong>
            ${statusBadge(thread.status)}
            <span class="schedule-meta">bài #${esc(thread.techhub_id)} · A=@${esc(thread.actor_a_username)} · B=@${esc(thread.actor_b_username)}</span>
            ${thread.last_error ? `<span class="schedule-meta err-text">${esc(String(thread.last_error).slice(0, 200))}</span>` : ""}
          </div>
          ${(thread.turns || []).map((turn) => `
            <div class="turn-row" data-turn-row="${esc(turn.id)}">
              <span class="turn-actor turn-${esc(turn.actor_key)}">${esc(turn.actor_key)}</span>
              <span class="turn-content">
                <span class="turn-meta">@${esc(turn.actor_username)} · turn ${esc(turn.turn_index)} ${statusBadge(turn.status)}${turn.techhub_comment_id ? ` · cmt #${esc(turn.techhub_comment_id)}` : ""}</span>
                <span class="turn-text">${esc(turn.content)}</span>
                ${turn.last_error ? `<span class="schedule-meta err-text">${esc(String(turn.last_error).slice(0, 200))}</span>` : ""}
              </span>
              <span class="turn-actions">
                ${["pending", "queued", "blocked", "failed"].includes(turn.status)
                  ? `<button class="mini-btn" data-turn-edit="${esc(turn.id)}" type="button">Sửa</button>`
                  : ""}
                ${["blocked", "failed", "pending"].includes(turn.status)
                  ? `<button class="mini-btn" data-turn-retry="${esc(turn.id)}" type="button">Chạy lại</button>`
                  : ""}
              </span>
            </div>
            <div class="turn-editor hidden" data-turn-editor="${esc(turn.id)}">
              <textarea rows="2" data-turn-input="${esc(turn.id)}" spellcheck="false">${esc(turn.content)}</textarea>
              <div class="turn-editor-actions">
                <button class="mini-btn" data-turn-save="${esc(turn.id)}" type="button">Lưu</button>
                <button class="mini-btn" data-turn-cancel="${esc(turn.id)}" type="button">Đóng</button>
              </div>
            </div>
          `).join("")}
        </div>
      `).join("");
    } catch (error) {
      if (list) list.innerHTML = `<div class="empty">Lỗi: ${esc(error.message)}</div>`;
    }
  }

  async function saveTurn(turnId) {
    const input = document.querySelector(`[data-turn-input="${turnId}"]`);
    const content = String(input?.value || "").trim();
    if (!content) {
      showAdminMsg($("threadImportMessage"), "Nội dung turn không được để trống.", "error");
      return;
    }
    try {
      const response = await sendMessage({ action: "engagementUpdateTurn", turnId: Number(turnId), content });
      if (!response?.success) throw new Error(response?.error || "Không lưu được.");
      showAdminMsg($("threadImportMessage"), `Đã lưu turn #${turnId}.`, "success");
      await refreshThreads();
    } catch (error) {
      showAdminMsg($("threadImportMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  async function retryTurn(turnId) {
    try {
      const response = await sendMessage({ action: "engagementRetryTurn", turnId: Number(turnId) });
      if (!response?.success) throw new Error(response?.error || "Không chạy lại được.");
      showAdminMsg($("threadImportMessage"), `Đã xếp lại turn #${turnId} (task #${response.taskId ?? "?"}).`, "success");
      await refreshThreads();
    } catch (error) {
      showAdminMsg($("threadImportMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- admin: tasks

  async function refreshTasks() {
    const list = $("tasksList");
    if (list) list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const response = await sendMessage({
        action: "engagementListTasks",
        status: String($("taskStatusFilter")?.value || "") || undefined,
        actor: String($("taskActorFilter")?.value || "").trim() || undefined,
        taskAction: String($("taskActionFilter")?.value || "") || undefined,
        limit: 50,
      });
      if (!response?.success) throw new Error(response?.error || "Không tải được task.");
      const tasks = Array.isArray(response.tasks) ? response.tasks : [];
      if (!list) return;
      if (!tasks.length) {
        list.innerHTML = '<div class="empty">Không có task nào.</div>';
        return;
      }
      list.innerHTML = tasks.map((task) => `
        <div class="schedule-item">
          <div class="schedule-main">
            <strong>#${esc(task.id)} @${esc(task.actor_username)} → #${esc(task.techhub_id)}</strong>
            ${actionBadge(task.action)} ${statusBadge(task.status)}
            <span class="schedule-meta">lượt ${esc(task.attempt_count)}/${esc(task.max_attempts)}${task.campaign_id ? ` · campaign #${esc(task.campaign_id)}` : ""}${task.discussion_turn_id ? ` · turn #${esc(task.discussion_turn_id)}` : ""}${task.last_http_status ? ` · HTTP ${esc(task.last_http_status)}` : ""}</span>
            ${task.last_error ? `<span class="schedule-meta err-text">${esc(String(task.last_error).slice(0, 220))}</span>` : ""}
            ${task.content ? `<span class="schedule-meta">“${esc(String(task.content).slice(0, 160))}”</span>` : ""}
          </div>
          <span class="schedule-meta">${esc(fmtAgo(task.updated_at))}</span>
        </div>
      `).join("");
    } catch (error) {
      if (list) list.innerHTML = `<div class="empty">Lỗi: ${esc(error.message)}</div>`;
    }
  }

  // ---------------------------------------------------------- admin: ops

  async function refreshOps() {
    const summary = $("opsSummary");
    if (summary) summary.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const response = await sendMessage({ action: "engagementGetOpsStats" });
      if (!response?.success) throw new Error(response?.error || "Không tải được số liệu.");
      if ($("killSwitchToggle")) $("killSwitchToggle").checked = response.killSwitch === true;
      if ($("engagementGlobalToggle")) {
        $("engagementGlobalToggle").checked = response.engagementEnabled !== false;
      }

      const byStatus = response.byStatus || {};
      const statusLine = Object.keys(byStatus).length
        ? Object.entries(byStatus).map(([key, value]) => `${key}: ${value}`).join(" · ")
        : "chưa có task 7 ngày qua";
      const byHttp = response.byHttpStatus || {};
      const httpLine = Object.keys(byHttp).length
        ? Object.entries(byHttp).map(([key, value]) => `HTTP ${key}: ${value}`).join(" · ")
        : "không có event 24h qua";
      const actors = Object.entries(response.byActor || {})
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 6)
        .map(([name, stat]) => `@${name}: ${stat.succeeded}/${stat.total}`)
        .join(" · ");
      if (summary) {
        summary.innerHTML = `
          <div class="stat-card">
            <span class="stat-label">Tỷ lệ thành công 7 ngày</span>
            <strong class="stat-value accent">${response.successRate7d ?? "—"}${response.successRate7d != null ? "%" : ""}</strong>
            <span class="stat-hint">${esc(response.tasks7d ?? 0)} task</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Theo trạng thái</span>
            <strong class="stat-value small-text">${esc(statusLine)}</strong>
            <span class="stat-hint">7 ngày qua</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Theo HTTP</span>
            <strong class="stat-value small-text">${esc(httpLine)}</strong>
            <span class="stat-hint">${esc(response.events24h ?? 0)} event 24h qua</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Kẹt / chờ phiên</span>
            <strong class="stat-value">${esc((response.stuckClaimed || []).length)} / ${esc((response.sessionRequired || []).length)}</strong>
            <span class="stat-hint">${esc(actors || "chưa có actor")}</span>
          </div>
        `;
      }
      const stuck = [...(response.stuckClaimed || []), ...(response.sessionRequired || [])];
      renderDevices(response.devices || [], stuck);
      if (stuck.length) {
        showAdminMsg(
          $("opsMessage"),
          `Có ${response.stuckClaimed?.length ?? 0} task kẹt lease và ${response.sessionRequired?.length ?? 0} task chờ đăng nhập.`,
          "error"
        );
      } else {
        showAdminMsg($("opsMessage"), "Hàng đợi khỏe: không có task kẹt hay chờ phiên.", "success");
      }
    } catch (error) {
      if (summary) summary.innerHTML = `<div class="empty">Lỗi: ${esc(error.message)}</div>`;
    }
  }

  function renderDevices(devices, stuck) {
    const list = $("devicesList");
    if (!list) return;
    let html = "";
    if (stuck?.length) {
      html += stuck.slice(0, 10).map((task) => `
        <div class="schedule-item">
          <div class="schedule-main">
            <strong>task #${esc(task.id)} @${esc(task.actor_username)} → #${esc(task.techhub_id)}</strong>
            ${actionBadge(task.action || "?")}
            <span class="schedule-meta err-text">${esc(task.lease_until ? `kẹt lease tới ${fmtTime(task.lease_until)}` : (task.last_error || "chờ đăng nhập"))}</span>
          </div>
        </div>
      `).join("");
    }
    if (!devices.length) {
      html += '<div class="empty">Chưa có thiết bị nào đăng ký.</div>';
    } else {
      html += devices.map((device) => `
        <div class="schedule-item">
          <div class="schedule-main">
            <strong>@${esc(device.username)}</strong>
            ${device.revoked ? statusBadge("blocked") : statusBadge("active")}
            <span class="schedule-meta">${esc(device.label || "thiết bị")} · ${esc(String(device.device_id).slice(0, 8))}… · thấy ${esc(fmtAgo(device.last_seen_at) || "chưa bao giờ")}</span>
          </div>
          <div class="schedule-actions">
            <button class="mini-btn ${device.revoked ? "" : "danger"}" data-device-toggle="${esc(device.device_id)}|${esc(device.username)}|${device.revoked ? "0" : "1"}" type="button">
              ${device.revoked ? "Mở lại" : "Thu hồi"}
            </button>
          </div>
        </div>
      `).join("");
    }
    list.innerHTML = html;
  }

  async function toggleKillSwitch() {
    const checkbox = $("killSwitchToggle");
    if (!checkbox) return;
    const enabled = checkbox.checked;
    checkbox.disabled = true;
    try {
      const response = await sendMessage({ action: "engagementSetKillSwitch", enabled });
      if (!response?.success) throw new Error(response?.error || "Không cập nhật được.");
      showAdminMsg(
        $("opsMessage"),
        enabled ? "Đã BẬT kill switch: dừng phát task mới." : "Đã TẮT kill switch.",
        enabled ? "error" : "success"
      );
    } catch (error) {
      checkbox.checked = !enabled;
      showAdminMsg($("opsMessage"), `Lỗi: ${error.message}`, "error");
    } finally {
      checkbox.disabled = false;
    }
  }

  async function cleanupEvents() {
    const days = Number($("cleanupDays")?.value) || 30;
    try {
      const response = await sendMessage({ action: "engagementCleanupEvents", olderThanDays: days });
      if (!response?.success) throw new Error(response?.error || "Dọn thất bại.");
      showAdminMsg($("opsMessage"), `Đã dọn nhật ký cũ hơn ${response.olderThanDays} ngày.`, "success");
    } catch (error) {
      showAdminMsg($("opsMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  async function toggleDevice(deviceId, username, revoke) {
    const verb = revoke ? "Thu hồi" : "Mở lại";
    if (revoke) {
      const ok = window.confirm(`${verb} thiết bị của @${username}? Máy này sẽ không claim task được nữa.`);
      if (!ok) return;
    }
    try {
      const response = await sendMessage({
        action: "engagementRevokeDevice",
        deviceId,
        username,
        revoked: revoke,
      });
      if (!response?.success) throw new Error(response?.error || "Không cập nhật được.");
      showAdminMsg($("opsMessage"), `Đã ${verb.toLowerCase()} thiết bị của @${username}.`, "success");
      await refreshOps();
    } catch (error) {
      showAdminMsg($("opsMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- init

  function bindEvents() {
    // User participation is read-only; only the admin global control changes it.
    if ($("refreshEngagementBtn")) {
      $("refreshEngagementBtn").addEventListener("click", () => loadEngagementState());
    }
    if ($("runEngagementOnceBtn")) {
      $("runEngagementOnceBtn").addEventListener("click", runOnce);
    }
    if ($("recheckSessionBtn")) {
      $("recheckSessionBtn").addEventListener("click", async () => {
        await checkSession(true);
        await loadEngagementState();
      });
    }
    if ($("openTechHubLoginBtn")) {
      $("openTechHubLoginBtn").addEventListener("click", async () => {
        await chrome.tabs.create({ url: "https://techhub.fpt.net/", active: true });
      });
    }
    if ($("gotoEngagementBtn")) {
      $("gotoEngagementBtn").addEventListener("click", () => showPanel("engagement"));
    }
    if ($("saveEngSettingsBtn")) {
      $("saveEngSettingsBtn").addEventListener("click", saveMachineSettings);
    }
    if ($("planCampaignBtn")) {
      $("planCampaignBtn").addEventListener("click", planCampaign);
    }
    if ($("refreshCampaignsBtn")) {
      $("refreshCampaignsBtn").addEventListener("click", refreshCampaigns);
    }
    if ($("campaignsList")) {
      $("campaignsList").addEventListener("click", (event) => {
        const pause = event.target.closest("[data-campaign-pause]");
        const resume = event.target.closest("[data-campaign-resume]");
        const cancel = event.target.closest("[data-campaign-cancel]");
        if (pause) setCampaignStatus(pause.dataset.campaignPause, "engagementPauseCampaign");
        if (resume) setCampaignStatus(resume.dataset.campaignResume, "engagementResumeCampaign");
        if (cancel) setCampaignStatus(cancel.dataset.campaignCancel, "engagementCancelCampaign");
      });
    }
    if ($("validateThreadsBtn")) {
      $("validateThreadsBtn").addEventListener("click", validateThreads);
    }
    if ($("importThreadsBtn")) {
      $("importThreadsBtn").addEventListener("click", importThreads);
    }
    if ($("refreshThreadsBtn")) {
      $("refreshThreadsBtn").addEventListener("click", refreshThreads);
    }
    if ($("threadStatusFilter")) {
      $("threadStatusFilter").addEventListener("change", refreshThreads);
    }
    if ($("threadsList")) {
      $("threadsList").addEventListener("click", (event) => {
        const edit = event.target.closest("[data-turn-edit]");
        const save = event.target.closest("[data-turn-save]");
        const cancel = event.target.closest("[data-turn-cancel]");
        const retry = event.target.closest("[data-turn-retry]");
        if (edit) {
          const editor = document.querySelector(`[data-turn-editor="${edit.dataset.turnEdit}"]`);
          if (editor) editor.classList.toggle("hidden");
        }
        if (save) saveTurn(save.dataset.turnSave);
        if (cancel) {
          const editor = document.querySelector(`[data-turn-editor="${cancel.dataset.turnCancel}"]`);
          if (editor) editor.classList.add("hidden");
        }
        if (retry) retryTurn(retry.dataset.turnRetry);
      });
    }
    if ($("refreshTasksBtn")) {
      $("refreshTasksBtn").addEventListener("click", refreshTasks);
    }
    if ($("refreshOpsBtn")) {
      $("refreshOpsBtn").addEventListener("click", refreshOps);
    }
    if ($("killSwitchToggle")) {
      $("killSwitchToggle").addEventListener("change", toggleKillSwitch);
    }
    if ($("engagementGlobalToggle")) {
      $("engagementGlobalToggle").addEventListener("change", async (event) => {
        const checkbox = event.currentTarget;
        checkbox.disabled = true;
        try {
          const response = await sendMessage({
            action: "engagementSetEnabled",
            enabled: checkbox.checked,
          });
          if (!response?.success) throw new Error(response?.error || "Không cập nhật được.");
          showAdminMsg($("opsMessage"), checkbox.checked
            ? "Đã bật tương tác cho mọi user."
            : "Đã tắt tương tác cho mọi user.", checkbox.checked ? "success" : "muted");
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          showAdminMsg($("opsMessage"), `Lỗi: ${error.message}`, "error");
        } finally {
          checkbox.disabled = false;
        }
      });
    }
    if ($("cleanupEventsBtn")) {
      $("cleanupEventsBtn").addEventListener("click", cleanupEvents);
    }
    if ($("devicesList")) {
      $("devicesList").addEventListener("click", (event) => {
        const button = event.target.closest("[data-device-toggle]");
        if (!button) return;
        const [deviceId, username, revoke] = String(button.dataset.deviceToggle).split("|");
        toggleDevice(deviceId, username, revoke === "1");
      });
    }
    // Cập nhật trạng thái khi background broadcast tiến trình tương tác.
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.action === "interactProgress") {
          loadEngagementState().catch(() => {});
        }
      });
    } catch (_) {
      // Bỏ qua khi chạy ngoài extension.
    }
  }

  async function init() {
    bindEvents();
    // Kiểm tra phiên + tải trạng thái ngay khi mở panel (không chờ init chính
    // xong mới kiểm tra phiên, nhưng phần admin vẫn cần chờ phân quyền).
    await checkSession(false);
    await loadEngagementState();
    await waitForInit();
    if (isAdminView()) {
      await refreshCampaigns().catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
