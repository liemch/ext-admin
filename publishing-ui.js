// publishing-ui.js — UI Kho bài (admin) + Bài sắp đăng của tôi (user).
//
// Chạy sau popup.js nên dùng chung sendMessage / showAdminMsg / showPanel.
// Admin: nhập kho (copy prompt → JSON), biên tập/duyệt revision, phân bài và
// lịch tuần. User: xem bản sắp đăng, Chấp nhận / Từ chối (R5,
// PLAN_PRODUCT_9_10.md mục 17.3). Thực thi đăng bài thuộc R6.

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

  function isAdminView() {
    return !document.body.classList.contains("not-admin");
  }

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

  function fmtLocalDateTime(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return esc(iso);
    return date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  }

  // Preview Markdown đã sanitize: escape HTML trước, chỉ mở vài cú pháp an toàn.
  function renderSanitizedMarkdown(markdown) {
    const escaped = esc(String(markdown || ""));
    const safeUrl = (url) => /^https?:\/\//i.test(url) ? url : "#";
    return escaped
      .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
      .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
      .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) =>
        `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer noopener">${text}</a>`)
      .replace(/^[-*] (.*)$/gm, "<li>$1</li>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>");
  }

  // ---------------------------------------------------------- admin: nhập kho

  function buildContentPrompt() {
    const topic = String($("contentPromptTopic")?.value || "").trim() || "cải tiến quy trình hàng ngày";
    const audience = String($("contentPromptAudience")?.value || "").trim() || "đồng nghiệp nội bộ";
    const count = Math.min(20, Math.max(1, Number($("contentPromptCount")?.value) || 5));
    const structure =
      String($("contentPromptStructure")?.value || "").trim() ||
      "vấn đề → cách làm → kết quả, 3–5 đoạn";
    const schema = [
      {
        title: "Tiêu đề ngắn gọn",
        body: "Nội dung markdown",
        description: "Mô tả ngắn",
        preset: "Cải tiến mỗi ngày",
      },
    ];
    return [
      `Chủ đề: ${topic}`,
      `Đối tượng đọc: ${audience}`,
      `Cấu trúc mỗi bài: ${structure}`,
      "",
      `Hãy tạo đúng ${count} bài viết độc lập bằng tiếng Việt cho chủ đề trên.`,
      "- Mỗi bài một khía cạnh riêng, không trùng ý; giọng tự nhiên như nhân viên chia sẻ.",
      "- Không bịa số liệu, tên người hay kết quả không có căn cứ.",
      "- Không khen chung chung, không hashtag, không emoji, không nhắc tới AI.",
      "- Chỉ trả về JSON array hợp lệ, không markdown và không giải thích.",
      `Schema: ${JSON.stringify(schema)}`,
    ].join("\n");
  }

  async function copyContentPrompt() {
    try {
      await navigator.clipboard.writeText(buildContentPrompt());
      showAdminMsg(
        $("contentBatchMessage"),
        "Đã copy prompt. Dán vào ChatGPT/Gemini rồi đưa JSON kết quả vào ô bên dưới (tối đa 20 bài).",
        "success"
      );
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Không copy được prompt: ${error.message}`, "error");
    }
  }

  function readContentBatchJson() {
    const raw = String($("contentBatchJson")?.value || "").trim();
    if (!raw) return { items: null, error: "Chưa dán JSON batch." };
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { items: null, error: "JSON phải là một mảng bài." };
      return { items: parsed, error: null };
    } catch (error) {
      return { items: null, error: `JSON không hợp lệ: ${error.message}` };
    }
  }

  function renderBatchErrors(errors, message) {
    const box = $("contentBatchErrors");
    if (!box) return;
    if (!errors || errors.length === 0) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML =
      `<div class="msg err">${esc(message || "Batch có lỗi.")}</div>` +
      errors
        .map(
          (item) => `
        <div class="issue-item">
          <div class="issue-main">✗ [item ${esc(item.index)}${item.field ? ` · ${esc(item.field)}` : ""}] ${esc(item.message)}</div>
          <div class="issue-action">→ Bỏ item lỗi rồi bấm Kiểm tra lại; batch chỉ nhập khi hết lỗi, không item nào bị bỏ âm thầm.</div>
        </div>
      `
        )
        .join("");
  }

  async function submitContentBatch(dryRun) {
    const { items, error } = readContentBatchJson();
    if (error) {
      showAdminMsg($("contentBatchMessage"), error, "error");
      renderBatchErrors([], "");
      return;
    }
    try {
      const response = await sendMessage({
        action: "publishingImportBatch",
        payload: { items, dryRun, defaultPresetId: null },
      });
      if (!response?.success) {
        renderBatchErrors(response?.errors || [], response?.error || "Batch bị từ chối.");
        showAdminMsg(
          $("contentBatchMessage"),
          response?.message || response?.error || "Batch có lỗi, chưa nhập gì.",
          "error"
        );
        return;
      }
      renderBatchErrors(response.errors || [], "");
      if (dryRun) {
        showAdminMsg(
          $("contentBatchMessage"),
          `Kiểm tra đạt: ${response.valid} bài hợp lệ, sẵn sàng Nhập kho.`,
          "success"
        );
      } else {
        showAdminMsg(
          $("contentBatchMessage"),
          `Đã nhập ${response.imported?.length ?? 0} bài vào kho (trạng thái review).`,
          "success"
        );
        await refreshContentLibrary();
      }
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  function bindContentBatchFile() {
    const input = $("contentBatchFile");
    if (!input) return;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        showAdminMsg($("contentBatchMessage"), "File lớn hơn 1 MB (giới hạn pilot).", "error");
        input.value = "";
        return;
      }
      try {
        const text = await file.text();
        JSON.parse(text); // chỉ kiểm tra parse được UTF-8 JSON
        if ($("contentBatchJson")) $("contentBatchJson").value = text;
        showAdminMsg(
          $("contentBatchMessage"),
          "Đã nạp file JSON vào ô bên trên. Bấm Kiểm tra trước khi Nhập kho.",
          "success"
        );
      } catch (error) {
        showAdminMsg($("contentBatchMessage"), `File JSON không đọc được: ${error.message}`, "error");
      } finally {
        input.value = "";
      }
    });
  }

  // ---------------------------------------------------------- admin: kho bài

  const CONTENT_STATUS_BADGE = {
    draft: "info",
    review: "warn",
    approved: "ok",
    rejected: "err",
    archived: "muted",
  };

  let contentPresets = [];

  async function refreshContentPresets() {
    const response = await sendMessage({ action: "publishingListPresets" });
    if (!response?.success) throw new Error(response?.error || "Không tải được preset.");
    contentPresets = Array.isArray(response.presets) ? response.presets : [];
    const fill = (selectEl) => {
      if (!selectEl) return;
      const current = selectEl.value;
      selectEl.innerHTML =
        '<option value="">Chọn preset…</option>' +
        contentPresets
          .filter((preset) => preset.enabled !== false)
          .map(
            (preset) =>
              `<option value="${esc(preset.id)}">${esc(preset.name)} · community ${esc(preset.community_id)}</option>`
          )
          .join("");
      if (current) selectEl.value = current;
    };
    fill($("contentEditPreset"));
    return contentPresets;
  }

  async function refreshContentLibrary() {
    const list = $("contentLibraryList");
    if (!list) return;
    list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const status = String($("contentStatusFilter")?.value || "");
      const response = await sendMessage({
        action: "publishingListLibrary",
        payload: { status: status || null, limit: 100 },
      });
      if (!response?.success) throw new Error(response?.error || "Không tải được kho bài.");
      const items = Array.isArray(response.items) ? response.items : [];
      if (!items.length) {
        list.innerHTML = '<div class="empty">Kho chưa có bài nào.</div>';
        return;
      }
      list.innerHTML = items
        .map((item) => {
          const scheduled = item.scheduled
            ? ` · đã phân cho @${esc(item.scheduled.targetUsername)} (${fmtLocalDateTime(item.scheduled.scheduledAt)})`
            : "";
          const canEdit = ["draft", "review", "rejected"].includes(item.status);
          const canApprove = item.status !== "approved" && item.status !== "archived";
          return `
          <div class="schedule-item">
            <div class="schedule-main">
              <strong>#${esc(item.id)} ${esc(item.title)}</strong>
              <span class="badge ${CONTENT_STATUS_BADGE[item.status] || "info"}">${esc(item.status)}</span>
              <span class="schedule-meta">${esc(item.description || "không mô tả")}${scheduled}</span>
            </div>
            <div class="schedule-actions">
              ${canEdit ? `<button class="mini-btn" data-content-edit="${esc(item.id)}" type="button">Sửa</button>` : ""}
              ${canApprove ? `<button class="mini-btn" data-content-approve="${esc(item.id)}" type="button">Duyệt</button>` : ""}
              ${canApprove ? `<button class="mini-btn danger" data-content-reject="${esc(item.id)}" type="button">Từ chối</button>` : ""}
              ${item.status !== "archived" ? `<button class="mini-btn" data-content-archive="${esc(item.id)}" type="button">Lưu trữ</button>` : ""}
            </div>
          </div>
        `;
        })
        .join("");
    } catch (error) {
      list.innerHTML = `<div class="empty">Lỗi: ${esc(error.message)}</div>`;
    }
  }

  let editingContentId = null;

  async function editContentItem(contentItemId) {
    try {
      const response = await sendMessage({
        action: "publishingGetContentItem",
        payload: { contentItemId },
      });
      if (!response?.success) throw new Error(response?.error || "Không tải được bài.");
      const item = response.item;
      editingContentId = contentItemId;
      if ($("contentEditTitle")) $("contentEditTitle").value = item.title || "";
      if ($("contentEditDescription")) $("contentEditDescription").value = item.description || "";
      if ($("contentEditBody")) $("contentEditBody").value = item.body || "";
      if ($("contentEditMainImage")) $("contentEditMainImage").value = item.main_image || "";
      if ($("contentEditPreset")) $("contentEditPreset").value = String(item.preset_id || "");
      const box = $("contentEditorBox");
      if (box) box.classList.remove("hidden");
      const preview = $("contentEditPreview");
      if (preview) preview.classList.add("hidden");
      const warnings = $("contentEditWarnings");
      if (warnings) warnings.classList.add("hidden");
      box?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Lỗi mở bài: ${error.message}`, "error");
    }
  }

  function closeContentEditor() {
    editingContentId = null;
    $("contentEditorBox")?.classList.add("hidden");
  }

  function previewContentDraft() {
    const preview = $("contentEditPreview");
    if (!preview) return;
    const title = String($("contentEditTitle")?.value || "").trim();
    const body = String($("contentEditBody")?.value || "");
    preview.classList.remove("hidden");
    preview.innerHTML = `
      <div class="content-preview-inner">
        <h3>${esc(title)}</h3>
        <p>${renderSanitizedMarkdown(body)}</p>
      </div>
    `;
  }

  async function saveContentDraft() {
    if (!editingContentId) return;
    const payload = {
      contentItemId: editingContentId,
      title: String($("contentEditTitle")?.value || ""),
      body: String($("contentEditBody")?.value || ""),
      description: String($("contentEditDescription")?.value || ""),
      mainImage: String($("contentEditMainImage")?.value || ""),
      presetId: Number($("contentEditPreset")?.value) || null,
    };
    try {
      const response = await sendMessage({
        action: "publishingUpdateDraft",
        payload,
      });
      if (!response?.success) throw new Error(response?.error || "Không lưu được nháp.");
      const warnings = $("contentEditWarnings");
      if (response.warnings?.length) {
        if (warnings) {
          warnings.classList.remove("hidden");
          warnings.textContent =
            "Cảnh báo gần trùng: " +
            response.warnings.map((w) => `#${w.id} "${w.title}" (${w.status})`).join(", ");
        }
      } else if (warnings) {
        warnings.classList.add("hidden");
      }
      showAdminMsg(
        $("contentBatchMessage"),
        "Đã lưu nháp. Bản đã duyệt (nếu có) không đổi; duyệt lại để tạo revision mới.",
        "success"
      );
      await refreshContentLibrary();
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Lỗi lưu nháp: ${error.message}`, "error");
    }
  }

  async function approveContentItem(contentItemId) {
    if (!window.confirm(`Duyệt bài #${contentItemId}? Revision bất biến sẽ được tạo và dùng để phân lịch.`)) return;
    try {
      const response = await sendMessage({
        action: "publishingApproveContent",
        payload: { contentItemId },
      });
      if (!response?.success) throw new Error(response?.error || "Không duyệt được.");
      showAdminMsg(
        $("contentBatchMessage"),
        `Đã duyệt bài #${contentItemId} (revision #${response.revisionId}).`,
        "success"
      );
      await refreshContentLibrary();
      await refreshScheduleContentSelect();
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Lỗi duyệt: ${error.message}`, "error");
    }
  }

  async function rejectContentItem(contentItemId) {
    const reason = window.prompt(`Lý do từ chối bài #${contentItemId}?`, "");
    if (reason === null) return;
    try {
      const response = await sendMessage({
        action: "publishingRejectContent",
        payload: { contentItemId, reason },
      });
      if (!response?.success) throw new Error(response?.error || "Không từ chối được.");
      showAdminMsg($("contentBatchMessage"), `Đã từ chối bài #${contentItemId}.`, "success");
      await refreshContentLibrary();
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Lỗi từ chối: ${error.message}`, "error");
    }
  }

  async function archiveContentItem(contentItemId) {
    if (!window.confirm(`Lưu trữ bài #${contentItemId}? Bài sẽ rời kho đang dùng nhưng không mất dữ liệu.`)) return;
    try {
      const response = await sendMessage({
        action: "publishingArchiveContent",
        payload: { contentItemId },
      });
      if (!response?.success) throw new Error(response?.error || "Không lưu trữ được.");
      showAdminMsg($("contentBatchMessage"), `Đã lưu trữ bài #${contentItemId}.`, "success");
      await refreshContentLibrary();
    } catch (error) {
      showAdminMsg($("contentBatchMessage"), `Lỗi lưu trữ: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- admin: phân lịch

  async function refreshScheduleContentSelect() {
    const select = $("scheduleContentSelect");
    if (!select) return;
    try {
      const response = await sendMessage({
        action: "publishingListLibrary",
        payload: { status: "approved", limit: 200 },
      });
      if (!response?.success) throw new Error(response?.error || "Không tải được bài đã duyệt.");
      const items = (Array.isArray(response.items) ? response.items : []).filter(
        (item) => !item.scheduled
      );
      select.innerHTML =
        '<option value="">Chọn một bài…</option>' +
        items
          .map((item) => `<option value="${esc(item.id)}">#${esc(item.id)} · ${esc(item.title)}</option>`)
          .join("");
    } catch (error) {
      select.innerHTML = `<option value="">Lỗi: ${esc(error.message)}</option>`;
    }
  }

  async function createSchedule() {
    const contentItemId = Number($("scheduleContentSelect")?.value);
    const targetUsername = String($("scheduleTargetUsername")?.value || "").trim();
    const scheduledAtLocal = String($("scheduleAtInput")?.value || "");
    if (!contentItemId) {
      showAdminMsg($("scheduleMessage"), "Chọn bài đã duyệt trước.", "error");
      return;
    }
    if (!targetUsername) {
      showAdminMsg($("scheduleMessage"), "Nhập user sẽ đăng bài.", "error");
      return;
    }
    if (!scheduledAtLocal) {
      showAdminMsg($("scheduleMessage"), "Chọn giờ đăng.", "error");
      return;
    }
    const scheduledAt = new Date(scheduledAtLocal).toISOString();
    try {
      const response = await sendMessage({
        action: "publishingScheduleContent",
        payload: {
          contentItemId,
          targetUsername,
          scheduledAt,
          latePolicy: String($("scheduleLatePolicy")?.value || "manual_review"),
        },
      });
      if (!response?.success) throw new Error(response?.error || "Không phân được bài.");
      showAdminMsg(
        $("scheduleMessage"),
        `Đã phân bài #${contentItemId} cho @${targetUsername} lúc ${fmtLocalDateTime(response.scheduledAt)}; chờ user Chấp nhận.`,
        "success"
      );
      if ($("scheduleAtInput")) $("scheduleAtInput").value = "";
      await refreshSchedules();
      await refreshScheduleContentSelect();
    } catch (error) {
      showAdminMsg($("scheduleMessage"), `Lỗi phân bài: ${error.message}`, "error");
    }
  }

  const APPROVAL_BADGE = {
    pending: "warn",
    approved: "ok",
    rejected: "err",
  };

  async function refreshSchedules() {
    const list = $("schedulesList");
    if (!list) return;
    list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const payload = {
        status: String($("scheduleStatusFilter")?.value || "") || null,
        targetUsername: String($("scheduleUserFilter")?.value || "").trim() || null,
      };
      const response = await sendMessage({ action: "publishingListSchedules", payload });
      if (!response?.success) throw new Error(response?.error || "Không tải được lịch.");
      const schedules = Array.isArray(response.schedules) ? response.schedules : [];
      if (!schedules.length) {
        list.innerHTML = '<div class="empty">Chưa có lịch nào.</div>';
        return;
      }
      list.innerHTML = schedules
        .map((row) => {
          const canAct = ["active", "paused"].includes(row.status);
          return `
          <div class="schedule-item">
            <div class="schedule-main">
              <strong>${fmtLocalDateTime(row.scheduled_at)} · ${esc(row.title || `#${row.content_item_id}`)}</strong>
              <span class="badge ${row.status === "active" ? "ok" : row.status === "paused" ? "warn" : "info"}">${esc(row.status)}</span>
              <span class="badge ${APPROVAL_BADGE[row.approvalDecision] || "warn"}">user: ${esc(row.approvalDecision || "pending")}</span>
              <span class="schedule-meta">@${esc(row.target_username)} · rev ${esc(row.revisionNumber ?? "?")} · ${esc(row.late_policy)}</span>
            </div>
            <div class="schedule-actions">
              ${canAct ? `<button class="mini-btn" data-schedule-reschedule="${esc(row.id)}" type="button">Đổi giờ</button>` : ""}
              ${row.status === "active" ? `<button class="mini-btn" data-schedule-pause="${esc(row.id)}" type="button">Tạm dừng</button>` : ""}
              ${row.status === "paused" ? `<button class="mini-btn" data-schedule-resume="${esc(row.id)}" type="button">Tiếp tục</button>` : ""}
              ${canAct ? `<button class="mini-btn danger" data-schedule-cancel="${esc(row.id)}" type="button">Hủy</button>` : ""}
            </div>
          </div>
        `;
        })
        .join("");
    } catch (error) {
      list.innerHTML = `<div class="empty">Lỗi: ${esc(error.message)}</div>`;
    }
  }

  async function rescheduleItem(scheduleId) {
    const value = window.prompt("Giờ mới (định dạng YYYY-MM-DDTHH:MM, giờ địa phương):", "");
    if (!value) return;
    const scheduledAt = new Date(value).toISOString();
    try {
      const response = await sendMessage({
        action: "publishingUpdateSchedule",
        payload: { scheduleId, scheduledAt },
      });
      if (!response?.success) throw new Error(response?.error || "Không đổi giờ được.");
      showAdminMsg($("scheduleMessage"), `Đã đổi giờ lịch #${scheduleId}.`, "success");
      await refreshSchedules();
    } catch (error) {
      showAdminMsg($("scheduleMessage"), `Lỗi đổi giờ: ${error.message}`, "error");
    }
  }

  async function scheduleStatusAction(scheduleId, action, verb) {
    if (action === "publishingCancelSchedule" &&
        !window.confirm(`Hủy lịch #${scheduleId}?`)) return;
    try {
      const response = await sendMessage({ action, payload: { scheduleId } });
      if (!response?.success) throw new Error(response?.error || `Không ${verb} được.`);
      showAdminMsg($("scheduleMessage"), `Đã ${verb} lịch #${scheduleId}.`, "success");
      await refreshSchedules();
    } catch (error) {
      showAdminMsg($("scheduleMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- user: bài sắp đăng

  async function refreshMyPublishing() {
    const list = $("myPublishingList");
    if (!list) return;
    list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
      const response = await sendMessage({ action: "publishingGetMyStatus" });
      if (!response?.success) throw new Error(response?.error || "Không tải được lịch đăng.");
      const notice = $("myPublishingNotice");
      if (notice) {
        notice.classList.remove("hidden");
        notice.textContent = response.autoPublishEnabled
          ? "Bạn đã bật tự động đăng bài. Mỗi bản vẫn cần bạn Chấp nhận trước khi đăng."
          : "Tự động đăng bài đang tắt: bài chỉ đăng khi bạn bật opt-in trong Quyền tham gia (mở sau pilot).";
      }
      const schedules = Array.isArray(response.schedules) ? response.schedules : [];
      if (!schedules.length) {
        list.innerHTML = '<div class="empty">Chưa có bài nào được phân cho bạn.</div>';
        return;
      }
      list.innerHTML = schedules
        .map((row) => {
          const decision = row.approvalDecision || "pending";
          const canDecide = ["active", "paused"].includes(row.status) && decision !== "rejected";
          return `
          <div class="schedule-item">
            <div class="schedule-main">
              <strong>${fmtLocalDateTime(row.scheduledAt)} · ${esc(row.title || "Bài chưa đặt tên")}</strong>
              <span class="badge ${row.status === "active" ? "ok" : "warn"}">${esc(row.status)}</span>
              <span class="badge ${APPROVAL_BADGE[decision] || "warn"}">${decision === "approved" ? "đã chấp nhận" : decision === "rejected" ? "đã từ chối" : "chờ bạn duyệt"}</span>
              <span class="schedule-meta">đăng bằng @${esc(response.username)} · preset ${esc(row.presetName || "?")} · bản rev ${esc(row.revisionNumber ?? "?")}</span>
              <div class="content-preview-inner hidden" data-my-preview="${esc(row.scheduleId)}">
                <h4>${esc(row.title || "")}</h4>
                <p>${renderSanitizedMarkdown(row.body)}</p>
              </div>
            </div>
            <div class="schedule-actions">
              <button class="mini-btn" data-my-preview-toggle="${esc(row.scheduleId)}" type="button">Xem nội dung</button>
              ${canDecide ? `<button class="mini-btn" data-my-approve="${esc(row.scheduleId)}" type="button">Chấp nhận</button>` : ""}
              ${canDecide ? `<button class="mini-btn danger" data-my-reject="${esc(row.scheduleId)}" type="button">Từ chối</button>` : ""}
            </div>
          </div>
        `;
        })
        .join("");
    } catch (error) {
      list.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  async function decideMyApproval(scheduleId, decision) {
    const verb = decision === "approved" ? "Chấp nhận" : "Từ chối";
    if (!window.confirm(`${verb} bản sắp đăng #${scheduleId}?`)) return;
    try {
      const response = await sendMessage({
        action: "publishingDecideApproval",
        scheduleId,
        decision,
      });
      if (!response?.success) throw new Error(response?.error || `Không ${verb.toLowerCase()} được.`);
      showAdminMsg($("myPublishingMessage"), `Đã ${verb.toLowerCase()} bản #${scheduleId}.`, "success");
      await refreshMyPublishing();
    } catch (error) {
      showAdminMsg($("myPublishingMessage"), `Lỗi: ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- bind + init

  function bindEvents() {
    if ($("contentPromptCopyBtn")) {
      $("contentPromptCopyBtn").addEventListener("click", copyContentPrompt);
    }
    if ($("contentValidateBtn")) {
      $("contentValidateBtn").addEventListener("click", () => submitContentBatch(true));
    }
    if ($("contentImportBtn")) {
      $("contentImportBtn").addEventListener("click", () => submitContentBatch(false));
    }
    bindContentBatchFile();
    if ($("contentRefreshBtn")) {
      $("contentRefreshBtn").addEventListener("click", refreshContentLibrary);
    }
    if ($("contentStatusFilter")) {
      $("contentStatusFilter").addEventListener("change", refreshContentLibrary);
    }
    if ($("contentLibraryList")) {
      $("contentLibraryList").addEventListener("click", (event) => {
        const edit = event.target.closest("[data-content-edit]");
        const approve = event.target.closest("[data-content-approve]");
        const reject = event.target.closest("[data-content-reject]");
        const archive = event.target.closest("[data-content-archive]");
        if (edit) editContentItem(Number(edit.dataset.contentEdit));
        if (approve) approveContentItem(Number(approve.dataset.contentApprove));
        if (reject) rejectContentItem(Number(reject.dataset.contentReject));
        if (archive) archiveContentItem(Number(archive.dataset.contentArchive));
      });
    }
    if ($("contentEditPreviewBtn")) {
      $("contentEditPreviewBtn").addEventListener("click", previewContentDraft);
    }
    if ($("contentEditSaveBtn")) {
      $("contentEditSaveBtn").addEventListener("click", saveContentDraft);
    }
    if ($("contentEditCloseBtn")) {
      $("contentEditCloseBtn").addEventListener("click", closeContentEditor);
    }
    if ($("scheduleCreateBtn")) {
      $("scheduleCreateBtn").addEventListener("click", createSchedule);
    }
    if ($("scheduleRefreshBtn")) {
      $("scheduleRefreshBtn").addEventListener("click", async () => {
        await Promise.all([refreshSchedules(), refreshScheduleContentSelect()]);
      });
    }
    if ($("scheduleStatusFilter")) {
      $("scheduleStatusFilter").addEventListener("change", refreshSchedules);
    }
    if ($("scheduleUserFilter")) {
      $("scheduleUserFilter").addEventListener("change", refreshSchedules);
    }
    if ($("schedulesList")) {
      $("schedulesList").addEventListener("click", (event) => {
        const reschedule = event.target.closest("[data-schedule-reschedule]");
        const pause = event.target.closest("[data-schedule-pause]");
        const resume = event.target.closest("[data-schedule-resume]");
        const cancel = event.target.closest("[data-schedule-cancel]");
        if (reschedule) rescheduleItem(Number(reschedule.dataset.scheduleReschedule));
        if (pause) scheduleStatusAction(Number(pause.dataset.schedulePause), "publishingPauseSchedule", "tạm dừng");
        if (resume) scheduleStatusAction(Number(resume.dataset.scheduleResume), "publishingResumeSchedule", "tiếp tục");
        if (cancel) scheduleStatusAction(Number(cancel.dataset.scheduleCancel), "publishingCancelSchedule", "hủy");
      });
    }
    if ($("myPublishingRefreshBtn")) {
      $("myPublishingRefreshBtn").addEventListener("click", refreshMyPublishing);
    }
    if ($("myPublishingList")) {
      $("myPublishingList").addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-my-preview-toggle]");
        const approve = event.target.closest("[data-my-approve]");
        const reject = event.target.closest("[data-my-reject]");
        if (toggle) {
          const preview = document.querySelector(
            `[data-my-preview="${toggle.dataset.myPreviewToggle}"]`
          );
          if (preview) preview.classList.toggle("hidden");
          toggle.textContent = preview?.classList.contains("hidden") ? "Xem nội dung" : "Ẩn nội dung";
          return;
        }
        if (approve) decideMyApproval(Number(approve.dataset.myApprove), "approved");
        if (reject) decideMyApproval(Number(reject.dataset.myReject), "rejected");
      });
    }
  }

  async function init() {
    bindEvents();
    await waitForInit();
    // Phần user chạy cho mọi tài khoản; phần kho bài chỉ chạy trên máy admin.
    refreshMyPublishing().catch(() => {});
    if (isAdminView()) {
      await Promise.all([
        refreshContentPresets().catch(() => {}),
        refreshContentLibrary().catch(() => {}),
        refreshSchedules().catch(() => {}),
        refreshScheduleContentSelect().catch(() => {}),
      ]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
