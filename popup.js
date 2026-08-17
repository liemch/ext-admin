// Popup — chỉ UI admin push bài

const ADMIN_SETTING_KEYS = [
  "max_comments",
  "push_ultra",
  "exceed_max_1_users",
  "exceed_max_3_users",
];

const elements = {
  errorSection: document.getElementById("errorSection"),
  errorMessage: document.getElementById("errorMessage"),
  retryBtn: document.getElementById("retryBtn"),
  deniedSection: document.getElementById("deniedSection"),
  adminSection: document.getElementById("adminSection"),
  adminUserLabel: document.getElementById("adminUserLabel"),
  settingMaxComments: document.getElementById("settingMaxComments"),
  settingPushUltra: document.getElementById("settingPushUltra"),
  settingExceed1: document.getElementById("settingExceed1"),
  settingExceed3: document.getElementById("settingExceed3"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  reloadSettingsBtn: document.getElementById("reloadSettingsBtn"),
  settingsMessage: document.getElementById("settingsMessage"),
  pushTechhubId: document.getElementById("pushTechhubId"),
  pushPostPreview: document.getElementById("pushPostPreview"),
  lookupPostBtn: document.getElementById("lookupPostBtn"),
  enableUltraBtn: document.getElementById("enableUltraBtn"),
  disableUltraBtn: document.getElementById("disableUltraBtn"),
  deleteInteractionsBtn: document.getElementById("deleteInteractionsBtn"),
  pushPostMessage: document.getElementById("pushPostMessage"),
};

let currentUserProfile = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setupEventListeners();

  if (
    SUPABASE_CONFIG.url === "YOUR_SUPABASE_URL" ||
    SUPABASE_CONFIG.anonKey === "YOUR_SUPABASE_ANON_KEY"
  ) {
    showError("Vui lòng cấu hình Supabase trong config.js");
    return;
  }

  await loadAdminGate();
}

function setupEventListeners() {
  if (elements.retryBtn) {
    elements.retryBtn.addEventListener("click", () => {
      hideAllStates();
      loadAdminGate();
    });
  }
  if (elements.saveSettingsBtn) {
    elements.saveSettingsBtn.addEventListener("click", saveAdminSettings);
  }
  if (elements.reloadSettingsBtn) {
    elements.reloadSettingsBtn.addEventListener("click", loadAdminSettings);
  }
  if (elements.lookupPostBtn) {
    elements.lookupPostBtn.addEventListener("click", lookupPushPost);
  }
  if (elements.enableUltraBtn) {
    elements.enableUltraBtn.addEventListener("click", () => setPostUltra(true));
  }
  if (elements.disableUltraBtn) {
    elements.disableUltraBtn.addEventListener("click", () => setPostUltra(false));
  }
  if (elements.deleteInteractionsBtn) {
    elements.deleteInteractionsBtn.addEventListener("click", deletePostInteractions);
  }
}

function hideAllStates() {
  elements.errorSection.classList.add("hidden");
  elements.deniedSection.classList.add("hidden");
  elements.adminSection.classList.add("hidden");
}

function showError(message) {
  hideAllStates();
  elements.errorSection.classList.remove("hidden");
  elements.errorMessage.textContent = message;
}

function showDenied() {
  hideAllStates();
  elements.deniedSection.classList.remove("hidden");
}

function showAdmin() {
  hideAllStates();
  elements.adminSection.classList.remove("hidden");
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function loadAdminGate() {
  try {
    const profileResponse = await sendMessage({ action: "getUserProfile" });
    if (!profileResponse.success || !profileResponse.userProfile) {
      showError(
        profileResponse.error ||
          "Không tìm thấy profile. Mở TechHub và đăng nhập trước."
      );
      return;
    }

    currentUserProfile = profileResponse.userProfile;
    const username = currentUserProfile.username;
    elements.adminUserLabel.textContent = `@${username || "-"}`;

    const isConnected = await supabase.testConnection();
    if (!isConnected) {
      throw new Error("Không kết nối được Supabase (kiểm tra mạng/proxy).");
    }

    const dbUser = await supabase.findUserByUsername(username);
    if (!dbUser || !dbUser.is_admin) {
      showDenied();
      return;
    }

    showAdmin();
    await loadAdminSettings();
  } catch (error) {
    showError("Lỗi: " + error.message);
  }
}

function showAdminMsg(el, text, type = "info") {
  if (!el) return;
  el.classList.remove("hidden", "ok", "err", "muted", "info");
  el.classList.add(
    type === "error" ? "err" : type === "success" ? "ok" : type === "muted" ? "muted" : "info"
  );
  el.textContent = text;
}

function parseSettingBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function loadAdminSettings() {
  try {
    showAdminMsg(elements.settingsMessage, "Đang tải settings...", "muted");
    const map = await supabase.getSettings(ADMIN_SETTING_KEYS);
    elements.settingMaxComments.value = map.max_comments ? map.max_comments.value : "";
    elements.settingPushUltra.checked = map.push_ultra
      ? parseSettingBool(map.push_ultra.value)
      : false;
    elements.settingExceed1.value = map.exceed_max_1_users
      ? String(map.exceed_max_1_users.value ?? "")
      : "";
    elements.settingExceed3.value = map.exceed_max_3_users
      ? String(map.exceed_max_3_users.value ?? "")
      : "";
    showAdminMsg(elements.settingsMessage, "Đã tải settings", "success");
  } catch (err) {
    showAdminMsg(elements.settingsMessage, `Lỗi tải settings: ${err.message}`, "error");
  }
}

async function saveAdminSettings() {
  elements.saveSettingsBtn.disabled = true;
  try {
    const maxComments = Number(elements.settingMaxComments.value);
    if (!Number.isFinite(maxComments) || maxComments < 1) {
      throw new Error("max_comments phải là số >= 1");
    }

    await supabase.updateSetting("max_comments", maxComments, { preserveUpdatedAt: true });
    await supabase.updateSetting("push_ultra", !!elements.settingPushUltra.checked, {
      preserveUpdatedAt: true,
    });
    await supabase.updateSetting(
      "exceed_max_1_users",
      String(elements.settingExceed1.value || "").trim(),
      { preserveUpdatedAt: true }
    );
    await supabase.updateSetting(
      "exceed_max_3_users",
      String(elements.settingExceed3.value || "").trim(),
      { preserveUpdatedAt: true }
    );

    showAdminMsg(elements.settingsMessage, "Đã lưu settings (giữ updated_at cũ)", "success");
  } catch (err) {
    showAdminMsg(elements.settingsMessage, `Lỗi lưu: ${err.message}`, "error");
  } finally {
    elements.saveSettingsBtn.disabled = false;
  }
}

async function lookupPushPost() {
  const techhubId = Number(elements.pushTechhubId.value);
  if (!Number.isFinite(techhubId) || techhubId < 1) {
    showAdminMsg(elements.pushPostMessage, "Nhập techhub_id hợp lệ", "error");
    return;
  }
  try {
    showAdminMsg(elements.pushPostMessage, "Đang tìm bài...", "muted");
    const post = await supabase.getPostByTechhubId(techhubId);
    if (!post) {
      elements.pushPostPreview.classList.add("hidden");
      showAdminMsg(elements.pushPostMessage, `Không tìm thấy bài ${techhubId}`, "error");
      return;
    }
    showAdminMsg(
      elements.pushPostPreview,
      `#${post.techhub_id} · @${post.username} · cmt=${post.comments_count} · fs=${post.feed_score} · ultra=${post.is_ultra} · ${post.title}`,
      "muted"
    );
    const interactions = await supabase.getInteractionsByTechhubId(techhubId);
    showAdminMsg(
      elements.pushPostMessage,
      `Đã tìm thấy bài · ${interactions.length} interactions trong DB`,
      "success"
    );
  } catch (err) {
    showAdminMsg(elements.pushPostMessage, `Lỗi: ${err.message}`, "error");
  }
}

async function deletePostInteractions() {
  const techhubId = Number(elements.pushTechhubId.value);
  if (!Number.isFinite(techhubId) || techhubId < 1) {
    showAdminMsg(elements.pushPostMessage, "Nhập techhub_id hợp lệ", "error");
    return;
  }

  try {
    const post = await supabase.getPostByTechhubId(techhubId);
    if (!post) {
      showAdminMsg(elements.pushPostMessage, `Không tìm thấy bài ${techhubId}`, "error");
      return;
    }

    const interactions = await supabase.getInteractionsByTechhubId(techhubId);
    if (interactions.length === 0) {
      showAdminMsg(elements.pushPostMessage, `Bài ${techhubId} không có interactions`, "muted");
      return;
    }

    const confirmed = window.confirm(
      `Xóa ${interactions.length} interactions của bài #${techhubId} (@${post.username})?\n\n` +
        "Thao tác này không xóa comment/like trên TechHub."
    );
    if (!confirmed) return;

    elements.deleteInteractionsBtn.disabled = true;
    const deleted = await supabase.deleteInteractionsByTechhubId(techhubId);
    const remaining = await supabase.getInteractionsByTechhubId(techhubId);
    showAdminMsg(
      elements.pushPostMessage,
      `Đã xóa ${deleted.length} interactions · còn ${remaining.length}`,
      "success"
    );
  } catch (err) {
    showAdminMsg(elements.pushPostMessage, `Lỗi xóa interactions: ${err.message}`, "error");
  } finally {
    elements.deleteInteractionsBtn.disabled = false;
  }
}

async function setPostUltra(enabled) {
  const techhubId = Number(elements.pushTechhubId.value);
  if (!Number.isFinite(techhubId) || techhubId < 1) {
    showAdminMsg(elements.pushPostMessage, "Nhập techhub_id hợp lệ", "error");
    return;
  }
  try {
    const updated = await supabase.updatePostFlags(techhubId, { is_ultra: enabled });
    if (!updated) {
      showAdminMsg(elements.pushPostMessage, `Không cập nhật được bài ${techhubId}`, "error");
      return;
    }
    showAdminMsg(
      elements.pushPostPreview,
      `#${updated.techhub_id} · @${updated.username} · cmt=${updated.comments_count} · fs=${updated.feed_score} · ultra=${updated.is_ultra} · ${updated.title}`,
      "muted"
    );
    showAdminMsg(
      elements.pushPostMessage,
      enabled
        ? `Đã bật is_ultra cho bài ${techhubId}. Nhớ bật push_ultra nếu đang tắt.`
        : `Đã tắt is_ultra cho bài ${techhubId}`,
      "success"
    );
  } catch (err) {
    showAdminMsg(elements.pushPostMessage, `Lỗi: ${err.message}`, "error");
  }
}
