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

### Đồng bộ bài viết

Đồng bộ bài dùng plan riêng: [PLAN_POST_SYNC.md](PLAN_POST_SYNC.md). Campaign chỉ nhận bài đã được sync leader xác minh. User thường không quét feed; họ chỉ gửi post hint từ dữ liệu đang xem. Feed discovery và reconcile username do một admin leader có lease thực hiện.

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

### Tích hợp với post sync

Schema `post_hints` và `post_sync_*` được đặc tả trong [PLAN_POST_SYNC.md](PLAN_POST_SYNC.md). Engagement planner chỉ lấy bài có `last_verified_at` hợp lệ, đúng tác giả và nằm trong cửa sổ campaign.

### Edge Function `engagement-api`

Cung cấp các action:

- `heartbeat`: báo actor online và đồng bộ trạng thái.
- `claimTask`: claim atomic một task phù hợp, đặt lease.
- `completeTask`: ghi kết quả TechHub và interaction.
- `failTask`: phân loại lỗi retry được và lỗi vĩnh viễn.
- `getStatus`: trả tiến độ cho UI.
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
- **Đồng bộ bài viết** là menu admin riêng theo [PLAN_POST_SYNC.md](PLAN_POST_SYNC.md); plan engagement chỉ dùng kết quả bài đã verified.

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
- Tích hợp campaign với bài đã verified từ [PLAN_POST_SYNC.md](PLAN_POST_SYNC.md).

Điều kiện hoàn thành: planner không tạo task cho bài chưa verified; khi bài bị sync đánh dấu đóng/xóa, task chưa chạy được cancel hoặc skip có lý do.

## 10. Thứ tự ưu tiên MVP

MVP nên kết thúc ở Mốc 3 với vote và comment. Reply qua lại để sang Mốc 4 vì cần quản lý ancestry, nội dung và nhịp hội thoại phức tạp hơn. Cấu hình khởi đầu an toàn cho MVP: một task mỗi lần thức dậy, tối đa 3 bài/ngày cho mỗi actor, cooldown 30–60 phút và không quá một comment của cùng actor trên một bài.
