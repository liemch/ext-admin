// NVIDIA NIM API client (OpenAI-compatible chat completions)
// Docs: https://docs.api.nvidia.com / https://integrate.api.nvidia.com/v1

const NVIDIA_DEFAULTS = {
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  maxTokens: 256,
  temperature: 1,
  topP: 0.95,
  enableThinking: false,
};

function getNvidiaConfig() {
  const cfg = typeof NVIDIA_CONFIG !== "undefined" ? NVIDIA_CONFIG : {};
  return {
    apiKey: cfg.apiKey || "",
    baseUrl: (cfg.baseUrl || NVIDIA_DEFAULTS.baseUrl).replace(/\/$/, ""),
    model: cfg.model || NVIDIA_DEFAULTS.model,
    maxTokens: cfg.maxTokens || NVIDIA_DEFAULTS.maxTokens,
    temperature: cfg.temperature ?? NVIDIA_DEFAULTS.temperature,
    topP: cfg.topP ?? NVIDIA_DEFAULTS.topP,
    enableThinking: cfg.enableThinking ?? NVIDIA_DEFAULTS.enableThinking,
  };
}

function stripHtml(html) {
  if (Array.isArray(html)) {
    return html.map(stripHtml).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (html && typeof html === "object") {
    if (typeof html.text === "string") return stripHtml(html.text);
    const nested =
      html.content ||
      html.children ||
      html.blocks ||
      html.body ||
      Object.values(html);
    return stripHtml(nested);
  }
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAiReplyText(text) {
  let out = String(text || "").trim();
  out = out.replace(/^["'«»]|["'«»]$/g, "").trim();
  // Bỏ prefix kiểu "Reply:" / "Trả lời:"
  out = out.replace(/^(reply|trả lời|phan hoi|phản hồi)\s*[:\-–]\s*/i, "").trim();
  if (out.length > 400) out = out.slice(0, 397).trim() + "...";
  return out;
}

async function nvidiaChat(messages, options = {}) {
  const cfg = getNvidiaConfig();
  if (!cfg.apiKey || cfg.apiKey === "YOUR_NVIDIA_API_KEY") {
    throw new Error("Chưa cấu hình NVIDIA_CONFIG.apiKey trong config.js");
  }

  const enableThinking = options.enableThinking ?? cfg.enableThinking;
  const payload = {
    model: cfg.model,
    messages,
    temperature: options.temperature ?? cfg.temperature,
    top_p: options.topP ?? cfg.topP,
    max_tokens: options.maxTokens || cfg.maxTokens,
    stream: false,
    chat_template_kwargs: { enable_thinking: !!enableThinking },
  };

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`NVIDIA AI HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message || {};
  const content = message.content || message.reasoning_content || "";
  const cleaned = cleanAiReplyText(content);
  if (!cleaned) throw new Error("NVIDIA AI trả về nội dung rỗng.");
  return cleaned;
}

/**
 * Sinh nội dung reply từ comment bằng NVIDIA AI
 * @param {{ postTitle?: string, articleBody?: string, commentAuthor?: string, commentBody: string, threadText?: string, username?: string }} input
 * @returns {Promise<string>}
 */
async function nvidiaGenerateReply(input) {
  const commentBody = stripHtml(input.commentBody || "").slice(0, 1200);
  const articleBody = stripHtml(input.articleBody || "").slice(0, 5000);
  const threadText = String(input.threadText || "").trim().slice(0, 3500);
  const isSelfComment = !!input.isSelfComment;
  if (!commentBody) {
    throw new Error("Comment không có nội dung để gen AI.");
  }

  const systemPrompt =
    "Bạn là tác giả bài viết trên TechHub (cộng đồng nội bộ FPT). " +
    "Hãy trả lời dựa trên cả chuỗi hội thoại (A nói → B trả lời → A hỏi tiếp...), " +
    "không chỉ nhìn câu cuối. " +
    (isSelfComment
      ? "Comment cuối chuỗi là của CHÍNH BẠN, nên đây là lượt bạn nói thêm: " +
        "bổ sung ý mới, ví dụ thực tế hoặc câu hỏi mở cho người đọc. " +
        "TUYỆT ĐỐI không tự cảm ơn, không tự khen, không lặp lại ý đã nói. "
      : "Trả lời lịch sự, ngắn gọn, tự nhiên. ") +
    "Viết tiếng Việt, không dùng markdown, không dùng hashtag, không xưng hô quá formal. " +
    "Chỉ trả về đúng nội dung câu trả lời, không giải thích thêm.";

  const lastLine = isSelfComment
    ? `Comment cuối chuỗi (của chính bạn) cần nói tiếp:\n${commentBody}\n\n`
    : `Comment cần trả lời gần nhất của @${input.commentAuthor || "user"}:\n${commentBody}\n\n`;

  const userPrompt =
    `Bài viết: ${input.postTitle || "(không tiêu đề)"}\n` +
    `Nội dung bài viết:\n${articleBody || "(không lấy được nội dung)"}\n\n` +
    `Chuỗi hội thoại hiện tại:\n${threadText || `@${input.commentAuthor || "user"}: ${commentBody}`}\n\n` +
    lastLine +
    (isSelfComment
      ? `Hãy viết 1 comment tiếp theo (1-2 câu) với tư cách tác giả @${
          input.username || "author"
        }, nối tiếp chính mình, không cảm ơn.`
      : `Hãy viết 1 câu trả lời ngắn (1-2 câu) với tư cách tác giả @${
          input.username || "author"
        }, tiếp nối đúng ngữ cảnh chuỗi trên.`);

  return nvidiaChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
}

/**
 * Phát hiện AI viết kiểu cảm ơn/khen bài — sai vai khi tự thảo luận bài của mình.
 */
function looksLikeThanksOrPraise(text) {
  const normalized = String(text || "").toLowerCase();
  return /(cảm ơn|cam on|thank|biết ơn|bài viết hay|bài rất hay|hay quá|chia sẻ hữu ích|hữu ích quá)/.test(
    normalized
  );
}

/**
 * Sinh comment gốc để tác giả tự bổ sung/thảo luận dưới bài của mình.
 */
async function nvidiaGenerateDiscussion(input) {
  const articleBody = stripHtml(input.articleBody || "").slice(0, 5000);
  const previousDiscussionText = stripHtml(
    input.previousDiscussionText || ""
  ).slice(0, 3500);
  if (!articleBody) throw new Error("Không lấy được nội dung bài để thảo luận.");

  const systemPrompt =
    `Bạn CHÍNH LÀ tác giả bài viết (@${input.username || "author"}) trên TechHub. ` +
    "Bạn đang đăng một COMMENT GỐC trực tiếp dưới bài của mình, không reply bất kỳ ai. " +
    "Mỗi comment phải bổ sung một góc nhìn mới: chi tiết thực tế, ví dụ, lưu ý triển khai, " +
    "kinh nghiệm hoặc câu hỏi mở liên quan chặt chẽ tới nội dung bài. " +
    "TUYỆT ĐỐI không cảm ơn, không khen bài viết, không giả vờ là độc giả, " +
    "không nhắc rằng đây là comment tự động và không lặp lại các comment trước. " +
    "Viết tiếng Việt tự nhiên, 1-3 câu, không markdown, không hashtag, không sáo rỗng, " +
    "không mở đầu bằng lời chào. Chỉ trả về đúng nội dung bình luận.";

  const userPrompt =
    `Tiêu đề: ${input.postTitle || "(không tiêu đề)"}\n` +
    `Nội dung bài:\n${articleBody}\n\n` +
    `Các comment gốc trước đây của tác giả (không được lặp ý):\n${
      previousDiscussionText || "(chưa có)"
    }\n\n` +
    `Đây là comment tự thảo luận số ${input.discussionNumber || 1}/${
      input.discussionTarget || "?"
    }. Hãy viết một comment gốc mới dưới bài với tư cách tác giả.`;

  const options = { maxTokens: 240, temperature: 0.75 };
  const first = await nvidiaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options
  );

  if (!looksLikeThanksOrPraise(first)) return first;

  // Gen lại một lần với ràng buộc chặt hơn nếu AI vẫn đi cảm ơn/khen bài của chính mình
  const retry = await nvidiaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          "Câu trên bị sai vai: bạn là tác giả nên không được cảm ơn hay khen bài của chính mình. " +
          "Viết lại một bình luận khác, chỉ bổ sung nội dung/ví dụ/câu hỏi mở, tuyệt đối không có từ cảm ơn hay lời khen bài.",
      },
    ],
    options
  );

  return looksLikeThanksOrPraise(retry) ? retry.replace(/^[^.!?]*(cảm ơn|thank)[^.!?]*[.!?]\s*/i, "").trim() || retry : retry;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    nvidiaGenerateReply,
    nvidiaGenerateDiscussion,
    getNvidiaConfig,
    cleanAiReplyText,
    stripHtml,
  };
}
