import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const background = readFileSync(path.join(root, "background.js"), "utf8")
  .replace(/\r\n/g, "\n");

function sourceBetween(start, end) {
  const from = background.indexOf(start);
  const to = background.indexOf(end, from);
  assert(from >= 0 && to > from, `Không tìm thấy đoạn ${start}`);
  return background.slice(from, to);
}

function loadFunction(source, name, dependencies) {
  const keys = Object.keys(dependencies);
  return new Function(...keys, `${source}\nreturn ${name};`)(...Object.values(dependencies));
}

const timingSource = sourceBetween(
  "function getNextAutoCommentDelay(job, now = Date.now())",
  "async function startAutoComment("
);
const getNextAutoCommentDelay = loadFunction(
  timingSource,
  "getNextAutoCommentDelay",
  { getRandomAutoCommentDelay: () => 2000 }
);
const startedAt = "2026-09-20T16:58:00.000Z";
const startMs = Date.parse(startedAt);
const jobs = [101, 102, 103].map((techhubId) => ({
  jobId: String(techhubId),
  techhubId,
  startedAt,
  targetCount: 60,
  commentCount: 0,
  completionMinutes: 1,
  deadlineAt: new Date(startMs + 60_000).toISOString(),
  username: "owner",
  active: true,
  autoDeleteEnabled: false,
}));
for (const job of jobs) {
  assert.equal(getNextAutoCommentDelay(job, startMs), 0);
  job.commentCount = 1;
  assert.equal(getNextAutoCommentDelay(job, startMs + 200), 800);
  job.commentCount = 59;
  assert.equal(getNextAutoCommentDelay(job, startMs + 58_000), 1000);
  job.commentCount = 0;
}
for (const job of jobs) {
  for (let count = 0; count < 60; count++) {
    const dispatchAt = startMs + count * 1000;
    assert.equal(getNextAutoCommentDelay(job, dispatchAt), 0);
    job.commentCount++;
    assert(dispatchAt + 250 < startMs + 60_000);
  }
  assert.equal(job.commentCount, 60);
  job.commentCount = 0;
}

const timers = new Map();
let nextTimerId = 1;
const invoked = [];
const scheduleAutoCommentTick = loadFunction(
  timingSource,
  "scheduleAutoCommentTick",
  {
    autoCommentGeneration: 7,
    autoCommentTimers: new Map(),
    clearTimeout: (id) => timers.delete(id),
    setTimeout: (callback) => {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    getNextAutoCommentDelay,
    runAutoCommentTick: (jobId) => invoked.push(jobId),
  }
);
jobs.forEach((job) => scheduleAutoCommentTick(job, 7, 0));
assert.equal(timers.size, 3, "ba bài phải có ba timer độc lập");
[...timers.values()].forEach((callback) => callback());
assert.deepEqual(invoked.sort(), ["101", "102", "103"]);

const tickSource = sourceBetween(
  "async function runAutoCommentTick(jobId, generation)",
  "async function getCreatedCommentId(response)"
);
jobs.forEach((job) => {
  job.deadlineAt = new Date(Date.now() + 60_000).toISOString();
});
const running = new Set();
const controllers = new Map();
const releases = [];
const runAutoCommentTick = loadFunction(tickSource, "runAutoCommentTick", {
  autoCommentJobs: jobs,
  autoCommentGeneration: 7,
  autoCommentRunningJobs: running,
  autoCommentAbortControllers: controllers,
  autoCommentTemplates: [{ content: "mẫu" }],
  chrome: { storage: { local: { get: async () => ({
    techhubCredentials: { csrfToken: "fixture" },
    userProfile: { username: "owner" },
  }) } } },
  saveAutoCommentState: async () => {},
  stopAutoCommentJob: async (job) => { job.active = false; },
  getAutoCommentLiveUsername: async () => "owner",
  supabase: { recordInteraction: async () => {} },
  interactWithTechHub: () => new Promise((resolve) => releases.push(resolve)),
  broadcastAutoCommentProgress: () => {},
  scheduleAutoCommentTick: () => {},
});
const runningTicks = jobs.map((job) => runAutoCommentTick(job.jobId, 7));
for (let i = 0; i < 10 && releases.length < 3; i++) await Promise.resolve();
assert.equal(releases.length, 3, "ba POST phải được gửi đồng thời, mỗi bài một POST");
releases.forEach((resolve) => resolve({ ok: true }));
await Promise.all(runningTicks);
assert.deepEqual(jobs.map((job) => job.commentCount), [1, 1, 1]);
assert.equal(running.size, 0);
releases.splice(0);
jobs.forEach((job) => {
  job.active = true;
  job.commentCount = 0;
  job.deadlineAt = new Date(Date.now() + 60_000).toISOString();
});
const mixedTicks = jobs.map((job) => runAutoCommentTick(job.jobId, 7));
for (let i = 0; i < 10 && releases.length < 3; i++) await Promise.resolve();
assert.equal(releases.length, 3);
releases[0]({ ok: false, status: 429 });
releases[1]({ ok: true });
releases[2]({ ok: true });
await Promise.all(mixedTicks);
assert.deepEqual(jobs.map((job) => job.commentCount), [0, 1, 1],
  "lỗi một bài không được chặn hai bài còn lại");
jobs[0].active = true;
jobs[0].commentCount = 59;
jobs[0].deadlineAt = new Date(Date.now() - 1000).toISOString();
await runAutoCommentTick(jobs[0].jobId, 7);
assert.equal(jobs[0].active, false, "quá hạn phải dừng, không gửi comment tiếp");
assert.equal(releases.length, 3);

const deleteSource = sourceBetween(
  "async function processDueScheduledDeletes()",
  "async function deletePostNow("
);
async function testDeleteGate(job, expectedStatus, expectedDeletes) {
  const now = Date.now();
  let items = [{
    techhubId: 101,
    deleteAt: new Date(now - 1000).toISOString(),
    status: "pending",
    waitForAutoComment: true,
  }];
  let deletes = 0;
  const processDueScheduledDeletes = loadFunction(
    deleteSource,
    "processDueScheduledDeletes",
    {
      loadScheduledDeleteList: async () => items,
      saveScheduledDeleteList: async (next) => { items = next; },
      autoCommentJobs: [job],
      autoCommentSchedules: [],
      executeDeletePost: async () => { deletes++; },
      ensureDeleteAlarm: async () => {},
      broadcastDeleteProgress: () => {},
    }
  );
  await processDueScheduledDeletes();
  assert.equal(items[0].status, expectedStatus);
  assert.equal(deletes, expectedDeletes);
  return items[0];
}
await testDeleteGate({ techhubId: 101, active: true, commentCount: 59, targetCount: 60 }, "pending", 0);
const delayed = await testDeleteGate({
  techhubId: 101, active: false, commentCount: 60, targetCount: 60,
  completedAt: new Date(Date.now() - 30_000).toISOString(),
}, "pending", 0);
assert(Date.parse(delayed.deleteAt) > Date.now());
await testDeleteGate({
  techhubId: 101, active: false, commentCount: 60, targetCount: 60,
  completedAt: new Date(Date.now() - 90_000).toISOString(),
}, "done", 1);
await testDeleteGate({ techhubId: 101, active: false, commentCount: 59, targetCount: 60 }, "error", 0);

console.log("Auto comment: 3 timer/POST song song, nhịp 60 giây và cổng xóa bài đều qua.");
