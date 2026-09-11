# Plan phát triển tương tác giữa các user

## 1. Mục tiêu

Mỗi extension đang đăng nhập một tài khoản TechHub sẽ nhận các nhiệm vụ tương tác với bài của user khác:

- Upvote bài nếu tài khoản chưa vote.
- Đăng comment có liên quan tới nội dung bài.
- Có thể trả lời comment để tạo chuỗi thảo luận ngắn giữa các user.
- Chia đều lượt tương tác, không cho một tài khoản hoặc một bài nhận quá nhiều lượt trong thời gian ngắn.
- Mỗi thao tác có trạng thái, lịch sử và cơ chế retry; không tạo trùng khi extension hoặc service worker khởi động lại.

## 2. Hiện trạng có thể tái sử dụng

Code hiện tại đã có nền tảng cần thiết:

- `runCrossInteraction()` chạy mỗi 15 phút, lấy tối đa 5 bài chưa tương tác.
- `interactWithTechHub()` đã hỗ trợ comment, reply và toggle upvote.
- Bảng `posts` lưu bài của nhiều user; bảng `interactions` lưu comment/like/reply đã thực hiện.
- Có luồng quét bài cộng đồng, AI draft, Chrome Alarm, bắt CSRF và kiểm tra tài khoản bị khóa.

Các điểm cần sửa trước khi mở rộng:

- Mỗi máy tự chọn bài nên nhiều user có thể cùng chọn một bài tại cùng thời điểm.
- Comment và vote đang chạy chung một lượt; comment thành công nhưng vote lỗi sẽ khó retry riêng.
- API vote là `toggle`, nên retry mù có thể biến vote thành unvote.
- `recordInteraction()` nuốt lỗi, vì vậy thao tác đã chạy nhưng lịch sử chưa lưu có thể bị lặp.
- Chu kỳ 15 phút, giới hạn 5 bài và delay 5 giây đang hard-code.
- Bảng điều phối hiện cho client ghi trực tiếp qua anon key; chưa đủ an toàn cho hệ thống nhiều user.

## 3. Kiến trúc đề xuất

Supabase giữ vai trò điều phối; extension vẫn là nơi thực thi vì cookie và CSRF TechHub chỉ có trên máy user.

Luồng chính:

1. Một máy admin được chọn làm sync leader, quét bài TechHub theo lịch và cập nhật Supabase.
2. Bộ lập lịch tạo nhiệm vụ `vote`, `comment` hoặc `reply` cho từng actor.
3. Extension gọi Edge Function để claim đúng một nhiệm vụ bằng lease có thời hạn.
4. Extension đọc bài và comment hiện tại từ TechHub, thực hiện hành động bằng phiên đăng nhập local.
5. Extension báo `succeeded`, `failed` hoặc `skipped`; server cập nhật lịch sử và lịch chạy tiếp theo.
6. Nhiệm vụ hết lease được trả lại hàng đợi, nhưng idempotency key ngăn thực thi trùng.

### Đồng bộ bài viết: mô hình hint → discovery → reconcile

Mục tiêu là phát hiện bài mới mà không bắt user tự quét và không biến máy admin thành công việc thủ công. Hệ thống dùng ba tầng, từ nhẹ đến nặng:

#### Tầng 1 — Post hint từ hoạt động tự nhiên của user

Extension user không gọi API danh sách bài. Khi user vừa đăng bài hoặc đang mở trang bài của mình, extension lấy metadata sẵn có từ URL/DOM hoặc response mà extension đã gọi cho chức năng khác rồi gửi một `post_hint` lên `engagement-api`.

Hint tối thiểu gồm `username`, `techhub_id` hoặc UUID/URL, `observed_at` và `source`. Không gửi cookie, CSRF, nội dung riêng tư hoặc toàn bộ response TechHub. Nếu chỉ có URL/UUID thì sync leader sẽ lấy chi tiết sau.

Đây là tín hiệu phát hiện, chưa phải dữ liệu chính thức và không tự tạo campaign. Nó không phát sinh request quét feed mới trên máy user.

#### Tầng 2 — Feed discovery trung tâm

Một sync leader dùng session TechHub của admin để quét feed/community trong cửa sổ 7 ngày. Lượt quét lọc tác giả theo bảng `users`, upsert bài theo `techhub_id`, và tạo job xác minh cho hint chưa đủ metadata.

Feed discovery là đường dự phòng khi user không mở extension hoặc extension không bắt được hint. Nó chạy tự động mỗi 60 phút, đọc tăng dần theo cursor/`last_seen_at` và dừng ngay khi gặp vùng dữ liệu đã đồng bộ hoặc bài cũ hơn 7 ngày.

#### Tầng 3 — Reconcile theo username

Đây là lớp đối soát, không phải đường phát hiện chính. Sync leader gọi `GET /api/v1/articles/?username=<username>` cho user đến hạn kiểm tra, và dừng phân trang khi gặp bài cũ hơn 7 ngày.

- Chạy toàn bộ user mỗi 12–24 giờ, không chạy mỗi 30–60 phút.
- User có `post_hint` mới được ưu tiên xác minh ngay.
- User chưa đến `next_check_at` bị bỏ qua.
- Admin có thể yêu cầu quét một user, nhưng cách lần quét trước tối thiểu 10 phút.
- Batch dùng concurrency tối đa 2–3, delay 1–2 giây và jitter giữa request.

### Sync leader và lease

- Chỉ thiết bị admin được chỉ định mới có thể claim lease `post-sync`.
- Mỗi thời điểm chỉ có một lease active; mặc định hết hạn sau 10 phút và leader gia hạn trong lúc chạy.
- Mọi nút “Đồng bộ ngay” hoặc “Quét 7 ngày” chỉ tạo `post_sync_job`; không gọi TechHub trực tiếp từ UI.
- Nếu primary leader offline quá `offline_after`, admin device dự phòng mới được claim job.
- User thường không được claim sync job, không chạy community scan và không bầu leader.
- Job retry bằng exponential backoff cho 429/5xx; 401/403 chuyển sang `session_required` và dừng im lặng.
- Mỗi job có idempotency key để reload service worker không chạy cùng lượt hai lần.

### State machine

`post_hint` đi qua các trạng thái:

```text
received → queued → verifying → verified
                    ├─ retry_wait
                    ├─ rejected
                    └─ session_required
```

`post_sync_job` đi qua các trạng thái:

```text
pending → claimed → running → succeeded
                     ├─ retry_wait
                     ├─ failed
                     └─ session_required
```

Hint được `verified` chỉ khi username và định danh bài khớp dữ liệu TechHub. `techhub_id` là khóa unique: chưa tồn tại là bài `new`; đã tồn tại nhưng metadata hoặc bộ đếm thay đổi là `updated`.

### Dữ liệu, số liệu và tải dự kiến

- Lưu `first_seen_at`, `last_seen_at`, `last_verified_at`, `discovered_by`, `published_at` và `sync_run_id` trên bài.
- Bài thiếu `published_at` hoặc không xác minh được tác giả không được tự đưa vào campaign.
- User mở “Bài viết của tôi” chỉ đọc cache Supabase; không tự gọi danh sách bài TechHub.
- Task vote/comment chỉ tải article detail và thread của đúng bài đang thực thi.
- Sau task thành công, cập nhật số liệu dự kiến; sync leader reconcile số vote/comment thật theo lịch.
- Nếu TechHub hỗ trợ ETag hoặc `Last-Modified`, dùng conditional request; nếu không thì dừng bằng cursor và mốc thời gian.

Ngân sách với 30 user:

- Post hint: 0 request quét TechHub trên máy user; leader chỉ xác minh đúng bài mới.
- Feed discovery: khoảng 1–3 request mỗi 60 phút, tùy pagination.
- Reconcile username: tối thiểu khoảng 30 request mỗi 12–24 giờ, cộng trang bổ sung của user có nhiều bài.
- Không có phép nhân `30 user × 7 ngày`; 7 ngày chỉ là điều kiện dừng dữ liệu.

### Điều kiện nghiệm thu đồng bộ

- Hai admin mở extension cùng lúc nhưng chỉ một máy chạy sync.
- User đăng bài và extension bắt được hint: bài xuất hiện trong cache sau một lượt verify mà user không bấm đồng bộ.
- User không mở extension: feed discovery vẫn phát hiện bài trong vòng tối đa 60 phút.
- Reconcile 30 user không gửi quá concurrency cấu hình và không quét lại user chưa đến hạn.
- Restart service worker giữa job không tạo bản ghi bài hoặc lượt sync trùng.
- 401/403 không mở tab hay notification; trạng thái chỉ hiện khi admin mở panel.

## 4. Kịch bản JSON nhiều cấp

Admin sẽ dán JSON vào extension. Mỗi phần tử là một chuỗi thảo luận độc lập. Format chuẩn dùng `turns` để không bị giới hạn ở một cặp hỏi–đáp:

```json
[
  {
    "name": "backlog-qua-tang",
    "actors": {
      "A": "visitor",
      "B": "author"
    },
    "turns": [
      {
        "actor": "A",
        "content": "Quà về thế này chắc backlog bài viết lại tăng rồi anh."
      },
      {
        "actor": "B",
        "content": "Haha backlog thì lúc nào cũng có em, chỉ thiếu capacity để xử lý thôi."
      },
      {
        "actor": "A",
        "content": "Vậy chắc phải ưu tiên theo impact trước anh nhỉ?"
      },
      {
        "actor": "B",
        "content": "Chuẩn em, anh sẽ xử lý nhóm có impact cao trước rồi mới dọn phần còn lại."
      }
    ]
  },
  {
    "name": "delayed-gratification",
    "actors": {
      "A": "visitor",
      "B": "author"
    },
    "turns": [
      {
        "actor": "A",
        "content": "Đây gọi là delayed gratification phiên bản TechHub phải không anh? 😂"
      },
      {
        "actor": "B",
        "content": "Chuẩn em. Reward delay hơi lâu nhưng lúc nhận lại có cảm giác mở achievement lần hai."
      }
    ]
  }
]
```

Quy ước:

- A đăng turn 1 thành comment gốc và không có `ancestry`.
- B đăng turn 2 bằng cách reply trực tiếp vào comment ID của turn 1.
- A đăng turn 3 bằng cách reply trực tiếp vào comment ID của turn 2.
- B đăng turn 4 bằng cách reply trực tiếp vào comment ID của turn 3.
- Mỗi turn chỉ được mở sau khi turn trước thành công và trả về comment ID từ TechHub.
- `actors.A = visitor` được map sang user được phân công; `actors.B = author` bắt buộc map sang username sở hữu bài.
- Phiên bản đầu hỗ trợ 2–4 turn theo mẫu A → B → A → B. Schema vẫn cho phép kéo dài hoặc thêm actor C về sau.
- Không dùng `level` do thứ tự phần tử trong `turns` đã là cấp hội thoại. Server tự gán `turn_index` từ 1.

Format cũ vẫn được nhận để không làm mất dữ liệu đã chuẩn bị:

```json
[
  {
    "discussion": "Quà về thế này chắc backlog bài viết lại tăng rồi anh.",
    "answer": "Haha backlog thì lúc nào cũng có em, chỉ thiếu capacity để xử lý thôi."
  }
]
```

Khi import, extension chuyển mỗi object cũ thành một thread hai turn: `discussion → A`, `answer → B`, đồng thời gán `A = visitor` và `B = author`. Chuỗi muốn có cấp 3–4 phải dùng format `turns` mới. Bộ import cần loại bỏ HTML entity như `&#x20;`, kiểm tra JSON là array, giới hạn 2–4 turn, bắt đầu bằng A, luân phiên A/B và từ chối content rỗng.

## 5. Dữ liệu và API

Tạo migration `012_cross_user_engagement.sql` với các bảng sau:

### `engagement_campaigns`

Lưu cấu hình một đợt tương tác: trạng thái, phạm vi bài, loại hành động, số lượt tối đa mỗi bài, giới hạn mỗi actor, khoảng nghỉ và thời gian chạy.

### `engagement_tasks`

Mỗi dòng là một hành động độc lập:

- `actor_username`, `target_username`, `techhub_id`
- `action`: `vote`, `comment`, `reply`
- `status`: `pending`, `claimed`, `succeeded`, `failed`, `skipped`, `cancelled`
- `scheduled_at`, `claimed_at`, `lease_until`, `completed_at`
- `attempt_count`, `max_attempts`, `last_error`
- `source_comment_id`, `content`, `techhub_result_id`
- `idempotency_key` unique

Một comment campaign nhiều lượt dùng slot trong idempotency key, ví dụ `campaign:actor:post:comment:slot-1`. Vote chỉ có một slot cho mỗi actor và bài.

### `engagement_events`

Nhật ký append-only cho claim, bắt đầu, thành công, retry và lỗi. Dùng bảng này để audit mà không làm phình bản ghi task.

### `discussion_threads` và `discussion_turns`

`discussion_threads` lưu một kịch bản đã import, bài đích, user A, user B và trạng thái toàn chuỗi. `discussion_turns` lưu từng turn với `turn_index`, `actor_key`, `actor_username`, `content`, `status`, `depends_on_turn_id`, `parent_techhub_comment_id` và `techhub_comment_id`.

Chỉ turn đầu được đưa vào queue khi bắt đầu. Khi TechHub trả về comment ID, server ghi ID đó rồi mở khóa turn kế tiếp. Task reply lấy `parent_techhub_comment_id` từ `techhub_comment_id` của turn trước, nhờ đó cấp 2, 3, 4 luôn nối đúng ancestry dù hai máy thực thi ở thời điểm khác nhau.

### `post_hints`, `post_sync_jobs`, `post_sync_sources` và `post_sync_runs`

`post_hints` lưu tín hiệu tối thiểu từ extension user, unique theo `(username, identifier)`, kèm source, trạng thái verify, attempt và lỗi. User chỉ được gửi hint cho chính username đã gắn với device token.

`post_sync_jobs` là hàng đợi `verify_hint|feed_discovery|user_reconcile`, có schedule, claim lease, attempt, idempotency key và trạng thái. `post_sync_sources` lưu community hoặc username, cursor, `last_checked_at`, `next_check_at`, `last_success_at` và lỗi gần nhất. `post_sync_runs` lưu số request/trang, số bài new/updated, HTTP status, duration và kết quả từng lượt. Chỉ admin service được claim/ghi job và run.

Bổ sung vào `posts`: `first_seen_at`, `last_seen_at`, `discovered_by` và `sync_run_id`. Có index `(username, published_at desc)` để màn hình quét 7 ngày không phải lọc toàn bảng.

### Edge Function `engagement-api`

Cung cấp các action:

- `heartbeat`: báo actor online và đồng bộ trạng thái.
- `claimTask`: claim atomic một task phù hợp, đặt lease.
- `completeTask`: ghi kết quả TechHub và interaction.
- `failTask`: phân loại lỗi retry được và lỗi vĩnh viễn.
- `getStatus`: trả tiến độ cho UI.
- `submitPostHint`: device gửi hint cho chính user, không kèm cookie/CSRF.
- `claimPostSyncJob`, `completePostSyncJob`, `failPostSyncJob`: sync leader xử lý hàng đợi có lease.
- `requestPostSync`: admin tạo job quét feed, một user hoặc toàn bộ user đến hạn.
- `getPostSyncStatus`: admin xem leader, nguồn, lượt chạy, bài mới và lỗi.
- `importThreads`: validate, chuyển format cũ và lưu kịch bản JSON.
- `advanceThread`: hoàn tất một turn và mở turn kế tiếp theo dependency.
- `planCampaign`, `pauseCampaign`, `cancelCampaign`: chỉ admin.

Client không ghi trực tiếp vào ba bảng điều phối. Bật RLS, thu quyền ghi của `anon`, và cho Edge Function dùng service role. Mỗi máy user cần device token riêng, lưu hash token trên server để khóa hoặc thu hồi từng máy.

## 6. Quy tắc phân công

- Không phân bài của chính actor.
- Bỏ qua user bị khóa, bài đóng, bài thiếu UUID hoặc quá cũ so với phạm vi campaign.
- Mỗi actor chỉ giữ một task đang claim.
- Mỗi cặp actor–tác giả có cooldown; ưu tiên tác giả mà actor ít tương tác nhất.
- Giới hạn theo ngày cho actor, bài và cặp user.
- Comment và vote là hai task riêng để retry độc lập.
- Trộn thời gian chạy trong khoảng cấu hình, tránh tất cả extension thức dậy cùng phút.
- Khi đổi tài khoản TechHub trên cùng máy, trả task cũ về queue và đăng ký actor mới.
- Không phát turn kế tiếp nếu actor cần thiết đang offline hoặc turn trước chưa có TechHub comment ID.
- Nếu một turn lỗi vĩnh viễn, đánh dấu cả thread `blocked`; admin có thể sửa content và chạy lại đúng turn đó.

## 7. Xử lý vote và comment

### Vote

Trước khi gọi endpoint toggle, đọc trạng thái reaction hiện tại từ article detail. Nếu đã upvote thì đánh dấu `succeeded/already_done` mà không toggle. Sau khi gọi, kiểm tra response xác nhận trạng thái cuối là upvote.

### Comment

Đọc tiêu đề, nội dung bài và một số comment gần nhất. Nội dung có thể lấy từ template hoặc AI, nhưng phải kiểm tra:

- Không trùng comment trước của actor trên cùng bài.
- Không quá giống các comment gần nhất.
- Không rỗng, không chứa placeholder và nằm trong giới hạn độ dài.
- Lưu content vào task trước khi POST để retry dùng cùng nội dung.

### Reply giữa các user

Chỉ tạo reply task sau khi comment trước thành công và có `techhub_comment_id`. Mỗi lượt lưu comment ID thực tế trả về từ TechHub. Giới hạn ban đầu là bốn turn, bắt buộc luân phiên actor và dừng khi comment nguồn bị xóa hoặc bài đóng.

## 8. Giao diện

Tách thành hai menu độc lập:

- **Bài viết của tôi** dành cho mọi user: danh sách bài cache, số comment/vote, thời gian đồng bộ gần nhất, bật/tắt tham gia thảo luận và hoạt động của chính tài khoản.
- **Chiến dịch** chỉ dành cho admin: tạo campaign, chọn bài, nhập JSON, chọn vote/comment/reply, quota, cooldown, lịch chạy, pause/cancel và xem tiến độ toàn hệ thống.
- **Đồng bộ bài viết** chỉ dành cho admin: trạng thái sync leader, nguồn/community, lần đồng bộ gần nhất, lượt kế tiếp, số bài cập nhật, bộ chọn user, nút “Quét 7 ngày” và “Đồng bộ ngay”. Các nút chỉ enqueue job và hiển thị trạng thái, không giữ UI chờ hết lượt quét.
- Admin có bộ lọc “Bài mới 7 ngày”, nhóm theo user; mỗi user hiển thị số bài mới, `last_checked_at` và trạng thái quét. Bài mới được đánh dấu trong panel khi admin mở extension, không phát notification ngoài panel.

User thường không cần thấy khái niệm campaign, task lease, device token hoặc vận hành. Switch nên đặt tên dễ hiểu như “Cho phép tài khoản tham gia thảo luận”. Khi tắt, server ngừng phân task mới; task đang claim được release về queue.

Số comment/vote của user nên lấy từ `engagement_tasks`/`engagement_events`, không gọi TechHub để đếm lại mỗi lần mở extension. Danh sách bài và tổng số liệu thật dùng cache `posts`; UI luôn hiển thị thời điểm cache được cập nhật.
- Admin có ô dán JSON, nút “Kiểm tra”, preview từng thread/turn, chọn bài đích và nút “Nhập kịch bản”. Lỗi JSON phải chỉ rõ thread và turn.

Danh sách hoạt động hiển thị riêng `pending`, `running`, `success`, `retry`, `failed`; không hiển thị token hoặc cookie.

### Chế độ chạy im lặng

Extension không làm gián đoạn người dùng khi chạy background:

- Không dùng Chrome notification cho trạng thái thành công, lỗi, hết cookie hoặc hoàn thành campaign.
- Không tự mở tab TechHub ẩn/hiện để làm mới cookie hay CSRF.
- Không hiện popup, alert, confirm, badge hoặc toast khi người dùng không mở side panel.
- Background job chỉ ghi trạng thái và lỗi gần nhất vào `chrome.storage.local`, đồng thời cập nhật task trên server.
- Khi thiếu hoặc hết session, dừng nhận task mới và giữ task hiện tại ở trạng thái retry/chờ đăng nhập; không tiếp tục gọi API liên tục.
- Chỉ khi người dùng chủ động mở extension mới gọi `GET /api/v1/accounts/profile` để kiểm tra session.
- Nếu session hết hạn, hiển thị banner ngay trong panel: “Phiên TechHub đã hết hạn. Đăng nhập lại để tiếp tục”, kèm nút mở trang đăng nhập TechHub.
- Sau khi đăng nhập thành công, extension tự kiểm tra lại session, xóa banner và tiếp tục nhận task ở lịch kế tiếp.
- Khi người dùng tự bấm chạy một thao tác trong panel, kết quả chỉ hiển thị inline trong đúng panel đó.

Có thể bỏ permission `notifications` khỏi `manifest.json` sau khi các luồng cũ không còn gọi `chrome.notifications`. Việc kiểm tra session phải dựa trên HTTP 401/403 từ TechHub; không log cookie hoặc CSRF token ra console.

## 9. Các mốc triển khai

### Mốc 1 — Làm chắc luồng hiện tại

- Tách vote và comment thành hàm có kết quả chuẩn hóa.
- Không nuốt lỗi khi ghi interaction.
- Thêm khóa local để một service worker không chạy hai job cùng lúc.
- Đưa interval, quota và delay vào settings.
- Bổ sung kiểm tra vote idempotent.
- Gỡ notification và hành vi tự mở tab khỏi background job.
- Thêm trạng thái `session_required`; chỉ kiểm tra và nhắc đăng nhập khi side panel được mở.

Điều kiện hoàn thành: reload extension giữa một lượt chạy không tạo comment hoặc toggle vote lần hai; khi cookie hết hạn, background dừng im lặng và chỉ hiện yêu cầu đăng nhập sau khi người dùng mở extension.

### Mốc 2 — Hàng đợi trung tâm

- Migration 012, RLS và index.
- Edge Function `engagement-api` với claim lease atomic.
- Device token theo user/máy.
- Chuyển `runCrossInteraction()` sang claim một task mỗi lần.

Điều kiện hoàn thành: chạy đồng thời từ hai profile Chrome không claim cùng task; task treo tự quay lại queue sau khi hết lease.

### Mốc 3 — Campaign và phân phối công bằng

- Planner sinh task vote/comment theo quota.
- Cooldown, daily cap và phân phối vòng giữa các tác giả.
- UI admin tạo, pause và theo dõi campaign.
- Tách menu user “Bài viết của tôi” và menu admin “Chiến dịch”.

Điều kiện hoàn thành: campaign đạt đúng quota, không vượt giới hạn actor/bài và tự kết thúc khi hết task.

### Mốc 4 — Thảo luận theo ngữ cảnh

- Thêm import JSON, converter format `discussion/answer` và preview trước khi lưu.
- Tạo `discussion_threads`, `discussion_turns` và dependency cho 2–4 turn.
- Lưu comment ID sau mỗi POST, tạo reply đúng ancestry và luân phiên A/B.
- Có thể dùng article body và comment gần nhất để AI chỉnh draft nếu campaign yêu cầu.
- Kiểm tra trùng lặp và cho sửa turn chưa chạy.

Điều kiện hoàn thành: import được cả JSON cũ và mới; chuỗi bốn turn chạy lần lượt trên hai máy, giữ đúng ancestry, không tự reply liên tục bằng cùng user và có thể tiếp tục sau khi service worker restart.

### Mốc 5 — Vận hành

- Dashboard lỗi theo HTTP status và actor.
- Retry có backoff cho 429/5xx; với 401/403 thì lưu `session_required` và dừng im lặng cho tới khi người dùng mở extension, đăng nhập lại.
- Giới hạn tốc độ toàn hệ thống và kill switch.
- Dọn event cũ, cảnh báo task treo và thống kê tỷ lệ thành công.
- Thêm `post_hints`, sync leader lease, `post_sync_jobs`, incremental cursor và menu admin “Đồng bộ bài viết”.
- Bắt hint từ URL/DOM hoặc dữ liệu TechHub mà extension đã có; không tạo lượt quét trên máy user.
- Thêm discovery feed 7 ngày mỗi 60 phút và reconcile username mỗi 12–24 giờ.
- Thêm `last_checked_at`, `next_check_at`, `new_count`, request count và trạng thái verify cho từng user/run.

Điều kiện hoàn thành: bài mới được phát hiện bằng hint hoặc feed dù user không bấm đồng bộ; 30 user không tự quét; chỉ một admin leader gọi TechHub; dashboard chứng minh được request count, nguồn phát hiện và kết quả từng run.

## 10. Thứ tự ưu tiên MVP

MVP nên kết thúc ở Mốc 3 với vote và comment. Reply qua lại để sang Mốc 4 vì cần quản lý ancestry, nội dung và nhịp hội thoại phức tạp hơn. Cấu hình khởi đầu an toàn cho MVP: một task mỗi lần thức dậy, tối đa 3 bài/ngày cho mỗi actor, cooldown 30–60 phút và không quá một comment của cùng actor trên một bài.
