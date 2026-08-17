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
 * @property {number} feed_score
 * @property {string} created_at
 * @property {string} published_at
 */

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
   * Đồng bộ bài viết từ TechHub vào Supabase
   * @param {string} username
   * @returns {Promise<{created: number, updated: number, message: string}>}
   */
  async syncPosts(username, onProgress) {
    console.log("[Supabase] ========== SYNC POSTS ==========");
    console.log("[Supabase] Username:", username);

    try {
      // Lấy bài viết từ TechHub
      const techHubData = await this.fetchTechHubArticles(username);
      let techHubArticles = techHubData.results;

      if (!techHubArticles || techHubArticles.length === 0) {
        return {
          created: 0,
          updated: 0,
          message: "Không tìm thấy bài viết nào trên TechHub",
        };
      }
      
      // Chỉ lấy 10 bài viết mới nhất
      techHubArticles = techHubArticles.slice(0, 10);

      let created = 0;
      let updated = 0;
      let total = techHubArticles.length;

      // Đồng bộ từng bài viết
      for (let i = 0; i < total; i++) {
        const article = techHubArticles[i];
        
        if (onProgress) {
           onProgress(`Đang đồng bộ bài ${i + 1}/${total}...`);
        }

        const customUrl = article.community && article.community.slug
          ? `https://techhub.fpt.net/c/${article.community.slug}/${article.uuid}/${article.slug}`
          : `https://techhub.fpt.net/p/${username}/${article.uuid}/${article.slug}`;
        
        const existingPost = await this.findPostByTechhubId(article.id);

        if (existingPost) {
          // Cập nhật bài viết
          await this.updatePost(article.id, {
            votesScore: article.votes_score,
            commentsCount: article.comments_count,
            feedScore: article.feed_score,
            status: article.status
          });
          updated++;
          console.log(`[Supabase] Updated post: ${article.title}`);
        } else {
          // Tạo mới bài viết/ini
          await this.createPost({
            title: article.title,
            status: article.status,
            techhubId: article.id,
            techhubUuid: article.uuid,
            username: username,
            url: customUrl,
            votesScore: article.votes_score,
            commentsCount: article.comments_count,
            feedScore: article.feed_score,
            createdAt: article.created_at,
            publishedAt: article.published_at,
          });
          created++;
          console.log(`[Supabase] Created post: ${article.title}`);
        }
      }

      return {
        created,
        updated,
        message: `Đã đồng bộ: ${created} bài mới, ${updated} bài cập nhật`,
      };
    } catch (error) {
      console.error("[Supabase] Error syncing posts:", error);
      throw error;
    }
  }

  // ==================== INTERACTION METHODS ====================

  /**
   * Lấy danh sách template comment
   * @returns {Promise<Array>}
   */
  async getCommentTemplates() {
    try {
      const url = `${this.restUrl}/comment_templates?is_active=eq.true`;
      const response = await fetch(url, { method: "GET", headers: this.getHeaders() });
      if (!response.ok) throw new Error("Failed to fetch templates");
      return await response.json();
    } catch (error) {
      console.error("[Supabase] Error:", error);
      return [];
    }
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
   */
  async recordInteraction(username, techhubId, type) {
    try {
      const payload = { username, techhub_id: techhubId, interaction_type: type };
      const response = await fetch(`${this.restUrl}/interactions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Failed to record interaction: ${response.status}`);
    } catch (error) {
      console.error("[Supabase] Error recording interaction:", error);
    }
  }
}

// Tạo instance của Supabase client
const supabase = new SupabaseClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
