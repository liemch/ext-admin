// Popup Script - Xử lý logic popup

// DOM Elements
const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  profileSection: document.getElementById("profileSection"),
  credentialsSection: document.getElementById("credentialsSection"),
  errorSection: document.getElementById("errorSection"),
  retryBtn: document.getElementById("retryBtn"),
  requireLoginAlert: document.getElementById("requireLoginAlert"),

  // Sync posts elements
  syncPostsBtn: document.getElementById("syncPostsBtn"),
  syncPostsMessage: document.getElementById("syncPostsMessage"),

  // Posts grid elements
  postsGrid: document.getElementById("postsGrid"),
  postsTotal: document.getElementById("postsTotal"),
  postsLoading: document.getElementById("postsLoading"),
  postsError: document.getElementById("postsError"),
  reloadPostsBtn: document.getElementById("reloadPostsBtn"),

  // Profile elements
  userAvatar: document.getElementById("userAvatar"),
  displayName: document.getElementById("displayName"),
  userEmail: document.getElementById("userEmail"),
  userDepartment: document.getElementById("userDepartment"),
  oxygenCount: document.getElementById("oxygenCount"),

  // Credentials elements
  userSyncDot: document.getElementById("userSyncDot"),
  dbConnectionDot: document.getElementById("dbConnectionDot"),

  // Error elements
  errorMessage: document.getElementById("errorMessage"),

  // Settings elements
  runInteractBtn: document.getElementById("runInteractBtn"),
  interactLog: document.getElementById("interactLog"),

  // Admin elements
  adminBtn: document.getElementById("adminBtn"),
  adminSection: document.getElementById("adminSection"),
  closeAdminBtn: document.getElementById("closeAdminBtn"),
  adminUsersList: document.getElementById("adminUsersList"),
  adminLoading: document.getElementById("adminLoading"),
  postsGridSection: document.querySelector(".posts-grid-section"),
};

// State
let currentUserProfile = null;
let currentCredentials = null;

// Khởi tạo khi popup được mở
document.addEventListener("DOMContentLoaded", init);

async function init() {
  console.log("Initializing TechHub Profile Sync popup...");

  // Kiểm tra config
  if (SUPABASE_CONFIG.url === "YOUR_SUPABASE_URL" || SUPABASE_CONFIG.anonKey === "YOUR_SUPABASE_ANON_KEY") {
    showError("Vui lòng cấu hình Supabase URL và Anon Key trong file config.js");
    return;
  }

  // Default status states
  updateUserSyncStatus("warn", "Đang kiểm tra...");
  updateDbConnectionStatus("warn", "Chưa kiểm tra");

  // Lấy thông tin user và credentials
  await loadData();

  // Setup event listeners
  setupEventListeners();

  // Bắt đầu đếm ngược
  startCountdown();
}

let countdownInterval;

function startCountdown() {
  chrome.alarms.get("crossInteractAlarm", (alarm) => {
    if (!alarm) {
      if (elements.userDepartment) elements.userDepartment.title = "Tự động tương tác: Tắt";
      return;
    }
    
    if (countdownInterval) clearInterval(countdownInterval);
    
    countdownInterval = setInterval(() => {
      const now = Date.now();
      const timeLeft = alarm.scheduledTime - now;
      
      if (timeLeft <= 0) {
        if (elements.userDepartment) elements.userDepartment.title = "Đang chạy tương tác...";
        setTimeout(startCountdown, 5000);
      } else {
        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        if (elements.userDepartment) {
          elements.userDepartment.title = `Tự động tương tác sau: ${minutes}:${seconds.toString().padStart(2, '0')} (Bấm để chạy thủ công)`;
        }
      }
    }, 1000);
  });
}

// Tải dữ liệu từ TechHub và storage
async function loadData() {
  try {
    updateStatus("checking", "Đang kiểm tra...");

    // Lấy userProfile từ localStorage của TechHub
    const profileResponse = await sendMessage({ action: "getUserProfile" });

    if (!profileResponse.success || !profileResponse.userProfile) {
      showError(profileResponse.error || "Không tìm thấy thông tin profile. Vui lòng mở TechHub và đăng nhập trước khi sử dụng.");
      return;
    }

    currentUserProfile = profileResponse.userProfile;
    console.log("User Profile:", currentUserProfile);

    // Lấy credentials từ storage
    const credentialsResponse = await sendMessage({ action: "getCredentials" });

    if (credentialsResponse.success && credentialsResponse.credentials) {
      currentCredentials = credentialsResponse.credentials;
      console.log("Credentials:", currentCredentials);
    }

    // Hiển thị dữ liệu
    displayUserProfile(currentUserProfile);
    displayCredentials(currentCredentials);

    updateStatus("connected", "Đã kết nối TechHub");

    // Tự động sync khi mở popup
    await autoSync();

    // Tự động load danh sách bài viết
    await loadPosts();
  } catch (error) {
    console.error("Error loading data:", error);
    showError("Lỗi khi tải dữ liệu: " + error.message);
  }
}

// Hiển thị thông tin profile
function displayUserProfile(profile) {
  if (!profile) return;

  elements.profileSection.classList.remove("hidden");

  // Avatar
  if (profile.avatar) {
    elements.userAvatar.src = profile.avatar;
  } else {
    elements.userAvatar.src = "icons/default-avatar.png";
  }

  // Basic info
  elements.displayName.textContent = profile.display_name || profile.username;
  elements.userEmail.textContent = profile.email || "-";

  // Department từ profile.profile
  const department = profile.profile?.department || "N/A";
  elements.userDepartment.textContent = department;

  // Stats
  const profileData = profile.profile || {};
  elements.oxygenCount.textContent = profileData.oxygen || 0;
}

// Hiển thị thông tin credentials
function displayCredentials(credentials) {
  if (!credentials || !credentials.capturedAt) {
    updateUserSyncStatus("warn", "Chưa đồng bộ");
    return;
  }

  // Last update
  const date = new Date(credentials.capturedAt);
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / 1000 / 60);

  if (diffMinutes < 1) {
    updateUserSyncStatus("ok", "Vừa xong");
  } else if (diffMinutes < 60) {
    updateUserSyncStatus("ok", `${diffMinutes} phút trước`);
  } else {
    updateUserSyncStatus(
      "ok",
      date.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  }
}
// Tự động sync khi mở popup
async function autoSync() {
  if (!currentUserProfile || !currentCredentials) {
    console.log("Auto sync skipped: missing profile or credentials");
    return;
  }

  if (!currentCredentials.cookie && !currentCredentials.csrfToken) {
    showSyncMessage("info", "Hãy truy cập profile trên TechHub để capture Cookie và CSRF Token");
    return;
  }

  await syncToSupabase();
}

// Đồng bộ với Supabase
async function syncToSupabase() {
  console.log("========== SYNC TO SUPABASE START ==========");
  console.log("Current User Profile:", currentUserProfile);
  console.log("Current Credentials:", currentCredentials);
  console.log("Supabase Config:", {
    url: SUPABASE_CONFIG.url,
    anonKey: SUPABASE_CONFIG.anonKey ? SUPABASE_CONFIG.anonKey.substring(0, 20) + "..." : "NULL",
    tableName: SUPABASE_CONFIG.tableName,
  });

  if (!currentUserProfile) {
    console.error("ERROR: No user profile");
    showSyncMessage("error", "Không có thông tin profile để đồng bộ");
    updateDbConnectionStatus("warn", "Thiếu profile");
    return;
  }

  if (!currentCredentials || (!currentCredentials.cookie && !currentCredentials.csrfToken)) {
    console.error("ERROR: No credentials", currentCredentials);
    showSyncMessage("error", "Không có credentials để đồng bộ. Vui lòng truy cập TechHub profile.");
    updateDbConnectionStatus("warn", "Thiếu credentials");
    return;
  }

  try {
    // Update DB status
    updateDbConnectionStatus("warn", "Đang đồng bộ...");
    console.log("Button disabled, starting sync...");

    // Test connection
    console.log("Testing Supabase connection...");
    const isConnected = await supabase.testConnection();
    console.log("Connection test result:", isConnected);
    if (!isConnected) {
      throw new Error("Không thể kết nối đến Supabase. Kiểm tra lại config.");
    }

    // Sync user
    console.log("Syncing user to Supabase...");
    const result = await supabase.syncUser(currentUserProfile);

    console.log("Sync result:", result);

    // Kiểm tra quyền Admin
    if (result.user && result.user.is_admin) {
      if (elements.adminBtn) elements.adminBtn.classList.remove("hidden");
    } else {
      if (elements.adminBtn) elements.adminBtn.classList.add("hidden");
    }

    // Hiển thị kết quả
    if (result.action === "created") {
      showSyncMessage("success", `✓ ${result.message}`);
      updateDbConnectionStatus("ok", "Đã đồng bộ");
    } else if (result.action === "updated") {
      showSyncMessage("success", `✓ ${result.message}`);
      updateDbConnectionStatus("ok", "Đã đồng bộ");
    }
  } catch (error) {
    console.error("Sync error:", error);
    showSyncMessage("error", `✗ Lỗi đồng bộ: ${error.message}`);
    updateDbConnectionStatus("error", "Lỗi kết nối");
  } finally {
  }
}

// Hiển thị message sync
function showSyncMessage(type, message) {
  if (!elements.syncMessage) return;
  elements.syncMessage.classList.remove("hidden", "success", "error", "info");
  elements.syncMessage.classList.add(type);
  elements.syncMessage.textContent = message;
}

// Hiển thị message sync posts
function showSyncPostsMessage(type, message) {
  if (!elements.syncPostsMessage) return;
  elements.syncPostsMessage.classList.remove("hidden", "success", "error", "info");
  elements.syncPostsMessage.classList.add(type);
  elements.syncPostsMessage.textContent = message;
}

// Đồng bộ bài viết
async function syncPosts() {
  console.log("========== SYNC POSTS START ==========");

  if (elements.syncPostsBtn) {
    elements.syncPostsBtn.classList.remove("btn-disconnected");
  }

  if ((elements.dbConnectionDot && elements.dbConnectionDot.classList.contains("status-error")) ||
      (elements.connectionStatus && elements.connectionStatus.classList.contains("status-error"))) {
    showSyncPostsMessage("error", "Lỗi kết nối. Không thể đồng bộ.");
    if (elements.syncPostsBtn) {
      elements.syncPostsBtn.classList.add("btn-disconnected");
      elements.syncPostsBtn.querySelector(".btn-text").textContent = "Disconnect";
    }
    return;
  }

  if (!currentUserProfile) {
    showSyncPostsMessage("error", "Không có thông tin profile");
    return;
  }

  const username = currentUserProfile.username;
  if (!username) {
    showSyncPostsMessage("error", "Không tìm thấy username");
    return;
  }

  try {
    // Disable button
    elements.syncPostsBtn.disabled = true;
    elements.syncPostsBtn.querySelector(".btn-text").textContent = "Đang đồng bộ...";
    showSyncPostsMessage("info", "Đang lấy dữ liệu từ TechHub...");

    // Gọi API đồng bộ
    const result = await supabase.syncPosts(username, (progressMsg) => {
      showSyncPostsMessage("info", progressMsg);
    });

    console.log("Sync posts result:", result);
    showSyncPostsMessage("success", `✓ ${result.message}`);

    // Reload danh sách bài viết sau khi đồng bộ
    await loadPosts();
  } catch (error) {
    console.error("Sync posts error:", error);
    showSyncPostsMessage("error", `✗ Lỗi: ${error.message}`);
    if (elements.syncPostsBtn) {
      elements.syncPostsBtn.classList.add("btn-disconnected");
      elements.syncPostsBtn.querySelector(".btn-text").textContent = "Disconnect";
    }
  } finally {
    // Re-enable button
    if (elements.syncPostsBtn) {
      elements.syncPostsBtn.disabled = false;
      if (!elements.syncPostsBtn.classList.contains("btn-disconnected")) {
        elements.syncPostsBtn.querySelector(".btn-text").textContent = "Đồng bộ";
      }
    }
  }
}

// Load danh sách bài viết
async function loadPosts() {
  if (!currentUserProfile || !currentUserProfile.username) {
    return;
  }

  const username = currentUserProfile.username;

  try {
    // Hiển thị loading
    elements.postsGrid.classList.add("hidden");
    elements.postsError.classList.add("hidden");
    elements.postsLoading.classList.remove("hidden");

    // Lấy dữ liệu từ Supabase
    const posts = await supabase.getPostsByUsername(username);
    
    // Sắp xếp bài viết mới nhất lên đầu
    if (posts && posts.length > 0) {
      posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Ẩn loading
    elements.postsLoading.classList.add("hidden");

    if (!posts || posts.length === 0) {
      // Không có bài viết
      elements.postsError.classList.remove("hidden");
      elements.postsTotal.textContent = "0 bài";
      return;
    }

    // Hiển thị tổng số bài viết
    elements.postsTotal.textContent = `${posts.length} bài`;

    // Render posts grid
    renderPostsGrid(posts);

    elements.postsGrid.classList.remove("hidden");
  } catch (error) {
    console.error("Load posts error:", error);
    elements.postsLoading.classList.add("hidden");
    elements.postsError.classList.remove("hidden");
    elements.postsError.querySelector("span").textContent = `⚠️ Lỗi: ${error.message}`;
  }
}

// Render danh sách bài viết
function renderPostsGrid(posts) {
  elements.postsGrid.innerHTML = "";

  posts.forEach((post) => {
    const postCard = document.createElement("div");
    postCard.className = "post-card";
    postCard.onclick = () => openPostInTechHub(post.url);

    // Format ngày tháng
    const createdDate = new Date(post.created_at).toLocaleDateString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Status badge
    const statusClass = post.status === "publish" ? "published" : "open";
    const statusText = post.status === "publish" ? "Published" : "open";

    // Highlight star
    const isHighlighted = post.feed_score >= 6 && post.status === "open";
    const starIcon = isHighlighted
      ? `<img src="icons/coin.png" alt="Đủ điểm OXY" title="Đủ điểm OXY" class="post-star" style="width: 16px; height: 16px; object-fit: contain;" />`
      : "";

    postCard.innerHTML = `
      ${starIcon}
      <div class="post-card-title">${post.title || "Untitled"}</div>
      <div class="post-card-meta">
        <span class="post-status-badge ${statusClass}">${statusText}</span>
        <span class="post-meta-item">
          <span class="icon">👍</span>
          <span>${post.votes_score || 0}</span>
        </span>
        <span class="post-meta-item">
          <span class="icon">💬</span>
          <span>${post.comments_count || 0}</span>
        </span>
        <span class="post-meta-item">
          <span class="icon">📅</span>
          <span>${createdDate}</span>
        </span>
      </div>
    `;

    elements.postsGrid.appendChild(postCard);
  });
}

// Mở bài viết trên TechHub
function openPostInTechHub(url) {
  if (url) {
    chrome.tabs.update({ url });
  }
}

// Cập nhật status badge
function updateStatus(status, text) {
  if (elements.connectionStatus) {
    elements.connectionStatus.className = `header-status-dot status-${status}`;
  }
  if (elements.footer) {
    if (status === "connected") {
      elements.footer.classList.add("hidden");
    } else {
      elements.footer.classList.remove("hidden");
    }
  }
}

// Cập nhật dot trạng thái
function setStatusDot(element, status) {
  if (!element) return;
  element.className = `status-dot status-${status}`;
}

function updateUserSyncStatus(status, text) {
  setStatusDot(elements.userSyncDot, status);
  if (elements.userSyncDot) {
    elements.userSyncDot.title = text;
  }
}

function updateDbConnectionStatus(status, text) {
  setStatusDot(elements.dbConnectionDot, status);
  if (elements.dbConnectionDot) {
    elements.dbConnectionDot.title = text;
  }
}

// Hiển thị error section
function showError(message) {
  updateStatus("error", "Lỗi");
  elements.profileSection.classList.add("hidden");
  if (elements.credentialsSection) {
    elements.credentialsSection.classList.add("hidden");
  }
  elements.errorSection.classList.remove("hidden");
  elements.errorMessage.textContent = message;
}

// Gửi message đến background script
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

// Setup event listeners
function setupEventListeners() {
  // Retry button
  if (elements.retryBtn) {
    elements.retryBtn.addEventListener("click", () => {
      elements.errorSection.classList.add("hidden");
      loadData();
    });
  }

  // Sync posts button
  if (elements.syncPostsBtn) {
    elements.syncPostsBtn.addEventListener("click", syncPosts);
  }

  // Reload posts button
  if (elements.reloadPostsBtn) {
    elements.reloadPostsBtn.addEventListener("click", loadPosts);
  }

  // Admin buttons
  if (elements.adminBtn) {
    elements.adminBtn.addEventListener("click", openAdminSection);
  }
  if (elements.closeAdminBtn) {
    elements.closeAdminBtn.addEventListener("click", closeAdminSection);
  }

  // Interact Button (Hidden on department badge)
  if (elements.userDepartment) {
    elements.userDepartment.addEventListener("click", () => {
      elements.interactLog.innerHTML = "";
      elements.interactLog.classList.remove("hidden");
      chrome.runtime.sendMessage({ action: "runInteractions" });
    });
  }

  // Listen for progress messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "interactProgress") {
      if (elements.interactLog) {
        elements.interactLog.classList.remove("hidden");
        const p = document.createElement("p");
        p.className = request.type;
        p.textContent = request.message;
        elements.interactLog.appendChild(p);
        elements.interactLog.scrollTop = elements.interactLog.scrollHeight;
        
        if (request.message.includes("Hoàn tất") || request.message.includes("Lỗi") || request.message.includes("Không có bài viết")) {
          if (elements.runInteractBtn) {
            elements.runInteractBtn.disabled = false;
            elements.runInteractBtn.querySelector(".btn-text").textContent = "Tương tác bài mới";
          }
          
          setTimeout(() => {
            elements.interactLog.classList.add("hidden");
          }, 5000);
        }
      }
    }
  });
}

// Admin logic
function openAdminSection() {
  if (elements.postsGridSection) elements.postsGridSection.classList.add("hidden");
  if (elements.adminSection) elements.adminSection.classList.remove("hidden");
  loadAdminUsers();
}

function closeAdminSection() {
  if (elements.postsGridSection) elements.postsGridSection.classList.remove("hidden");
  if (elements.adminSection) elements.adminSection.classList.add("hidden");
}

async function loadAdminUsers() {
  if (!elements.adminUsersList || !elements.adminLoading) return;
  
  elements.adminUsersList.innerHTML = "";
  elements.adminLoading.classList.remove("hidden");
  
  try {
    const users = await supabase.getAllUsers();
    const postsStats = await supabase.getAllPostsStats();
    const todayInteractions = await supabase.getTodayInteractionsStats();
    elements.adminLoading.classList.add("hidden");
    
    if (!users || users.length === 0) {
      elements.adminUsersList.innerHTML = "<tr><td colspan='6' style='text-align: center; padding: 20px;'>Không có người dùng nào</td></tr>";
      return;
    }
    
    // Sắp xếp người dùng theo số lượng bài viết (cao nhất lên trên)
    users.sort((a, b) => {
      const postsA = postsStats[a.username] ? postsStats[a.username].total : 0;
      const postsB = postsStats[b.username] ? postsStats[b.username].total : 0;
      return postsB - postsA;
    });
    
    users.forEach(user => {
      const tr = document.createElement("tr");
      
      const tdName = document.createElement("td");
      tdName.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="${user.avatar || 'icons/icon48.png'}" style="width: 24px; height: 24px; border-radius: 50%;">
          <div style="display: flex; flex-direction: column;">
            <span style="font-weight: 500;">${user.full_name || user.username}</span>
            <span style="font-size: 10px; color: #a0aec0;">@${user.username}</span>
          </div>
        </div>
      `;

      const stats = postsStats[user.username] || { total: 0, waiting: 0 };
      
      const tdPosts = document.createElement("td");
      tdPosts.style.textAlign = "center";
      tdPosts.style.fontWeight = "600";
      tdPosts.style.color = "#667eea";
      tdPosts.textContent = stats.total;

      const tdWaiting = document.createElement("td");
      tdWaiting.style.textAlign = "center";
      if (stats.waiting > 0) {
        tdWaiting.innerHTML = `<span style="color: #ffc107; font-weight: 600;">${stats.waiting}</span> <span style="font-size: 10px;">⭐</span>`;
      } else {
        tdWaiting.style.color = "#4b5563";
        tdWaiting.textContent = "0";
      }
      
      const tdInteractions = document.createElement("td");
      tdInteractions.style.textAlign = "center";
      tdInteractions.style.fontWeight = "600";
      const interactionCount = todayInteractions[user.username] || 0;
      if (interactionCount > 0) {
        tdInteractions.style.color = "#48bb78"; // Green if active today
        tdInteractions.textContent = interactionCount;
      } else {
        tdInteractions.style.color = "#a0aec0";
        tdInteractions.textContent = "0";
      }
      
      const tdAdmin = document.createElement("td");
      tdAdmin.className = "checkbox-wrapper";
      const chkAdmin = document.createElement("input");
      chkAdmin.type = "checkbox";
      chkAdmin.checked = !!user.is_admin;
      chkAdmin.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        e.target.disabled = true;
        try {
          await supabase.updateUserStatus(user.username, { is_admin: isChecked });
        } catch (err) {
          e.target.checked = !isChecked; // revert
          alert("Lỗi khi cập nhật quyền Admin");
        }
        e.target.disabled = false;
      });
      tdAdmin.appendChild(chkAdmin);
      
      const tdLocked = document.createElement("td");
      tdLocked.className = "checkbox-wrapper";
      const chkLocked = document.createElement("input");
      chkLocked.type = "checkbox";
      chkLocked.checked = !!user.is_locked;
      chkLocked.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        e.target.disabled = true;
        try {
          await supabase.updateUserStatus(user.username, { is_locked: isChecked });
        } catch (err) {
          e.target.checked = !isChecked; // revert
          alert("Lỗi khi cập nhật trạng thái Khóa");
        }
        e.target.disabled = false;
      });
      tdLocked.appendChild(chkLocked);
      
      tr.appendChild(tdName);
      tr.appendChild(tdPosts);
      tr.appendChild(tdWaiting);
      tr.appendChild(tdInteractions);
      tr.appendChild(tdAdmin);
      tr.appendChild(tdLocked);
      elements.adminUsersList.appendChild(tr);
    });
  } catch (err) {
    elements.adminLoading.classList.add("hidden");
    elements.adminUsersList.innerHTML = `<tr><td colspan='6' style='text-align: center; color: #f56565;'>Lỗi tải dữ liệu: ${err.message}</td></tr>`;
  }
}
