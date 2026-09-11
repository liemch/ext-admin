// discussion-import.js — Validate + chuẩn hóa kịch bản JSON thảo luận nhiều cấp.
//
// Dùng chung cho popup (nút "Kiểm tra" + preview trước khi nhập).
// Server (engagement-api) validate lại độc lập — giữ hai bên đồng bộ:
//   - JSON phải là mảng, tối đa 50 thread.
//   - Format chuẩn: { name?, actors?, turns: [{ actor: A|B, content }] }.
//   - Format cũ: { discussion, answer } → chuyển thành 2 turn A→B.
//   - 2–4 turn, bắt đầu bằng A, luân phiên A/B, content 1–2000 ký tự.
//   - actors.A = visitor (user được phân công), actors.B = author (chủ bài).
//   - Giải mã HTML entity (&#x20; &#39; &amp; ...) trước khi kiểm tra độ dài.

(function (global) {
  "use strict";

  const MAX_THREADS = 50;
  const MAX_CONTENT_LENGTH = 2000;

  function decodeHtmlEntities(text) {
    return String(text || "")
      .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCharCode(code) : _match;
      })
      .replace(/&#(\d+);/g, (_match, dec) => {
        const code = parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCharCode(code) : _match;
      })
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
  }

  function toPositiveInt(value) {
    const num = Number(value);
    return Number.isInteger(num) && num > 0 ? num : null;
  }

  function toUsername(value) {
    const text = String(value ?? "").trim();
    return text || null;
  }

  function isUsername(value) {
    return /^[A-Za-z0-9_.-]{1,100}$/.test(String(value || ""));
  }

  function normalizeThread(raw, index) {
    const label = `thread[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${label}: mỗi phần tử phải là object.`);
    }

    // Format cũ: { discussion, answer }.
    if ("discussion" in raw || "answer" in raw) {
      const discussion = decodeHtmlEntities(raw.discussion ?? "").trim();
      const answer = decodeHtmlEntities(raw.answer ?? "").trim();
      if (!discussion) throw new Error(`${label}: discussion rỗng.`);
      if (!answer) throw new Error(`${label}: answer rỗng.`);
      if (discussion.length > MAX_CONTENT_LENGTH || answer.length > MAX_CONTENT_LENGTH) {
        throw new Error(`${label}: nội dung quá dài (>${MAX_CONTENT_LENGTH} ký tự).`);
      }
      const name =
        decodeHtmlEntities(raw.name ?? `thread-${index + 1}`).trim() ||
        `thread-${index + 1}`;
      return {
        name,
        format: "legacy",
        actors: { A: "visitor", B: "author" },
        turns: [
          { actor: "A", content: discussion },
          { actor: "B", content: answer },
        ],
        targetTechhubId: toPositiveInt(raw.targetTechhubId ?? raw.techhubId),
        visitor: toUsername(raw.visitor ?? raw.visitorUsername),
      };
    }

    const turnsRaw = raw.turns;
    if (!Array.isArray(turnsRaw)) {
      throw new Error(
        `${label}: thiếu mảng turns (hoặc dùng format cũ discussion/answer).`
      );
    }
    if (turnsRaw.length < 2 || turnsRaw.length > 4) {
      throw new Error(
        `${label}: số turn phải từ 2 đến 4 (nhận ${turnsRaw.length}).`
      );
    }
    const turns = turnsRaw.map((turn, turnIdx) => {
      const turnLabel = `${label}.turns[${turnIdx}]`;
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
        throw new Error(`${turnLabel}: mỗi turn phải là object.`);
      }
      const actor = String(turn.actor ?? "").trim().toUpperCase();
      if (actor !== "A" && actor !== "B") {
        throw new Error(
          `${turnLabel}: actor phải là "A" hoặc "B" (nhận "${actor}").`
        );
      }
      const expected = turnIdx % 2 === 0 ? "A" : "B";
      if (actor !== expected) {
        throw new Error(
          `${turnLabel}: turn ${turnIdx + 1} phải do ${expected} đăng (luân phiên A/B, bắt đầu bằng A).`
        );
      }
      const content = decodeHtmlEntities(turn.content ?? "").trim();
      if (!content) throw new Error(`${turnLabel}: content rỗng.`);
      if (content.length > MAX_CONTENT_LENGTH) {
        throw new Error(
          `${turnLabel}: content quá dài (>${MAX_CONTENT_LENGTH} ký tự).`
        );
      }
      return { actor, content };
    });

    const actorsRaw = raw.actors || {};
    const actorA = String(actorsRaw.A ?? "visitor").trim() || "visitor";
    const actorB = String(actorsRaw.B ?? "author").trim() || "author";
    const lowerA = actorA.toLowerCase();
    const lowerB = actorB.toLowerCase();
    if (lowerA !== "visitor" && lowerA !== "author" && !isUsername(actorA)) {
      throw new Error(`${label}: actors.A không hợp lệ ("${actorA}").`);
    }
    if (lowerB !== "visitor" && lowerB !== "author" && !isUsername(actorB)) {
      throw new Error(`${label}: actors.B không hợp lệ ("${actorB}").`);
    }

    const name =
      decodeHtmlEntities(raw.name ?? `thread-${index + 1}`).trim() ||
      `thread-${index + 1}`;
    return {
      name,
      format: "turns",
      actors: { A: actorA, B: actorB },
      turns,
      targetTechhubId: toPositiveInt(raw.targetTechhubId ?? raw.techhubId),
      visitor: toUsername(raw.visitor ?? raw.visitorUsername),
    };
  }

  /**
   * Parse + validate toàn bộ JSON kịch bản.
   * @param {string|Array} input JSON text hoặc mảng đã parse.
   * @returns {{ threads: Array, errors: Array<{index:number,name:string,error:string}> }}
   * Không throw khi từng thread lỗi — gom lỗi để UI chỉ rõ thread/turn.
   */
  function validateThreads(input) {
    const errors = [];
    let parsed = input;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) {
        return {
          threads: [],
          errors: [{ index: -1, name: "", error: "Chưa dán JSON kịch bản." }],
        };
      }
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        return {
          threads: [],
          errors: [
            {
              index: -1,
              name: "",
              error: `JSON không hợp lệ: ${error.message}`,
            },
          ],
        };
      }
    }
    if (!Array.isArray(parsed)) {
      return {
        threads: [],
        errors: [{ index: -1, name: "", error: "JSON phải là một mảng các thread." }],
      };
    }
    if (parsed.length === 0) {
      return {
        threads: [],
        errors: [{ index: -1, name: "", error: "Mảng thread rỗng." }],
      };
    }
    if (parsed.length > MAX_THREADS) {
      return {
        threads: [],
        errors: [
          {
            index: -1,
            name: "",
            error: `Tối đa ${MAX_THREADS} thread mỗi lần import (nhận ${parsed.length}).`,
          },
        ],
      };
    }
    const threads = [];
    parsed.forEach((raw, index) => {
      try {
        threads.push(normalizeThread(raw, index));
      } catch (error) {
        let name = `thread-${index + 1}`;
        try {
          if (raw && typeof raw === "object" && raw.name) {
            name = String(raw.name).slice(0, 80);
          }
        } catch (_) {
          // Giữ tên mặc định.
        }
        errors.push({ index, name, error: error.message });
      }
    });
    return { threads, errors };
  }

  global.DiscussionImport = {
    MAX_THREADS,
    MAX_CONTENT_LENGTH,
    decodeHtmlEntities,
    validateThreads,
    normalizeThread,
  };
})(typeof window !== "undefined" ? window : globalThis);
