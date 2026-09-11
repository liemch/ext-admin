// Supabase Client - Tương tác với Supabase REST API

/**
 * @typedef {Object} UserModel
 * @property {number} id
 * @property {string|null} full_name
 * @property {string|null} username
 * @property {string|null} email
 * @property {string|null} avatar
 * @property {number} posts_count
 * @property {string|null} last_update
 * @property {string} created_at
 * @property {boolean} is_locked
 * @property {boolean} is_admin
 */

/**
 * @typedef {Object} PostModel
 * @property {number} id
 * @property {string|null} title
 * @property {string|null} status
 * @property {number|null} techhub_id
 * @property {string|null} techhub_uuid
 * @property {string|null} username
 * @property {string|null} url
 * @property {number} votes_score
 * @property {number} comments_count
 * @property {number} medals_count
 * @property {number} feed_score
 * @property {string} created_at
 * @property {string} published_at
 */

/**
 * Đếm medal trên bài TechHub (API có thể trả mảng hoặc số).
 * @param {Object} article
 * @returns {number}
 */
function extractMedalsCount(article) {
  if (!article || typeof article !== "object") return 0;
  const candidates = [
    article.medals_count,
    article.medal_count,
    article.medalsCount,
    article.medalCount,
    article.received_medals_count,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  }

  const arrays = [
    article.medals,
    article.received_medals,
    article.awards,
    article.badges,
  ];
  for (const list of arrays) {
    if (Array.isArray(list)) return list.length;
  }

  if (article.medal || article.has_medal || article.hasMedal) return 1;
  return 0;
}

/**
 * Khoảng tháng lịch: từ tháng A đến tháng B, tối đa 2 tháng.
 * `end` là mốc exclusive (đầu tháng liền sau tháng kết thúc).
 */
function resolveCommunityScanRange(fromMonth, toMonth) {
  const parse = (value) => {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || month < 1 || month > 12) return null;
    return { year, month };
  };
  const from = parse(fromMonth);
  const to = parse(toMonth);
  if (!from || !to) throw new Error("Tháng không hợp lệ. Hãy chọn dạng YYYY-MM.");
  const fromIndex = from.year * 12 + from.month;
  const toIndex = to.year * 12 + to.month;
  if (fromIndex > toIndex) {
    throw new Error("Tháng bắt đầu phải trước hoặc trùng tháng kết thúc.");
  }
  const span = toIndex - fromIndex + 1;
  if (span > 2) throw new Error("Chỉ được chọn tối đa 2 tháng.");
  const start = new Date(from.year, from.month - 1, 1);
  const end = new Date(to.year, to.month, 1);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    fromMonth: `${from.year}-${pad(from.month)}`,
    toMonth: `${to.year}-${pad(to.month)}`,
    label:
      fromIndex === toIndex
        ? `${pad(from.month)}/${from.year}`
        : `${pad(from.month)}/${from.year}–${pad(to.month)}/${to.year}`,
    span,
    start,
    end,
  };
}

/**
 * @typedef {Object} PostDetailModel
 * @property {number} id
 * @property {number|null} techhub_id
 * @property {string|null} username
 * @property {boolean} is_liked
 * @property {string|null} comment
 * @property {string} created_at
 */

class SupabaseClient {
  constructor(url, anonKey) {
    this.url = url;
    this.anonKey = anonKey;
    this.restUrl = `${url}/rest/v1`;
  }

  // Headers mặc định cho requests
  getHeaders() {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${this.anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  /**
   * Tìm user theo username
   * @param {string} username
   * @returns {Promise<Object|null>}
   */
  async findUserByUsername(username) {
    console.log("[Supabase] Finding user by username:", username);
    try {
      const url = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?username=eq.${encodeURIComponent(username)}`;
      console.log("[Supabase] Find URL:", url);
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      console.log("[Supabase] Find response status:", response.status);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Find error response:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log("[Supabase] Find result:", data);
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("[Supabase] Error finding user:", error);
      throw error;
    }
  }

  /**
   * Tạo user mới
   * @param {Object} userData
   * @returns {Promise<Object>}
   */
  async createUser(userData) {
    console.log("[Supabase] Creating user:", userData);
    try {
      const payload = {
        full_name: userData.fullName || userData.displayName,
        username: userData.username,
        email: userData.email,
        avatar: userData.avatar,
        last_update: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      console.log("[Supabase] Create payload:", payload);

      const response = await fetch(`${this.restUrl}/${SUPABASE_CONFIG.tableName}`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      console.log("[Supabase] Create response status:", response.status);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Create error response:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log("[Supabase] Create result:", data);
      return data[0];
    } catch (error) {
      console.error("[Supabase] Error creating user:", error);
      throw error;
    }
  }

  /**
   * Cập nhật thời gian hoạt động cuối của user
   * @param {string} username
   * @returns {Promise<Object>}
   */
  async updateUserActivity(username) {
    console.log("[Supabase] Updating activity for:", username);
    try {
      const url = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?username=eq.${encodeURIComponent(username)}`;
      const payload = {
        last_update: new Date().toISOString(),
      };
      console.log("[Supabase] Update URL:", url);

      const response = await fetch(url, {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      console.log("[Supabase] Update response status:", response.status);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Update error response:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log("[Supabase] Update result:", data);
      return data[0];
    } catch (error) {
      console.error("[Supabase] Error updating user credentials:", error);
      throw error;
    }
  }

  /**
   * Kiểm tra và tạo/cập nhật user
   * @param {Object} userProfile - Thông tin profile từ TechHub
   * @returns {Promise<{action: string, user: Object}>}
   */
  async syncUser(userProfile) {
    console.log("[Supabase] ========== SYNC USER ==========");
    console.log("[Supabase] UserProfile:", userProfile);
    try {
      console.log("[Supabase] Finding existing user...");
      const existingUser = await this.findUserByUsername(userProfile.username);
      console.log("[Supabase] Existing user:", existingUser);

      if (existingUser) {
        console.log("[Supabase] User exists, updating activity...");
        // User đã tồn tại - Cập nhật activity
        const updatedUser = await this.updateUserActivity(userProfile.username);
        console.log("[Supabase] Updated user:", updatedUser);
        return {
          action: "updated",
          user: updatedUser,
          message: `Đã cập nhật thông tin cho user: ${userProfile.username}`,
        };
      } else {
        console.log("[Supabase] User not found, creating new...");
        // User chưa tồn tại - Tạo mới
        const newUser = await this.createUser({
          fullName: userProfile.display_name || userProfile.username,
          username: userProfile.username,
          email: userProfile.email,
          avatar: userProfile.avatar,
        });
        console.log("[Supabase] Created user:", newUser);
        return {
          action: "created",
          user: newUser,
          message: `Đã tạo mới user: ${userProfile.username}`,
        };
      }
    } catch (error) {
      console.error("[Supabase] Error syncing user:", error);
      throw error;
    }
  }

  /**
   * Kiểm tra kết nối đến Supabase
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    console.log("[Supabase] Testing connection...");
    console.log("[Supabase] URL:", this.restUrl);
    console.log("[Supabase] Table:", SUPABASE_CONFIG.tableName);
    try {
      const url = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?limit=1`;
      console.log("[Supabase] Test URL:", url);
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });
      console.log("[Supabase] Test response status:", response.status);
      console.log("[Supabase] Test response ok:", response.ok);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Test error:", errorText);
      }
      return response.ok;
    } catch (error) {
      console.error("[Supabase] Connection test failed:", error);
      return false;
    }
  }

  // ==================== POSTS METHODS ====================

  /**
   * Lấy danh sách posts theo username với phân trang
   * @param {string} username
   * @param {number} page - Trang hiện tại (bắt đầu từ 1)
   * @param {number} limit - Số bài viết mỗi trang
   * @returns {Promise<{posts: Array<PostModel>, total: number, page: number, totalPages: number}>}
   */
  async getPostsByUsernameWithPagination(username, page = 1, limit = 5) {
    console.log(`[Supabase] Getting posts by username: ${username}, page: ${page}, limit: ${limit}`);
    try {
      // Tính offset
      const offset = (page - 1) * limit;

      // Lấy dữ liệu phân trang với count, sắp xếp theo created_at mới nhất
      const url = `${this.restUrl}/posts?username=eq.${encodeURIComponent(username)}&order=created_at.desc&limit=${limit}&offset=${offset}`;
      console.log("[Supabase] Get posts URL:", url);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...this.getHeaders(),
          Prefer: "count=exact",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Get posts error:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      // Lấy tổng số từ Content-Range header
      const contentRange = response.headers.get("content-range");
      console.log("[Supabase] Content-Range:", contentRange);

      const total = contentRange ? parseInt(contentRange.split("/")[1] || "0") : 0;
      console.log("[Supabase] Total posts:", total);

      const posts = await response.json();
      const totalPages = Math.ceil(total / limit);

      console.log(`[Supabase] Posts found: ${posts.length}/${total}, page: ${page}/${totalPages}`);

      return {
        posts,
        total,
        page,
        totalPages,
      };
    } catch (error) {
      console.error("[Supabase] Error getting posts:", error);
      throw error;
    }
  }

  /**
   * Lấy danh sách posts theo username
   * @param {string} username
   * @returns {Promise<Array<PostModel>>}
   */
  async getPostsByUsername(username) {
    console.log("[Supabase] Getting posts by username:", username);
    try {
      const url = `${this.restUrl}/posts?username=eq.${encodeURIComponent(username)}`;
      console.log("[Supabase] Get posts URL:", url);
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Get posts error:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log("[Supabase] Posts found:", data.length);
      return data;
    } catch (error) {
      console.error("[Supabase] Error getting posts:", error);
      throw error;
    }
  }

  /**
   * Tìm post theo techhub_id
   * @param {number} techhubId
   * @returns {Promise<PostModel|null>}
   */
  async findPostByTechhubId(techhubId) {
    console.log("[Supabase] Finding post by techhub_id:", techhubId);
    try {
      const url = `${this.restUrl}/posts?techhub_id=eq.${techhubId}`;
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Find post error:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("[Supabase] Error finding post:", error);
      throw error;
    }
  }

  /**
   * Tạo post mới
   * @param {Object} postData
   * @returns {Promise<PostModel>}
   */
  async createPost(postData) {
    console.log("[Supabase] Creating post:", postData.title);
    try {
      const payload = {
        title: postData.title,
        status: postData.status,
        techhub_id: postData.techhubId,
        techhub_uuid: postData.techhubUuid,
        username: postData.username,
        url: postData.url,
        votes_score: postData.votesScore || 0,
        comments_count: postData.commentsCount || 0,
        medals_count: postData.medalsCount || 0,
        feed_score: postData.feedScore || 0,
        created_at: postData.createdAt || new Date().toISOString(),
        published_at: postData.publishedAt || null,
      };

      const response = await fetch(`${this.restUrl}/posts`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Create post error:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log("[Supabase] Post created:", data[0]);
      return data[0];
    } catch (error) {
      console.error("[Supabase] Error creating post:", error);
      throw error;
    }
  }

  /**
   * Cập nhật post theo techhub_id
   * @param {number} techhubId
   * @param {Object} updateData
   * @returns {Promise<PostModel>}
   */
  async updatePost(techhubId, updateData) {
    console.log("[Supabase] Updating post:", techhubId);
    try {
      const url = `${this.restUrl}/posts?techhub_id=eq.${techhubId}`;
      const payload = {
        votes_score: updateData.votesScore,
        comments_count: updateData.commentsCount,
        medals_count: updateData.medalsCount ?? 0,
        feed_score: updateData.feedScore,
        published_at: updateData.publishedAt,
        status: updateData.status,
      };

      const response = await fetch(url, {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Supabase] Update post error:", errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log("[Supabase] Post updated:", data[0]);
      return data[0];
    } catch (error) {
      console.error("[Supabase] Error updating post:", error);
      throw error;
    }
  }

  /**
   * Lấy thống kê số lượng bài viết và số bài đang chờ publish của tất cả người dùng
   * @returns {Promise<Object>}
   */
  async getAllPostsStats() {
    try {
      const url = `${this.restUrl}/posts?select=username,status,feed_score`;
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch posts stats: ${response.status}`);
      const posts = await response.json();
      
      const stats = {};
      posts.forEach(p => {
        if (!stats[p.username]) stats[p.username] = { total: 0, waiting: 0 };
        stats[p.username].total++;
        if (p.status === 'open' && p.feed_score >= 6) {
          stats[p.username].waiting++;
        }
      });
      return stats;
    } catch (error) {
      console.error("[Supabase] Error fetching all posts stats:", error);
      return {};
    }
  }

  /**
   * Lấy thống kê số lượt tương tác trong ngày hôm nay của tất cả người dùng
   * @returns {Promise<Object>}
   */
  async getTodayInteractionsStats() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();
      
      const url = `${this.restUrl}/interactions?created_at=gte.${todayStr}&interaction_type=eq.comment&select=username`;
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch interactions stats: ${response.status}`);
      const interactions = await response.json();
      
      const stats = {};
      interactions.forEach(i => {
        if (!stats[i.username]) stats[i.username] = 0;
        stats[i.username]++;
      });
      return stats;
    } catch (error) {
      console.error("[Supabase] Error fetching today interactions stats:", error);
      return {};
    }
  }

  /**
   * Lấy danh sách tất cả người dùng
   * @returns {Promise<Array>}
   */
  async getAllUsers() {
    try {
      const url = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?order=created_at.desc`;
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("[Supabase] Error fetching all users:", error);
      throw error;
    }
  }

  /**
   * Cập nhật trạng thái người dùng (Admin, Locked)
   * @param {string} username 
   * @param {Object} updates 
   * @returns {Promise<Object>}
   */
  async updateUserStatus(username, updates) {
    try {
      const url = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?username=eq.${encodeURIComponent(username)}`;
      const payload = {};
      if (updates.hasOwnProperty('is_locked')) payload.is_locked = updates.is_locked;
      if (updates.hasOwnProperty('is_admin')) payload.is_admin = updates.is_admin;
      payload.last_update = new Date().toISOString();

      const response = await fetch(url, {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Failed to update user status: ${response.status}`);
      const data = await response.json();
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("[Supabase] Error updating user status:", error);
      throw error;
    }
  }

  /**
   * Đếm số bài đã lưu theo username (dùng cho panel quản lý người dùng)
   * @returns {Promise<Object>} map username -> số bài
   */
  async getPostCountsByUsername() {
    try {
      const url = `${this.restUrl}/posts?select=username`;
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch posts: ${response.status}`);
      const rows = await response.json();
      const counts = {};
      rows.forEach((row) => {
        if (!row.username) return;
        counts[row.username] = (counts[row.username] || 0) + 1;
      });
      return counts;
    } catch (error) {
      console.error("[Supabase] Error counting posts by username:", error);
      throw error;
    }
  }

  /**
   * Xóa user theo username (chỉ xóa dòng trong bảng users, giữ lại bài viết/tương tác)
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async deleteUserByUsername(username) {
    try {
      const url = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?username=eq.${encodeURIComponent(username)}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: this.getHeaders(),
      });
      if (!response.ok) throw new Error(`Failed to delete user: ${response.status}`);
      return true;
    } catch (error) {
      console.error("[Supabase] Error deleting user:", error);
      throw error;
    }
  }

  /**
   * Lấy settings theo danh sách key
   * @param {string[]} [keys]
   * @returns {Promise<Object>} map key -> row
   */
  async getSettings(keys = null) {
    try {
      let url = `${this.restUrl}/settings?select=id,key,value,description,updated_at&order=key`;
      if (keys && keys.length > 0) {
        url += `&key=in.(${keys.map((k) => encodeURIComponent(k)).join(",")})`;
      }
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch settings: ${response.status}`);
      const rows = await response.json();
      const map = {};
      rows.forEach((row) => {
        map[row.key] = row;
      });
      return map;
    } catch (error) {
      console.error("[Supabase] Error fetching settings:", error);
      throw error;
    }
  }

  /**
   * Cập nhật 1 setting. Mặc định giữ nguyên updated_at để không để lại vết thời gian.
   * @param {string} key
   * @param {any} value
   * @param {{preserveUpdatedAt?: boolean}} [options]
   */
  async updateSetting(key, value, options = {}) {
    const preserveUpdatedAt = options.preserveUpdatedAt !== false;
    try {
      const currentMap = await this.getSettings([key]);
      const current = currentMap[key];
      if (!current) throw new Error(`Setting not found: ${key}`);

      const payload = { value };
      if (preserveUpdatedAt && current.updated_at) {
        payload.updated_at = current.updated_at;
      }

      const url = `${this.restUrl}/settings?key=eq.${encodeURIComponent(key)}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to update setting ${key}: ${response.status} ${errText}`);
      }
      const data = await response.json();
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("[Supabase] Error updating setting:", error);
      throw error;
    }
  }

  /**
   * Lấy 1 post theo techhub_id
   * @param {number|string} techhubId
   */
  async getPostByTechhubId(techhubId) {
    try {
      const url = `${this.restUrl}/posts?techhub_id=eq.${techhubId}&limit=1`;
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch post: ${response.status}`);
      const data = await response.json();
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("[Supabase] Error fetching post:", error);
      throw error;
    }
  }

  /**
   * Xóa post khỏi Supabase theo techhub_id (sau khi xóa trên TechHub)
   */
  async deletePostByTechhubId(techhubId) {
    const url = `${this.restUrl}/posts?techhub_id=eq.${techhubId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        ...this.getHeaders(),
        Prefer: "return=representation",
      },
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to delete post from DB: ${response.status} ${errText}`);
    }
    return await response.json();
  }

  /**
   * Xóa các bài của user còn trong DB nhưng không còn trong lần quét đầy đủ từ TechHub.
   */
  async deleteOwnPostsMissingFromTechHub(username, liveTechhubIds) {
    const liveIds = new Set(
      Array.from(liveTechhubIds || [], (id) => Number(id)).filter(Number.isInteger)
    );
    const listUrl =
      `${this.restUrl}/posts?username=eq.${encodeURIComponent(username)}` +
      `&select=techhub_id&limit=5000`;
    const response = await fetch(listUrl, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to list posts for reconciliation: ${response.status}`);
    }
    const storedPosts = await response.json();
    const staleIds = storedPosts
      .map((post) => Number(post.techhub_id))
      .filter((id) => Number.isInteger(id) && !liveIds.has(id));

    for (const techhubId of staleIds) {
      await this.deletePostByTechhubId(techhubId);
    }
    return staleIds.length;
  }

  /**
   * Cập nhật flag bài viết (vd: is_ultra)
   * @param {number|string} techhubId
   * @param {Object} updates
   */
  async updatePostFlags(techhubId, updates) {
    try {
      const payload = {};
      if (updates.hasOwnProperty("is_ultra")) payload.is_ultra = !!updates.is_ultra;
      if (updates.hasOwnProperty("is_blacklisted")) payload.is_blacklisted = !!updates.is_blacklisted;
      if (Object.keys(payload).length === 0) throw new Error("No post flags to update");

      const url = `${this.restUrl}/posts?techhub_id=eq.${techhubId}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          ...this.getHeaders(),
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to update post: ${response.status} ${errText}`);
      }
      const data = await response.json();
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("[Supabase] Error updating post flags:", error);
      throw error;
    }
  }

  /**
   * Lấy interactions của một bài.
   * @param {number|string} techhubId
   * @returns {Promise<Array>}
   */
  async getInteractionsByTechhubId(techhubId) {
    try {
      const url = `${this.restUrl}/interactions?techhub_id=eq.${techhubId}&select=id,username,interaction_type,created_at&order=created_at.desc`;
      const response = await fetch(url, { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Failed to fetch interactions: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("[Supabase] Error fetching interactions:", error);
      throw error;
    }
  }

  /**
   * Xóa toàn bộ interactions của một bài.
   * @param {number|string} techhubId
   * @returns {Promise<Array>}
   */
  async deleteInteractionsByTechhubId(techhubId) {
    try {
      const url = `${this.restUrl}/interactions?techhub_id=eq.${techhubId}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          ...this.getHeaders(),
          Prefer: "return=representation",
        },
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to delete interactions: ${response.status} ${errText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("[Supabase] Error deleting interactions:", error);
      throw error;
    }
  }

  /**
   * Lấy danh sách bài viết từ TechHub API
   * @param {string} username
   * @param {number} page
   * @returns {Promise<Object>}
   */
  async fetchTechHubArticles(username, page = 1) {
    console.log(`[TechHub] Fetching articles for ${username}, page ${page}`);
    try {
      const url = `https://techhub.fpt.net/api/v1/articles/?username=${encodeURIComponent(username)}&page=${page}`;
      console.log("[TechHub] API URL:", url);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[TechHub] API error:", errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[TechHub] Found ${data.results.length} articles (total: ${data.count})`);
      return data;
    } catch (error) {
      console.error("[TechHub] Error fetching articles:", error);
      throw error;
    }
  }

  /**
   * Quét bài theo chuyên mục.
   *
   * Trang chuyên mục gọi `?community__slug=<slug>&sort=new&date_range=all`;
   * thiếu `date_range=all` thì API chỉ trả về bài trong khoảng thời gian mặc định.
   * Các tên query khác chỉ là dự phòng, và vì TechHub bỏ qua param lạ rồi trả về
   * feed chung nên một ứng viên chỉ được chấp nhận khi mọi bài đều đúng slug.
   */
  async fetchTechHubCommunityArticles(communitySlug, options = {}) {
    const slug = String(communitySlug || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error("Slug chuyên mục không hợp lệ.");
    }

    const range = resolveCommunityScanRange(
      options.fromMonth || options.toMonth,
      options.toMonth || options.fromMonth
    );
    const fromStart = range.start.getTime();
    const toEnd = range.end.getTime();
    const sort = options.sort || "new";
    const dateRange = options.dateRange || "all";
    const MAX_PAGES = 30;
    const buildUrl = (params) => {
      const query = new URLSearchParams(params);
      query.set("sort", sort);
      query.set("date_range", dateRange);
      return `https://techhub.fpt.net/api/v1/articles/?${query.toString()}`;
    };
    const candidates = ["community__slug", "community_slug", "community"].map(
      (queryName) => ({
        mode: queryName,
        build: (page) => buildUrl({ [queryName]: slug, page: String(page) }),
      })
    );
    const feedCandidate = {
      mode: "client",
      build: (page) => buildUrl({ page: String(page) }),
    };

    const fetchPage = async (candidate, page) => {
      const response = await fetch(candidate.build(page), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Không quét được chuyên mục (HTTP ${response.status}: ${errorText.slice(0, 120)})`
        );
      }
      return response.json();
    };
    const getRows = (data) =>
      Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.results?.data)
          ? data.results.data
          : Array.isArray(data)
            ? data
            : [];
    const slugOf = (article) =>
      String(
        article?.community?.slug ||
          article?.community_slug ||
          article?.communitySlug ||
          ""
      ).toLowerCase();

    let selected = null;
    let firstData = null;
    for (const candidate of candidates) {
      try {
        const data = await fetchPage(candidate, 1);
        const rows = getRows(data);
        if (rows.length === 0) continue;
        // Param bị bỏ qua sẽ lẫn bài chuyên mục khác; chỉ nhận khi toàn bộ khớp slug.
        const known = rows.filter((row) => slugOf(row));
        if (known.length === rows.length && known.every((row) => slugOf(row) === slug)) {
          selected = candidate;
          firstData = data;
          break;
        }
      } catch (error) {
        console.warn(`[TechHub] Community filter ${candidate.mode} failed:`, error);
      }
    }

    if (!firstData) {
      selected = feedCandidate;
      firstData = await fetchPage(feedCandidate, 1);
    }

    const articles = [];
    const seenIds = new Set();
    let page = 1;
    let scannedArticles = 0;
    let data = firstData;
    let hasMore = false;
    let reachedStopBefore = false;
    while (page <= MAX_PAGES) {
      const rows = getRows(data);
      scannedArticles += rows.length;
      for (const article of rows) {
        const id = Number(article?.id);
        if (!Number.isInteger(id) || seenIds.has(id)) continue;
        if (slugOf(article) !== slug) continue;
        const articleTime = new Date(
          article?.created_at || article?.published_at || 0
        ).getTime();
        if (Number.isFinite(articleTime)) {
          // sort=new: bài mới hơn khoảng chọn thì bỏ qua và tiếp tục lật trang.
          if (articleTime >= toEnd) continue;
          // Bài cũ hơn tháng bắt đầu thì các trang sau cũng cũ hơn, dừng hẳn.
          if (articleTime < fromStart) {
            reachedStopBefore = true;
            continue;
          }
        }
        seenIds.add(id);
        articles.push(article);
      }
      hasMore = !!data?.next && rows.length > 0 && !reachedStopBefore;
      if (reachedStopBefore || !hasMore || page >= MAX_PAGES) break;
      page += 1;
      data = await fetchPage(selected, page);
    }

    const reportedTotal = Number(firstData?.count);

    return {
      articles,
      communitySlug: slug,
      scannedPages: page,
      scannedArticles,
      months: range.span,
      fromMonth: range.fromMonth,
      toMonth: range.toMonth,
      rangeLabel: range.label,
      stopBefore: range.start.toISOString(),
      stopAfter: range.end.toISOString(),
      reachedWindowEnd: reachedStopBefore,
      hasMore,
      reportedTotal: Number.isFinite(reportedTotal) ? reportedTotal : null,
      filterMode: selected.mode,
    };
  }

  /**
   * Tìm chính xác một bài TechHub theo numeric ID.
   * API danh sách hỗ trợ filter id; luôn đối chiếu lại ID để tránh lấy nhầm kết quả.
   */
  async fetchTechHubArticleById(techhubId) {
    const id = Number(techhubId);
    if (!Number.isInteger(id) || id < 1) throw new Error("ID bài viết không hợp lệ.");
    const url = `https://techhub.fpt.net/api/v1/articles/?id=${encodeURIComponent(id)}&page=1`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Không tra được bài #${id} từ TechHub (HTTP ${response.status}: ${errorText.slice(0, 160)})`
      );
    }
    const data = await response.json();
    const results = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.results?.data)
        ? data.results.data
        : Array.isArray(data)
          ? data
          : [];
    return results.find((article) => Number(article?.id) === id) || null;
  }

  /**
   * Chuyển article của TechHub sang payload bảng posts.
   * Trả về null nếu thiếu dữ liệu bắt buộc để caller tự quyết định bỏ qua hay báo lỗi.
   */
  buildTechHubPostPayload(article) {
    const id = Number(article?.id);
    if (!Number.isInteger(id) || id < 1) return null;
    const username =
      article?.username ||
      article?.author?.username ||
      article?.user?.username ||
      article?.created_by?.username ||
      article?.owner?.username ||
      null;
    const uuid = article?.uuid || article?.article_uuid || null;
    if (!username || !uuid) return null;

    const communitySlug =
      article?.community?.slug || article?.community_slug || article?.communitySlug || null;
    const communityName =
      article?.community?.name ||
      article?.community?.title ||
      article?.community_name ||
      null;
    const customUrl =
      communitySlug && article?.slug
        ? `https://techhub.fpt.net/c/${communitySlug}/${uuid}/${article.slug}`
        : `https://techhub.fpt.net/p/${username}/${uuid}/${article?.slug || ""}`;

    return {
      title: article?.title || `Bài #${id}`,
      status: article?.status || "open",
      techhub_id: id,
      techhub_uuid: uuid,
      username,
      url: customUrl.replace(/\/$/, ""),
      votes_score: Number(article?.votes_score || 0),
      comments_count: Number(article?.comments_count || 0),
      medals_count: extractMedalsCount(article),
      feed_score: Number(article?.feed_score || 0),
      created_at: article?.created_at || new Date().toISOString(),
      published_at: article?.published_at || null,
      community_slug: communitySlug,
      community_name: communityName,
      last_seen_at: new Date().toISOString(),
    };
  }

  /**
   * Gửi upsert vào posts, tự bỏ cột chuyên mục nếu DB chưa chạy migration 010.
   */
  async upsertPostRows(payloads) {
    const body = this.postsCommunityColumnsMissing
      ? payloads.map(({ community_slug, community_name, last_seen_at, ...rest }) => rest)
      : payloads;
    const send = (rows) =>
      fetch(`${this.restUrl}/posts?on_conflict=techhub_id`, {
        method: "POST",
        headers: {
          ...this.getHeaders(),
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(rows),
      });

    let response = await send(body);
    if (!response.ok) {
      const errorText = await response.text();
      const missingCommunityColumn =
        /community_slug|community_name|last_seen_at/.test(errorText) &&
        /schema cache|column/i.test(errorText);
      if (!missingCommunityColumn) {
        throw new Error(`${response.status} ${errorText}`);
      }
      // DB chưa có cột chuyên mục: vẫn lưu phần còn lại để không mất dữ liệu quét.
      this.postsCommunityColumnsMissing = true;
      response = await send(
        payloads.map(({ community_slug, community_name, last_seen_at, ...rest }) => rest)
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [rows];
  }

  /**
   * Lưu metadata bài người khác để draft/job có thể tham chiếu ổn định theo techhub_id.
   */
  async upsertExternalPost(article) {
    const id = Number(article?.id);
    if (!Number.isInteger(id) || id < 1) throw new Error("TechHub trả về ID bài không hợp lệ.");
    const payload = this.buildTechHubPostPayload(article);
    if (!payload) throw new Error(`Bài #${id} thiếu tác giả hoặc UUID.`);
    try {
      const rows = await this.upsertPostRows([payload]);
      return rows[0];
    } catch (error) {
      throw new Error(`Không lưu được bài #${id}: ${error.message}`);
    }
  }

  /**
   * Lưu hàng loạt bài đã quét từ chuyên mục, chia lô để tránh payload quá lớn.
   */
  async upsertScannedPosts(articles) {
    const payloads = (Array.isArray(articles) ? articles : [])
      .map((article) => this.buildTechHubPostPayload(article))
      .filter(Boolean);
    const skipped = (Array.isArray(articles) ? articles.length : 0) - payloads.length;
    let saved = 0;
    const CHUNK_SIZE = 100;
    for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
      const rows = await this.upsertPostRows(payloads.slice(i, i + CHUNK_SIZE));
      saved += rows.length;
    }
    return {
      saved,
      skipped,
      communityColumnsMissing: !!this.postsCommunityColumnsMissing,
    };
  }

  /**
   * Đọc bài chuyên mục đã lưu, dùng thay cho việc gọi lại TechHub.
   */
  async getPostsByCommunity(communitySlug, options = {}) {
    const slug = String(communitySlug || "").trim().toLowerCase();
    if (!slug) return [];
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 500));
    const url =
      `${this.restUrl}/posts?community_slug=eq.${encodeURIComponent(slug)}` +
      `&order=created_at.desc&limit=${limit}`;
    const response = await fetch(url, { headers: this.getHeaders() });
    if (!response.ok) {
      const errorText = await response.text();
      if (/community_slug/.test(errorText)) {
        this.postsCommunityColumnsMissing = true;
        throw new Error(
          "Bảng posts chưa có cột chuyên mục. Hãy chạy migration 010_posts_community.sql."
        );
      }
      throw new Error(`Không đọc được bài chuyên mục: ${response.status} ${errorText}`);
    }
    return await response.json();
  }

  /**
   * Đồng bộ bài viết từ TechHub vào Supabase
   * @param {string} username
   * @returns {Promise<{created: number, updated: number, message: string}>}
   */
  async syncPosts(username, onProgress) {
    console.log("[Supabase] ========== SYNC POSTS ==========");
    console.log("[Supabase] Username:", username);

    try {
      // Quét toàn bộ trang bài viết của user
      const allArticles = [];
      let page = 1;
      let hasNext = true;
      const MAX_PAGES = 50;

      while (hasNext && page <= MAX_PAGES) {
        if (onProgress) onProgress(`Đang tải trang ${page}...`);
        const data = await this.fetchTechHubArticles(username, page);
        const results = data?.results || [];
        allArticles.push(...results);
        hasNext = !!data?.next && results.length > 0;
        page++;
      }

      // Chỉ đối chiếu xóa khi đã tới trang cuối. Nếu chạm giới hạn trang thì
      // danh sách chưa đầy đủ, không thể kết luận các bài còn lại đã bị xóa.
      let removed = 0;
      if (!hasNext) {
        if (onProgress) onProgress("Đang đối chiếu bài đã xóa...");
        removed = await this.deleteOwnPostsMissingFromTechHub(
          username,
          allArticles.map((article) => article.id)
        );
      }

      // Bài chưa publish: tạo mới / cập nhật thống kê.
      // Bài đã publish: chỉ cập nhật published_at + status nếu đã có trong DB,
      // để danh sách (published_at is null) tự loại chúng ra.
      const unpublished = allArticles.filter((a) => !a.published_at);
      const published = allArticles.filter((a) => !!a.published_at);
      let created = 0;
      let updated = 0;
      let markedPublished = 0;
      const total = unpublished.length;

      for (let i = 0; i < total; i++) {
        const article = unpublished[i];

        if (onProgress) {
          onProgress(`Đang đồng bộ bài ${i + 1}/${total}...`);
        }

        const customUrl = article.community && article.community.slug
          ? `https://techhub.fpt.net/c/${article.community.slug}/${article.uuid}/${article.slug}`
          : `https://techhub.fpt.net/p/${username}/${article.uuid}/${article.slug}`;

        const existingPost = await this.findPostByTechhubId(article.id);

        const medalsCount = extractMedalsCount(article);
        if (existingPost) {
          await this.updatePost(article.id, {
            votesScore: article.votes_score,
            commentsCount: article.comments_count,
            medalsCount,
            feedScore: article.feed_score,
            publishedAt: article.published_at || null,
            status: article.status
          });
          updated++;
          console.log(`[Supabase] Updated post: ${article.title}`);
        } else {
          await this.createPost({
            title: article.title,
            status: article.status,
            techhubId: article.id,
            techhubUuid: article.uuid,
            username: username,
            url: customUrl,
            votesScore: article.votes_score,
            commentsCount: article.comments_count,
            medalsCount,
            feedScore: article.feed_score,
            createdAt: article.created_at,
            publishedAt: article.published_at,
          });
          created++;
          console.log(`[Supabase] Created post: ${article.title}`);
        }
      }

      if (onProgress && published.length) {
        onProgress(`Đang đánh dấu ${published.length} bài đã publish...`);
      }
      for (const article of published) {
        const existingPost = await this.findPostByTechhubId(article.id);
        if (!existingPost) continue;
        const medalsCount = extractMedalsCount(article);
        await this.updatePost(article.id, {
          votesScore: article.votes_score,
          commentsCount: article.comments_count,
          medalsCount,
          feedScore: article.feed_score,
          publishedAt: article.published_at,
          status: article.status,
        });
        markedPublished++;
        console.log(`[Supabase] Marked published: ${article.title}`);
      }

      return {
        created,
        updated,
        removed,
        skipped: published.length,
        markedPublished,
        message:
          `Đã quét ${allArticles.length} bài · ${created} mới · ${updated} cập nhật` +
          ` · xóa ${removed} bài không còn trên TechHub` +
          ` · đánh dấu publish ${markedPublished}/${published.length}`,
      };
    } catch (error) {
      console.error("[Supabase] Error syncing posts:", error);
      throw error;
    }
  }

  // ==================== INTERACTION METHODS ====================

  /**
   * Lấy danh sách template comment
   * @param {{ kind?: 'comment'|'reply' }} [options]
   * @returns {Promise<Array>}
   */
  async getCommentTemplates(options = {}) {
    try {
      const kind = options.kind || "comment";
      let url = `${this.restUrl}/comment_templates?is_active=eq.true&kind=eq.${encodeURIComponent(kind)}`;
      let response = await fetch(url, { method: "GET", headers: this.getHeaders() });
      if (!response.ok) throw new Error("Failed to fetch templates");
      let rows = await response.json();

      // Fallback nếu DB chưa có cột kind (schema cũ)
      if ((!rows || rows.length === 0) && kind === "comment") {
        url = `${this.restUrl}/comment_templates?is_active=eq.true`;
        response = await fetch(url, { method: "GET", headers: this.getHeaders() });
        if (response.ok) rows = await response.json();
      }
      return rows || [];
    } catch (error) {
      console.error("[Supabase] Error:", error);
      return [];
    }
  }

  /**
   * Lấy posts theo username với filter tùy chọn
   * @param {string} username
   * @param {{ status?: string, limit?: number }} [options]
   */
  async getOwnPosts(username, options = {}) {
    const limit = options.limit || 100;
    let url = `${this.restUrl}/posts?username=eq.${encodeURIComponent(username)}&order=created_at.desc&limit=${limit}`;
    if (options.status) {
      url += `&status=eq.${encodeURIComponent(options.status)}`;
    }
    if (options.includePublished !== true) {
      url += `&published_at=is.null`;
    }
    const response = await fetch(url, { headers: this.getHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch own posts: ${response.status}`);
    return await response.json();
  }

  /**
   * Lấy parent_comment_id đã reply của user (dedup)
   * @param {string} username
   * @param {number[]} parentCommentIds
   */
  async getRepliedParentCommentIds(username, parentCommentIds) {
    if (!parentCommentIds || parentCommentIds.length === 0) return new Set();
    const ids = parentCommentIds.filter((id) => Number.isFinite(Number(id))).join(",");
    if (!ids) return new Set();
    const url =
      `${this.restUrl}/interactions?username=eq.${encodeURIComponent(username)}` +
      `&interaction_type=eq.reply&parent_comment_id=in.(${ids})&select=parent_comment_id`;
    const response = await fetch(url, { headers: this.getHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch replied comments: ${response.status}`);
    const rows = await response.json();
    return new Set(rows.map((r) => Number(r.parent_comment_id)));
  }

  async getDiscussedSourceCommentIds(username, commentIds) {
    if (!commentIds || commentIds.length === 0) return new Set();
    const ids = commentIds.filter((id) => Number.isFinite(Number(id))).join(",");
    if (!ids) return new Set();
    const url =
      `${this.restUrl}/interactions?username=eq.${encodeURIComponent(username)}` +
      `&interaction_type=eq.discussion&parent_comment_id=in.(${ids})&select=parent_comment_id`;
    const response = await fetch(url, { headers: this.getHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch discussed comments: ${response.status}`);
    const rows = await response.json();
    return new Set(rows.map((r) => Number(r.parent_comment_id)));
  }

  /**
   * Đếm số interaction theo từng bài để job có thể tiếp tục tới đúng mục tiêu.
   */
  async getInteractionCountsByPost(username, interactionType, techhubIds) {
    if (!techhubIds || techhubIds.length === 0) return new Map();
    const counts = new Map();
    const ids = techhubIds
      .map(Number)
      .filter((id) => Number.isFinite(id));
    await Promise.all(
      ids.map(async (id) => {
        const url =
          `${this.restUrl}/interactions?username=eq.${encodeURIComponent(username)}` +
          `&interaction_type=eq.${encodeURIComponent(interactionType)}` +
          `&techhub_id=eq.${id}&select=id`;
        const headers = {
          ...this.getHeaders(),
          Prefer: "count=exact",
          Range: "0-0",
        };
        const response = await fetch(url, { headers });
        if (!response.ok) {
          throw new Error(`Failed to fetch interaction count: ${response.status}`);
        }
        const total = Number((response.headers.get("content-range") || "").split("/")[1]);
        counts.set(id, Number.isFinite(total) ? total : 0);
      })
    );
    return counts;
  }

  /**
   * Lấy danh sách bài viết chưa tương tác
   * @param {string} username 
   * @param {number} limit 
   * @returns {Promise<Array>}
   */
  async getUninteractedPosts(username, limit = 5) {
    try {
      // Get recent posts not by this user and status is open
      const postsUrl = `${this.restUrl}/posts?username=neq.${encodeURIComponent(username)}&status=eq.open&order=created_at.desc&limit=50`;
      const postsRes = await fetch(postsUrl, { headers: this.getHeaders() });
      if (!postsRes.ok) throw new Error(`Failed to fetch posts: ${postsRes.status}`);
      const posts = await postsRes.json();

      if (posts.length === 0) return [];

      // Get locked users
      const lockedUrl = `${this.restUrl}/${SUPABASE_CONFIG.tableName}?is_locked=eq.true&select=username`;
      const lockedRes = await fetch(lockedUrl, { headers: this.getHeaders() });
      let lockedUsernames = new Set();
      if (lockedRes.ok) {
        const lockedUsers = await lockedRes.json();
        lockedUsernames = new Set(lockedUsers.map(u => u.username));
      } else {
        console.warn("[Supabase] Failed to fetch locked users, skipping lock filter.");
      }

      // Get users with >= 2 open posts and feed_score >= 6
      const skipUrl = `${this.restUrl}/posts?status=eq.open&feed_score=gte.6&select=username`;
      const skipRes = await fetch(skipUrl, { headers: this.getHeaders() });
      const skipUsernames = new Set();
      if (skipRes.ok) {
        const topPosts = await skipRes.json();
        const userCounts = {};
        for (const p of topPosts) {
          userCounts[p.username] = (userCounts[p.username] || 0) + 1;
          if (userCounts[p.username] >= 2) {
            skipUsernames.add(p.username);
          }
        }
      } else {
        console.warn("[Supabase] Failed to fetch top posts, skipping >=2 filter.");
      }

      // Get user interactions
      const postIds = posts.map(p => p.techhub_id).join(',');
      const interactionsUrl = `${this.restUrl}/interactions?username=eq.${encodeURIComponent(username)}&techhub_id=in.(${postIds})`;
      const intRes = await fetch(interactionsUrl, { headers: this.getHeaders() });
      if (!intRes.ok) throw new Error(`Failed to fetch interactions: ${intRes.status}`);
      const interactions = await intRes.json();

      // Filter
      const interactedIds = new Set(interactions.map(i => i.techhub_id));
      const uninteracted = posts.filter(p => !interactedIds.has(p.techhub_id) && !lockedUsernames.has(p.username) && !skipUsernames.has(p.username));
      
      const selectedPosts = [];
      const seenUsers = new Set();
      
      // Ưu tiên mỗi tác giả 1 bài
      for (const p of uninteracted) {
        if (selectedPosts.length >= limit) break;
        if (!seenUsers.has(p.username)) {
          selectedPosts.push(p);
          seenUsers.add(p.username);
        }
      }
      
      // Nếu chưa đủ limit bài thì lấy thêm các bài còn lại
      if (selectedPosts.length < limit) {
        const selectedIds = new Set(selectedPosts.map(p => p.techhub_id));
        for (const p of uninteracted) {
          if (selectedPosts.length >= limit) break;
          if (!selectedIds.has(p.techhub_id)) {
            selectedPosts.push(p);
            selectedIds.add(p.techhub_id);
          }
        }
      }
      
      return selectedPosts;
    } catch (error) {
      console.error("[Supabase] Error:", error);
      return [];
    }
  }

  /**
   * Ghi nhận tương tác của user với bài viết
   * @param {string} username 
   * @param {number} techhubId 
   * @param {string} type 
   * @param {number|null} [parentCommentId]
   */
  async recordInteraction(username, techhubId, type, parentCommentId = null) {
    const payload = { username, techhub_id: techhubId, interaction_type: type };
    if (parentCommentId != null) {
      payload.parent_comment_id = parentCommentId;
    }
    const response = await fetch(`${this.restUrl}/interactions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      // 409 = đã ghi rồi (unique reply) → coi như trùng, không phải lỗi.
      if (response.status === 409) {
        return { duplicate: true };
      }
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Failed to record interaction: ${response.status}${errText ? ` ${errText.slice(0, 200)}` : ""}`
      );
    }
    const data = await response.json().catch(() => null);
    return Array.isArray(data) ? data[0] || null : data;
  }

  /**
   * Lưu draft reply do AI gen — mỗi lần gen: xóa draft cũ cùng parent_comment rồi tạo mới
   * (vì chuỗi hội thoại có thể đổi: A → B → A ...)
   */
  async saveReplyDraft(draft) {
    const username = draft.username;
    const parentCommentId = draft.parentCommentId;
    if (username && parentCommentId != null) {
      const delUrl =
        `${this.restUrl}/reply_drafts?username=eq.${encodeURIComponent(username)}` +
        `&parent_comment_id=eq.${encodeURIComponent(parentCommentId)}`;
      await fetch(delUrl, { method: "DELETE", headers: this.getHeaders() });
    }

    const payload = {
      username,
      techhub_id: draft.techhubId,
      parent_comment_id: parentCommentId,
      comment_author: draft.commentAuthor || null,
      comment_body: draft.commentBody || null,
      reply_body: draft.replyBody,
      source: draft.source || "nvidia",
      model: draft.model || null,
      status: draft.status || "used",
    };
    const response = await fetch(`${this.restUrl}/reply_drafts`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("[Supabase] Error saving reply draft:", errText);
      throw new Error(`Supabase ${response.status}: ${errText}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  }

  /**
   * Lấy kho mẫu reply của một bài, mẫu cũ trước để đăng đúng thứ tự.
   */
  async getReplyDrafts(username, techhubId, status = null) {
    const params = new URLSearchParams({
      username: `eq.${username}`,
      techhub_id: `eq.${techhubId}`,
      select: "*",
      order: "created_at.asc",
    });
    if (status) params.set("status", `eq.${status}`);

    const response = await fetch(`${this.restUrl}/reply_drafts?${params}`, {
      method: "GET",
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to load reply drafts: ${response.status} ${errText}`);
    }
    return response.json();
  }

  async updateReplyDraftBody(username, id, replyBody) {
    const url =
      `${this.restUrl}/reply_drafts?id=eq.${encodeURIComponent(id)}` +
      `&username=eq.${encodeURIComponent(username)}&status=eq.pending`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({ reply_body: replyBody }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to update reply draft: ${response.status} ${errText}`);
    }
    const data = await response.json();
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) throw new Error("Mẫu không còn ở trạng thái chưa dùng.");
    return updated;
  }

  async updateReplyDraftStatus(id, status) {
    const response = await fetch(`${this.restUrl}/reply_drafts?id=eq.${id}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to update reply draft: ${response.status} ${errText}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  }

  /** Chỉ xóa mẫu reply đang pending của đúng user. */
  async deleteReplyDraft(username, id) {
    const url =
      `${this.restUrl}/reply_drafts?id=eq.${encodeURIComponent(id)}` +
      `&username=eq.${encodeURIComponent(username)}&status=eq.pending`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to delete reply draft: ${response.status} ${errText}`);
    }
    const data = await response.json();
    const deleted = Array.isArray(data) ? data[0] : data;
    if (!deleted) throw new Error("Mẫu không còn ở trạng thái chưa dùng.");
    return deleted;
  }

  /** Xóa toàn bộ mẫu reply pending của một bài. */
  async deletePendingReplyDrafts(username, techhubId) {
    const url =
      `${this.restUrl}/reply_drafts?username=eq.${encodeURIComponent(username)}` +
      `&techhub_id=eq.${encodeURIComponent(techhubId)}&status=eq.pending`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to delete pending reply drafts: ${response.status} ${errText}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : data ? [data] : [];
  }

  /**
   * Lưu draft thảo luận. Comment gốc không có source_comment_id nên giữ từng bản gen.
   */
  async saveDiscussionDraft(draft) {
    const username = draft.username;
    const sourceCommentId = draft.sourceCommentId;
    if (username && sourceCommentId != null) {
      const delUrl =
        `${this.restUrl}/discussion_drafts?username=eq.${encodeURIComponent(username)}` +
        `&source_comment_id=eq.${encodeURIComponent(sourceCommentId)}`;
      await fetch(delUrl, { method: "DELETE", headers: this.getHeaders() });
    }

    const response = await fetch(`${this.restUrl}/discussion_drafts`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        username,
        techhub_id: draft.techhubId,
        source_comment_id: sourceCommentId ?? null,
        source_comment_body: draft.sourceCommentBody || null,
        discussion_body: draft.discussionBody,
        model: draft.model || null,
        status: draft.status || "used",
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("[Supabase] Error saving discussion draft:", errText);
      throw new Error(`Supabase ${response.status}: ${errText}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  }

  /**
   * Lấy kho mẫu thảo luận của một bài, mẫu cũ trước để đăng đúng thứ tự.
   */
  async getDiscussionDrafts(username, techhubId, status = null) {
    const params = new URLSearchParams({
      username: `eq.${username}`,
      techhub_id: `eq.${techhubId}`,
      select: "*",
      order: "created_at.asc",
    });
    if (status) params.set("status", `eq.${status}`);

    const response = await fetch(`${this.restUrl}/discussion_drafts?${params}`, {
      method: "GET",
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to load discussion drafts: ${response.status} ${errText}`);
    }
    return response.json();
  }

  async updateDiscussionDraftBody(username, id, discussionBody) {
    const url =
      `${this.restUrl}/discussion_drafts?id=eq.${encodeURIComponent(id)}` +
      `&username=eq.${encodeURIComponent(username)}&status=eq.pending`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({ discussion_body: discussionBody }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to update discussion draft: ${response.status} ${errText}`);
    }
    const data = await response.json();
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) throw new Error("Mẫu không còn ở trạng thái chưa dùng.");
    return updated;
  }

  /**
   * Đổi trạng thái mẫu sau khi đã đăng thành công.
   */
  async updateDiscussionDraftStatus(id, status) {
    const response = await fetch(`${this.restUrl}/discussion_drafts?id=eq.${id}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to update discussion draft: ${response.status} ${errText}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  }

  /** Chỉ xóa mẫu thảo luận đang pending của đúng user. */
  async deleteDiscussionDraft(username, id) {
    const url =
      `${this.restUrl}/discussion_drafts?id=eq.${encodeURIComponent(id)}` +
      `&username=eq.${encodeURIComponent(username)}&status=eq.pending`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to delete discussion draft: ${response.status} ${errText}`);
    }
    const data = await response.json();
    const deleted = Array.isArray(data) ? data[0] : data;
    if (!deleted) throw new Error("Mẫu không còn ở trạng thái chưa dùng.");
    return deleted;
  }

  /** Xóa toàn bộ mẫu thảo luận pending của một bài. */
  async deletePendingDiscussionDrafts(username, techhubId) {
    const url =
      `${this.restUrl}/discussion_drafts?username=eq.${encodeURIComponent(username)}` +
      `&techhub_id=eq.${encodeURIComponent(techhubId)}&status=eq.pending`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Failed to delete pending discussion drafts: ${response.status} ${errText}`
      );
    }
    const data = await response.json();
    return Array.isArray(data) ? data : data ? [data] : [];
  }
}

// Tạo instance của Supabase client
const supabase = new SupabaseClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
