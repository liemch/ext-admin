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

// Chữ Hán/Nhật/Hàn lọt vào bài tiếng Việt là dấu hiệu model bị leak ngôn ngữ.
const FOREIGN_SCRIPT_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

const SENTENCE_END_RE = /[.!?…]/;

function hasForeignScript(text) {
  return FOREIGN_SCRIPT_RE.test(String(text || ""));
}

/**
 * Bỏ đoạn câu dở dang ở cuối (khi model bị cắt vì hết token) để không mất chữ giữa câu.
 */
function dropTrailingFragment(text) {
  const out = String(text || "").trim();
  if (!out || SENTENCE_END_RE.test(out.slice(-1))) return out;
  const lastEnd = Math.max(
    out.lastIndexOf("."),
    out.lastIndexOf("!"),
    out.lastIndexOf("?"),
    out.lastIndexOf("…")
  );
  if (lastEnd < 0) return out;
  const trimmed = out.slice(0, lastEnd + 1).trim();
  return trimmed || out;
}

/**
 * Cắt về đúng ranh giới câu thay vì cắt cứng giữa từ.
 */
function trimToSentenceLimit(text, maxLength) {
  const out = String(text || "").trim();
  if (out.length <= maxLength) return out;
  const slice = out.slice(0, maxLength);
  const lastEnd = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
    slice.lastIndexOf("…")
  );
  if (lastEnd >= Math.floor(maxLength * 0.4)) {
    return slice.slice(0, lastEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

function cleanAiReplyText(text, options = {}) {
  const maxLength = options.maxLength || 400;
  let out = String(text || "").trim();
  out = out.replace(/^["'«»]|["'«»]$/g, "").trim();
  // Bỏ prefix kiểu "Reply:" / "Trả lời:"
  out = out.replace(/^(reply|trả lời|phan hoi|phản hồi)\s*[:\-–]\s*/i, "").trim();
  return trimToSentenceLimit(out, maxLength);
}

/**
 * Lấy "vân tay" mở đầu để phát hiện các mẫu bị mở bài giống nhau.
 */
function getOpeningKey(text, wordCount = 5) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, wordCount)
    .join(" ");
}

function sharesOpeningWith(text, previousTexts = []) {
  const key = getOpeningKey(text, 4);
  if (!key) return false;
  return previousTexts.some((prev) => getOpeningKey(prev, 4) === key);
}

function postChatCompletion(cfg, payload) {
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
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
  if (options.presencePenalty) payload.presence_penalty = options.presencePenalty;
  if (options.frequencyPenalty) payload.frequency_penalty = options.frequencyPenalty;

  let response = await postChatCompletion(cfg, payload);
  // Không phải model nào trên NIM cũng nhận penalty, bỏ ra thử lại thay vì để job chết.
  if (
    response.status === 400 &&
    (payload.presence_penalty || payload.frequency_penalty)
  ) {
    delete payload.presence_penalty;
    delete payload.frequency_penalty;
    response = await postChatCompletion(cfg, payload);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`NVIDIA AI HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  let content = message.content || message.reasoning_content || "";
  if (choice.finish_reason === "length") {
    content = dropTrailingFragment(content);
  }
  const cleaned = cleanAiReplyText(content, { maxLength: options.maxLength });
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

// Mỗi mẫu đi theo một góc tiếp cận khác nhau để không bị mở bài rập khuôn.
const DISCUSSION_ANGLES = [
  "Kể một chi tiết/trải nghiệm cụ thể của riêng bạn liên quan tới bài, có bối cảnh rõ ràng.",
  "Nêu một mặt trái hoặc điều ít ai nói tới của chủ đề, giọng điềm tĩnh.",
  "Đặt một câu hỏi mở cho người đọc, hỏi về cách họ từng xử lý tình huống tương tự.",
  "Bổ sung một lưu ý thực tế, kinh nghiệm rút ra hoặc cách áp dụng cụ thể.",
  "So sánh giữa lúc đó và bây giờ, chỉ ra điều đã thay đổi.",
  "Mở rộng sang một tình huống liên quan mà bài chưa nhắc tới.",
];

/**
 * Sinh comment gốc để tác giả tự bổ sung/thảo luận dưới bài của mình.
 */
async function nvidiaGenerateDiscussion(input) {
  const articleBody = stripHtml(input.articleBody || "").slice(0, 5000);
  const previousBodies = (
    Array.isArray(input.previousBodies) ? input.previousBodies : []
  )
    .map((body) => stripHtml(body))
    .filter(Boolean)
    .slice(-12);
  const previousDiscussionText = (
    previousBodies.length
      ? previousBodies.join("\n")
      : stripHtml(input.previousDiscussionText || "")
  ).slice(0, 3500);
  if (!articleBody) throw new Error("Không lấy được nội dung bài để thảo luận.");

  const bannedOpenings = [
    ...new Set(previousBodies.map((body) => getOpeningKey(body, 6)).filter(Boolean)),
  ].slice(0, 12);
  const angle =
    DISCUSSION_ANGLES[
      (Math.max(1, Number(input.discussionNumber) || 1) - 1) % DISCUSSION_ANGLES.length
    ];

  const systemPrompt =
    `Bạn CHÍNH LÀ tác giả bài viết (@${input.username || "author"}) trên TechHub. ` +
    "Bạn đang đăng một COMMENT GỐC trực tiếp dưới bài của mình, không reply bất kỳ ai. " +
    "Mỗi comment phải bổ sung một góc nhìn mới: chi tiết thực tế, ví dụ, lưu ý triển khai, " +
    "kinh nghiệm hoặc câu hỏi mở liên quan chặt chẽ tới nội dung bài. " +
    "TUYỆT ĐỐI không cảm ơn, không khen bài viết, không giả vờ là độc giả, " +
    "không nhắc rằng đây là comment tự động và không lặp lại các comment trước. " +
    "CHỈ dùng tiếng Việt phổ thông, tuyệt đối không chèn chữ Trung/Nhật/Hàn hay từ tiếng Anh, " +
    "không dùng từ lạ hoặc ghép từ sai nghĩa. " +
    "Viết 1-3 câu hoàn chỉnh, luôn kết thúc bằng dấu câu, không viết dở dang. " +
    "Không markdown, không hashtag, không sáo rỗng, không mở đầu bằng lời chào. " +
    "Chỉ trả về đúng nội dung bình luận.";

  const userPrompt =
    `Tiêu đề: ${input.postTitle || "(không tiêu đề)"}\n` +
    `Nội dung bài:\n${articleBody}\n\n` +
    `Các comment gốc trước đây của tác giả (không được lặp ý):\n${
      previousDiscussionText || "(chưa có)"
    }\n\n` +
    (bannedOpenings.length
      ? `Các cách mở đầu ĐÃ DÙNG, phải mở đầu khác hoàn toàn:\n- ${bannedOpenings.join(
          "\n- "
        )}\n\n`
      : "") +
    `Góc tiếp cận cho comment này: ${angle}\n\n` +
    `Đây là comment tự thảo luận số ${input.discussionNumber || 1}/${
      input.discussionTarget || "?"
    }. Hãy viết một comment gốc mới dưới bài với tư cách tác giả.`;

  const options = {
    maxTokens: 420,
    maxLength: 500,
    temperature: 0.95,
    topP: 0.92,
    presencePenalty: 0.6,
    frequencyPenalty: 0.5,
  };
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const first = await nvidiaChat(messages, options);

  const problems = [];
  if (looksLikeThanksOrPraise(first)) {
    problems.push(
      "bị sai vai vì bạn là tác giả nên không được cảm ơn hay khen bài của chính mình"
    );
  }
  if (hasForeignScript(first)) {
    problems.push("có lẫn chữ nước ngoài, phải viết thuần tiếng Việt");
  }
  if (sharesOpeningWith(first, previousBodies)) {
    problems.push("mở đầu giống một comment đã có, phải mở đầu bằng cách khác hẳn");
  }
  if (!problems.length) return first;

  const retry = await nvidiaChat(
    [
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          `Câu trên ${problems.join("; ")}. ` +
          "Viết lại một bình luận khác hoàn toàn: đổi cách mở đầu, chỉ bổ sung nội dung/ví dụ/câu hỏi mở, " +
          "thuần tiếng Việt, các câu hoàn chỉnh.",
      },
    ],
    options
  );

  if (looksLikeThanksOrPraise(retry)) {
    return (
      retry.replace(/^[^.!?]*(cảm ơn|thank)[^.!?]*[.!?]\s*/i, "").trim() || retry
    );
  }
  return retry;
}

/**
 * Sinh comment gốc trên bài của người khác, đúng vai người đọc đang tham gia thảo luận.
 */
async function nvidiaGenerateExternalDiscussion(input) {
  const articleBody = stripHtml(input.articleBody || "").slice(0, 5000);
  const previousBodies = (Array.isArray(input.previousBodies) ? input.previousBodies : [])
    .map((body) => stripHtml(body))
    .filter(Boolean)
    .slice(-12);
  if (!articleBody) throw new Error("Không lấy được nội dung bài để thảo luận.");

  const bannedOpenings = [
    ...new Set(previousBodies.map((body) => getOpeningKey(body, 6)).filter(Boolean)),
  ].slice(0, 12);
  const angle =
    DISCUSSION_ANGLES[
      (Math.max(1, Number(input.discussionNumber) || 1) - 1) % DISCUSSION_ANGLES.length
    ];
  const systemPrompt =
    `Bạn là người đọc @${input.username || "user"} đang tham gia thảo luận dưới bài của @${
      input.postAuthor || "author"
    } trên TechHub. ` +
    "Bạn đăng một COMMENT GỐC trực tiếp dưới bài, không giả làm tác giả và không reply ai. " +
    "Bình luận phải liên quan chặt chẽ tới bài, có một ý cụ thể, trải nghiệm, góc nhìn, " +
    "lưu ý thực tế hoặc câu hỏi mở. Không chỉ khen chung chung, không tâng bốc, không bịa " +
    "chức danh, dự án hay trải nghiệm cá nhân mà đề bài không cung cấp. " +
    "CHỈ dùng tiếng Việt phổ thông, không chèn chữ Trung/Nhật/Hàn hay từ tiếng Anh. " +
    "Viết 1-3 câu hoàn chỉnh, luôn kết thúc bằng dấu câu, không markdown, hashtag hoặc lời chào. " +
    "Chỉ trả về đúng nội dung bình luận.";
  const userPrompt =
    `Tiêu đề: ${input.postTitle || "(không tiêu đề)"}\n` +
    `Tác giả bài: @${input.postAuthor || "author"}\n` +
    `Nội dung bài:\n${articleBody}\n\n` +
    `Các comment trước của bạn dưới bài này (không được lặp ý):\n${
      previousBodies.join("\n") || "(chưa có)"
    }\n\n` +
    (bannedOpenings.length
      ? `Các cách mở đầu đã dùng, phải mở đầu khác:\n- ${bannedOpenings.join("\n- ")}\n\n`
      : "") +
    `Góc tiếp cận: ${angle}\n` +
    `Hãy viết mẫu thảo luận số ${input.discussionNumber || 1}/${
      input.discussionTarget || "?"
    } với tư cách người đọc.`;
  const options = {
    maxTokens: 420,
    maxLength: 500,
    temperature: 0.95,
    topP: 0.92,
    presencePenalty: 0.6,
    frequencyPenalty: 0.5,
  };
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const first = await nvidiaChat(messages, options);
  const praiseOnly =
    looksLikeThanksOrPraise(first) &&
    stripHtml(first).split(/\s+/).length < 24;
  const problems = [];
  if (praiseOnly) problems.push("chỉ khen/cảm ơn chung chung mà chưa có ý thảo luận");
  if (hasForeignScript(first)) problems.push("có lẫn chữ nước ngoài");
  if (sharesOpeningWith(first, previousBodies)) problems.push("mở đầu trùng mẫu trước");
  if (!problems.length) return first;

  return nvidiaChat(
    [
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          `Mẫu trên ${problems.join("; ")}. ` +
          "Viết lại khác hoàn toàn, thuần tiếng Việt, có ý cụ thể và không giả làm tác giả.",
      },
    ],
    options
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    nvidiaGenerateReply,
    nvidiaGenerateDiscussion,
    nvidiaGenerateExternalDiscussion,
    getNvidiaConfig,
    cleanAiReplyText,
    stripHtml,
    hasForeignScript,
    getOpeningKey,
    trimToSentenceLimit,
    dropTrailingFragment,
  };
}
