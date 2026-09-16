# Kế hoạch phát triển My Angel thành sản phẩm 9/10

## 1. Mục tiêu

My Angel cần mang lại hai giá trị rõ ràng cho người dùng TechHub:

1. Người dùng chọn bài của mình, tạo kịch bản thảo luận theo đúng nội dung bài và
   đưa kịch bản vào mạng lưới. Các máy đã cài extension thực sự thực hiện comment
   và reply theo chuỗi A → B hoặc A → B → A.
2. Admin chuẩn bị trước một kho bài bằng AI, duyệt nội dung, gán lịch và user.
   Đến giờ, extension trên đúng máy user dùng phiên TechHub cục bộ để đăng bài.

Thông điệp sản phẩm dành cho user:

> My Angel giúp bài viết của bạn nhận được thảo luận có nội dung từ những thành
> viên thật trong mạng lưới, đồng thời hỗ trợ chuẩn bị và đăng bài đúng lịch.

User không cần hiểu các khái niệm kỹ thuật như campaign, task, lease, device
token, worker hoặc leader.

## 2. Phạm vi và nguyên tắc

### 2.1 Trong phạm vi

- Tạo thảo luận 2–3 turn theo nội dung bài viết.
- Điều phối mỗi turn cho đúng user và đúng thiết bị.
- Preview, duyệt, tạm dừng và theo dõi lịch sử cho user.
- Tinh gọn cấu hình tương tác chéo cho admin.
- Kho bài AI, quy trình duyệt và lịch auto-post.
- Đăng bài bằng API TechHub từ extension của user.
- Bảo mật dữ liệu, device enrollment, consent và khả năng thu hồi.
- Test contract, test state machine và pilot có đo lường.

### 2.2 Ngoài phạm vi giai đoạn đầu

- Không gửi cookie hoặc CSRF TechHub lên Supabase.
- Không để Edge Function trực tiếp đăng bài thay user.
- Không tự động publish nội dung AI chưa được duyệt.
- Không quét feed hàng loạt từ máy user thường.
- Không thêm bundler, framework hoặc chuyển plain script sang ESM.
- Không gọi API ghi dữ liệu TechHub thật trong test tự động.

### 2.3 Nguyên tắc bắt buộc

- Mọi thao tác nền phải im lặng, không tự mở tab, popup hoặc notification.
- User phải chủ động opt-in trước khi extension comment, reply hoặc đăng bài.
- User có thể tạm dừng ngay và xem lịch sử hành động của tài khoản mình.
- Chỉ bài `verification_status = verified` được đưa vào tương tác chéo.
- Mọi task comment, reply và publish phải có lease, idempotency và retry an toàn.
- Cookie/CSRF chỉ tồn tại trong `chrome.storage.local` và chỉ được gửi tới
  endpoint TechHub tương ứng.
- Anon key là public; không dùng anon key làm ranh giới tin cậy.

## 3. Trải nghiệm tương tác chéo dành cho user

### 3.1 Luồng ba bước

#### Bước 1 — Chọn bài

- Chỉ hiển thị bài verified thuộc đúng username hiện tại.
- Hiển thị tiêu đề, link, ngày đăng, comment/vote và trạng thái.
- Extension lấy body bài và một số comment gần nhất khi user yêu cầu tạo thảo
  luận. Không cần lưu cookie hoặc CSRF ở server.

#### Bước 2 — Tạo kịch bản

User chỉ chọn các thông tin dễ hiểu:

- Mục tiêu: hỏi sâu, góp ý, mở rộng ý tưởng hoặc chia sẻ kinh nghiệm.
- Giọng điệu: tự nhiên, chuyên môn hoặc thân thiện.
- Số chuỗi mong muốn.
- Chế độ: luôn duyệt trước hoặc tự chạy nội dung đã đạt quality gate.

AI tạo chuỗi 2 hoặc 3 turn, luân phiên A/B. UI hiển thị preview theo dạng hội
thoại và cho phép user sửa từng turn trước khi xác nhận.

#### Bước 3 — Đưa vào mạng lưới

- Server kiểm tra bài verified, quota, consent và trạng thái user.
- Server chọn visitor hợp lệ đang online.
- Turn đầu được đưa vào queue; turn sau chỉ mở khi turn trước đã thành công.
- User thấy trạng thái dễ hiểu: Chờ người tham gia, Đang thảo luận, Hoàn thành,
  Cần xử lý hoặc Đã dừng.

### 3.2 Chuỗi thực thi thật giữa các thiết bị

Luồng A → B → A:

1. Máy visitor A claim turn 1 và đăng comment gốc.
2. TechHub trả `comment_id`; worker báo complete về `engagement-api`.
3. Server lưu `techhub_comment_id` và mở turn 2.
4. Máy author B claim turn 2 và reply với ancestry trỏ vào comment turn 1.
5. Nếu có turn 3, server chỉ mở sau khi nhận comment ID của turn 2.
6. Máy visitor A reply turn 3, sau đó server đóng thread.

Không cho phép:

- Hai turn liên tiếp do cùng một actor thực hiện.
- Turn sau chạy khi chưa có parent comment ID thật.
- Một thiết bị claim task của username khác.
- Retry tạo trùng comment đã complete.
- Thread tiếp tục nếu bài bị xóa, đóng hoặc mất trạng thái verified.

### 3.3 Quyền kiểm soát của user

Mỗi user cần có:

- Công tắc “Tham gia mạng lưới thảo luận”.
- Nút “Tạm dừng ngay”.
- Giới hạn hành động hằng ngày.
- Giờ yên lặng theo múi giờ Asia/Ho_Chi_Minh.
- Chế độ luôn preview trước khi dùng nội dung AI.
- Nút bỏ qua một task không phù hợp.
- Lịch sử bài, nội dung, thời gian, actor và kết quả.
- Chức năng ngắt kết nối thiết bị và xóa dữ liệu theo chính sách.

Consent phải được lưu có version và thời gian:

```text
consent_version
engagement_enabled
auto_publish_enabled
consented_at
paused_at
quiet_hours
daily_action_limit
```

Khi thay đổi đáng kể hành vi hoặc privacy policy, tăng `consent_version` và yêu
cầu user xác nhận lại.

## 4. AI tạo thảo luận theo ngữ cảnh

### 4.1 Dữ liệu đầu vào

- Tiêu đề bài.
- Body Markdown đã giới hạn độ dài.
- Một số comment gần nhất nếu có.
- Mục tiêu và tone user chọn.
- Các chuỗi đã dùng gần đây để tránh trùng lặp.
- Quy tắc nội dung và giới hạn độ dài từng turn.

Không gửi cookie, CSRF, email hoặc dữ liệu profile không cần thiết vào prompt.

### 4.2 Output chuẩn

Output dùng JSON schema có version:

```json
{
  "schemaVersion": 1,
  "threads": [
    {
      "goal": "ask_deeper",
      "tone": "natural",
      "turns": [
        { "actor": "A", "content": "..." },
        { "actor": "B", "content": "..." },
        { "actor": "A", "content": "..." }
      ]
    }
  ]
}
```

Tiếp tục hỗ trợ format cũ `discussion/answer` khi import, nhưng mọi dữ liệu lưu
mới phải được normalize về `threads[].turns[]`.

### 4.3 Quality gate

Mỗi thread phải đạt các điều kiện:

- Có đúng 2 hoặc 3 turn.
- Bắt đầu bằng A và luân phiên A/B.
- Nội dung liên quan ít nhất một chi tiết cụ thể trong bài.
- Không chứa câu tâng bốc chung chung hoặc kêu gọi tương tác máy móc.
- Không trùng nội dung đã dùng trong cửa sổ cấu hình.
- Không quá giống các thread khác trong cùng batch.
- Không chứa HTML/script, dữ liệu nhạy cảm hoặc URL không được phép.
- Mỗi turn nằm trong giới hạn ký tự.

Lưu thêm metadata:

```text
prompt_version
context_hash
quality_score
quality_flags
generated_at
approved_at
approved_by
```

AI chỉ tạo draft. Thread chỉ được queue sau khi user duyệt hoặc khi user đã bật
chế độ tự chạy và draft đạt ngưỡng quality cấu hình.

## 5. Tinh gọn giao diện admin

### 5.1 Cấu trúc menu đề xuất

#### Tổng quan

- Số user đang online.
- Số thread đang chờ/đang chạy/hoàn thành/lỗi.
- Tỷ lệ thành công 24 giờ và 7 ngày.
- Danh sách ngoại lệ thực sự cần admin xử lý.
- Kill switch toàn hệ thống.

#### Chiến dịch

- Chọn bài hoặc nhóm user.
- Chọn số chuỗi.
- Chọn thời gian bắt đầu.
- Chọn preset vận hành.
- Preview tác động trước khi khởi chạy.

#### Kho bài

- Draft AI.
- Chờ duyệt.
- Đã duyệt.
- Đã lên lịch.
- Đã đăng.
- Lỗi hoặc cần kiểm tra.

#### Vận hành nâng cao

- Device và trạng thái thu hồi.
- Lease, retry và task stuck.
- Log kỹ thuật.
- Quota chi tiết, jitter và cooldown.
- Cleanup và công cụ phục hồi.

### 5.2 Preset vận hành

Thay các trường kỹ thuật ở màn hình mặc định bằng ba preset:

#### An toàn

- Dùng cho pilot và user mới.
- 1–2 task/user/ngày.
- Delay dài.
- Luôn yêu cầu preview nội dung.
- Không tự động publish bài.

#### Cân bằng

- Dùng cho vận hành thường ngày.
- 3–5 task/user/ngày.
- Chạy nội dung đã được duyệt.
- Có quiet hours và quota theo cặp user.

#### Tăng tốc

- Chỉ dùng cho chiến dịch ngắn đã được phê duyệt.
- Quota cao hơn nhưng vẫn có trần.
- Chỉ bật khi tỷ lệ lỗi và session-required dưới ngưỡng.
- Tự hạ về Cân bằng khi health gate không đạt.

Các giá trị lease, interval, jitter, retry và cooldown vẫn tồn tại nhưng nằm
trong phần Nâng cao, mặc định đóng.

### 5.3 Chiến dịch nhanh

Admin có thể tạo chiến dịch trong dưới hai phút:

1. Chọn đối tượng hoặc bài.
2. Chọn số chuỗi và preset.
3. Xem preview số user, số task và thời gian dự kiến.
4. Bấm Khởi chạy.

Admin không cần tự nhập actor, lease hoặc dependency. Server tự phân công dựa
trên user online, quota, cooldown và lịch sử cặp user.

## 6. Kho bài AI và auto-post

### 6.1 API TechHub

Endpoint do nghiệp vụ cung cấp:

```text
POST https://techhub.fpt.net/api/v1/articles/
```

Payload tham chiếu:

```json
{
  "title": "Cai tien moi ngày",
  "body": "a",
  "community": 35,
  "terms": [178, 368, 274],
  "description": "",
  "featured": false,
  "main_image": null,
  "author": null,
  "body_type": "markdown"
}
```

`community = 35` và `terms = [178, 368, 274]` được lưu thành preset “Cải tiến
mỗi ngày”, không hardcode trực tiếp trong worker.

Trước khi triển khai cần thực hiện một spike thủ công trên tài khoản kiểm thử để
xác nhận:

- Header CSRF chính xác.
- Cookie/credential cần thiết.
- Response schema chứa article ID/UUID/URL như thế nào.
- Quyền đăng vào community 35 của từng user.
- Hành vi khi title/body trùng.
- Hành vi khi request timeout sau khi server đã tạo bài.
- Giới hạn request của TechHub.

### 6.2 Kiến trúc

Thêm Edge Function thứ năm `publishing-api` để tách domain tạo nội dung và đăng
bài khỏi `post-sync-api`.

Phân trách nhiệm:

- `nvidia-proxy`: gọi AI nhưng không phát token dùng chung có thể bị lạm dụng.
- `publishing-api`: kho bài, duyệt, lịch, job, lease và run history.
- `post-sync-api`: đồng bộ và xác minh bài sau khi đăng.
- Extension user: giữ session TechHub và thực hiện POST tạo bài.

Server không được nhận cookie hoặc CSRF TechHub.

### 6.3 Schema đề xuất

#### `content_presets`

```text
id
name
community_id
term_ids
body_type
default_description
enabled
created_at
updated_at
```

#### `content_items`

```text
id
preset_id
title
body
description
main_image
featured
content_hash
status              draft|review|approved|scheduled|published|rejected
ai_model
prompt_version
generated_by
approved_by
approved_at
created_at
updated_at
```

#### `publishing_schedules`

```text
id
content_item_id
target_username
scheduled_at
timezone
late_policy         publish_within_window|skip_when_late|manual_review
late_window_minutes
status              active|paused|completed|cancelled
created_by
created_at
updated_at
```

#### `publishing_jobs`

```text
id
schedule_id
target_username
scheduled_at
status              pending|claimed|published|retry_wait|ambiguous|failed|skipped
claimed_by_device
claimed_at
lease_until
attempt_count
idempotency_key
last_error_code
last_error
created_at
updated_at
```

#### `publishing_runs`

```text
id
job_id
device_id
started_at
finished_at
http_status
result_status
techhub_id
techhub_uuid
techhub_url
response_fingerprint
error_code
error_summary
```

Không lưu request header, cookie, CSRF hoặc response chứa dữ liệu session.

### 6.4 API actions đề xuất

Admin actions:

- `createContentDraft`
- `importContentBatch`
- `updateContentDraft`
- `approveContent`
- `rejectContent`
- `scheduleContent`
- `pauseSchedule`
- `cancelSchedule`
- `listContentLibrary`
- `listPublishingOps`
- `retryPublishingJob`
- `resolveAmbiguousJob`

Device actions:

- `getMyPublishingStatus`
- `claimPublishingJob`
- `completePublishingJob`
- `failPublishingJob`
- `markPublishingJobAmbiguous`
- `releaseMyPublishingClaims`

Mọi device action lấy username từ device đã đăng ký ở server, không tin
`username` do request body truyền lên.

### 6.5 Luồng auto-post

1. Admin dùng AI tạo batch draft.
2. Admin sửa và approve từng bài.
3. Admin gán content item cho user và thời điểm đăng.
4. Server tạo job với idempotency key duy nhất.
5. Đến giờ, worker trên máy user heartbeat và claim đúng job của username.
6. Worker kiểm tra live TechHub profile khớp `target_username`.
7. Worker kiểm tra consent auto-publish, trạng thái khóa và quiet hours.
8. Worker gọi API tạo bài bằng phiên TechHub cục bộ.
9. Khi thành công, worker gửi article ID/UUID/URL về `publishing-api`.
10. Server complete job và yêu cầu `post-sync-api` đồng bộ/xác minh bài.
11. Sau khi bài verified, hệ thống có thể tạo campaign thảo luận nếu lịch đã
    cấu hình tùy chọn này.

### 6.6 Chống đăng trùng

POST tạo article có thể đã thành công dù client nhận timeout. Vì vậy không retry
ngay khi kết quả không xác định.

Quy tắc:

- Trước POST, kiểm tra job chưa có kết quả published.
- Sau lỗi network/timeout, chuyển job sang `ambiguous`.
- Worker đọc danh sách bài gần đây của đúng user.
- So sánh title, content hash, thời gian và community.
- Nếu tìm thấy bài tương ứng, complete bằng ID bài đó.
- Nếu không thể xác định, yêu cầu admin kiểm tra hoặc retry thủ công.
- Không tự retry một POST ambiguous.

### 6.7 User offline hoặc trễ lịch

Hỗ trợ ba chính sách:

- `publish_within_window`: đăng khi máy online trong khoảng cho phép.
- `skip_when_late`: bỏ qua nếu trễ quá `late_window_minutes`.
- `manual_review`: đưa về admin quyết định.

Mặc định cho pilot là `manual_review` hoặc cửa sổ tối đa 120 phút.

## 7. Bảo mật và quyền riêng tư — P0

Không mở pilot rộng trước khi hoàn thành phần này.

### 7.1 Khóa quyền anon

Migration hardening mới phải:

- Thu hồi anon INSERT trực tiếp vào `users` hoặc giới hạn đúng cột an toàn.
- Không cho client tự gửi `is_admin`, `is_moderator` hoặc `is_locked`.
- Thu hồi anon write trên `settings`, `comment_templates` và `interactions`.
- Không cho anon đọc email hoặc dữ liệu user khác.
- Chuyển đăng ký user và cập nhật profile qua Edge Function.
- Chỉ service role được ghi bảng điều phối, content và publishing.

Không sửa migration cũ đã deploy; tạo migration số tăng dần mới. Khi bắt đầu
implementation phải kiểm tra migration mới nhất để tránh trùng số.

### 7.2 Role admin/moderator

Code hiện đang phát triển `is_moderator`; cần hoàn thành đồng bộ:

- Migration thêm cột và default an toàn.
- `admin-api` nhận và validate `isModerator`.
- Background kiểm tra quyền server-side cho mọi action đặc quyền.
- UI chỉ là lớp hiển thị, không được xem là security boundary.
- Test contract giữa popup, background, Edge Function và migration.

### 7.3 Device enrollment

Không cho token mới tự nhận bất kỳ username nào chỉ bằng request body.

Luồng đề xuất:

1. Extension tạo device ID/token và đọc live TechHub username.
2. Device đăng ký ở trạng thái `pending`.
3. Admin duyệt device hoặc user nhập mã mời một lần đã gắn với username.
4. Chỉ device `approved` mới được heartbeat, claim hoặc publish.
5. Admin có thể revoke từng device; lease đang giữ được release ngay.

### 7.4 Secret và logging

- Không log profile đầy đủ, email, cookie, CSRF hoặc token.
- `PROXY_TOKEN` trong extension không được xem là secret.
- AI proxy cần xác thực bằng device/admin identity và có quota server-side.
- Admin token chỉ có trên máy admin và phải hỗ trợ rotate.
- Log lỗi chỉ lưu mã lỗi, endpoint loại nào và metadata không nhạy cảm.

### 7.5 Privacy và disconnect

Privacy policy phải dùng đúng tên My Angel và mô tả:

- Dữ liệu nào được lưu local và server.
- Tài khoản có thể comment/reply/post khi user đã opt-in.
- AI provider nhận loại dữ liệu nào.
- Cách pause, disconnect, revoke device và yêu cầu xóa dữ liệu.
- Thời gian lưu event/run history.

Nếu policy nói có nút disconnect thì UI phải thực sự có chức năng này.

## 8. Thay đổi code dự kiến

### 8.1 File mới

- `publishing-client.js`
- `publishing-worker.js`
- `publishing-ui.js`
- `supabase/functions/publishing-api/index.ts`
- Migration security/role số tăng dần tiếp theo.
- Migration content/publishing số tăng dần tiếp theo.
- `scripts/test-publishing.mjs`

### 8.2 File cần cập nhật

- `background.js`: import script đúng thứ tự, message actions, alarms và worker.
- `popup.html`: user consent/lịch đăng và admin kho bài.
- `popup.css`: layout mới, không format toàn file.
- `popup.js`: gate role và điều phối UI cấp cao.
- `engagement-client.js`: actions generation/consent/status.
- `engagement-worker.js`: pause, quiet hours và task quality metadata.
- `engagement-ui.js`: wizard user và admin presets.
- `discussion-import.js`: schema version và quality validation.
- `supabase-client.js`: loại bỏ direct write nhạy cảm và log dữ liệu profile.
- `supabase/functions/engagement-api/index.ts`: consent, generation contract,
  device approval và actions user.
- `supabase/functions/admin-api/index.ts`: moderator và device approval.
- `post-sync-client.js` / `post-sync-api`: nhận kết quả bài vừa publish để sync.
- `manifest.json`: chỉ thêm quyền nếu thật sự cần; ưu tiên giữ quyền hiện có.
- `config.example.js`: URL publishing API bằng placeholder, không thêm secret user.
- `privacy_policy.html`: đồng bộ tên, hành vi và quyền dữ liệu.
- `README.md`: onboarding và cách sử dụng mới.
- `PLAN_CROSS_USER_ENGAGEMENT.md`: cập nhật consent và generation pipeline.
- `PLAN_POST_SYNC.md`: cập nhật tích hợp bài vừa auto-post.

Không đổi plain scripts sang ESM. Thứ tự `importScripts` trong background và thứ
tự script trong popup vẫn là contract runtime.

## 9. Roadmap triển khai

### Phase 0 — Security và contract nền tảng

Phạm vi:

- Migration khóa anon write/read nhạy cảm.
- Hoàn thiện role moderator.
- Device pending/approved/revoked.
- Consent versioned.
- Loại bỏ log profile và secret.
- Cập nhật privacy policy tối thiểu.

Điều kiện hoàn thành:

- Không thể tự tạo admin/moderator bằng anon key.
- Device chưa duyệt không claim task.
- User pause không nhận task mới.
- Cookie/CSRF/token không xuất hiện trong log.

Ước lượng: 3–5 ngày.

### Phase 1 — Trải nghiệm user và vertical slice thảo luận

Phạm vi:

- Wizard chọn bài → tạo draft → preview → queue.
- Một chuỗi A → B → A chạy trên hai thiết bị thật.
- Activity history, pause và skip.
- Status tiếng Việt dễ hiểu.

Điều kiện hoàn thành:

- Thread 3 turn giữ đúng ancestry.
- Restart service worker không làm mất tiến trình.
- User thấy chính xác nội dung nào đã được tài khoản mình đăng.

Ước lượng: 3–5 ngày cho UX nền và 5–8 ngày cho generation/runtime.

### Phase 2 — Admin UI tinh gọn

Phạm vi:

- Tổng quan.
- Chiến dịch nhanh.
- Ba preset vận hành.
- Phần Nâng cao cho công cụ kỹ thuật.
- Health gate và ngoại lệ cần xử lý.

Điều kiện hoàn thành:

- Admin tạo campaign tiêu chuẩn trong dưới hai phút.
- Màn hình mặc định không hiển thị lease/jitter/device token.
- Kill switch và pause user vẫn truy cập nhanh.

Ước lượng: 4–6 ngày.

### Phase 3 — Kho bài AI

Phạm vi:

- Content preset.
- Generate/import batch.
- Editor và trạng thái review/approved.
- Content hash và chống trùng trong kho.
- Gán bài cho user và lịch.

Điều kiện hoàn thành:

- Nội dung chưa approved không tạo publishing job.
- Admin lọc và quản lý được toàn bộ vòng đời content item.
- Preset community/terms được validate server-side.

Ước lượng: 3–5 ngày.

### Phase 4 — Auto-post worker

Phạm vi:

- `publishing-api` và schema job/run.
- Claim/lease/complete/fail/ambiguous.
- Gọi API TechHub bằng session local.
- Kiểm tra live username.
- Xử lý offline, late policy và timeout ambiguous.
- Tích hợp post sync sau khi đăng.

Điều kiện hoàn thành:

- Không đăng trùng trong test lỗi/restart.
- Job không chạy trên tài khoản TechHub khác target user.
- Server không nhận cookie/CSRF.
- Bài đăng thành công được sync và verified.

Ước lượng: 7–10 ngày.

### Phase 5 — Pilot và hardening

Phạm vi:

- Pilot 5–10 user trong hai tuần.
- Thu thập metric và phản hồi.
- Sửa lỗi nội dung, session, retry và UX.
- Viết runbook deploy/rollback/revoke.

Gate mở rộng:

- Tỷ lệ task hợp lệ thành công ≥ 95%.
- Không có bài đăng trùng.
- Không có sự cố quyền hoặc dữ liệu nhạy cảm.
- Ít nhất 70% user pilot tiếp tục bật sau tuần đầu.
- Không có phản ánh tài khoản tự hành động ngoài consent.

Tổng ước lượng: 5–7 tuần phát triển cho một developer, sau đó pilot hai tuần.

## 10. Kiểm thử bắt buộc

### 10.1 Security contract

- Anon không insert/update `is_admin`, `is_moderator`, `is_locked`.
- Anon không write settings/templates/interactions.
- User không đọc email của user khác.
- Device pending/revoked không claim task hoặc publishing job.
- Device không đổi username bằng request body.
- Moderator không gọi action chỉ dành cho admin.

### 10.2 Engagement

- Import schema cũ và schema version mới.
- Reject 1 turn, hơn 3 turn, actor không luân phiên hoặc content rỗng.
- Hai device claim đồng thời chỉ một device nhận task.
- Turn 2 chỉ mở sau khi turn 1 có TechHub comment ID.
- Restart worker tiếp tục đúng turn.
- Complete lặp lại không tạo reward hoặc task trùng.
- Pause/quiet hours/daily limit hoạt động đúng.
- Bài unverified không được tạo thread.

### 10.3 Publishing

- Nội dung chưa approved không được schedule/publish.
- Chỉ target username claim được job.
- Hai máy cùng username không đăng trùng.
- Timeout sau POST chuyển `ambiguous`, không auto retry.
- Dò thấy bài vừa tạo thì complete job bằng ID thật.
- Late policy hoạt động đúng.
- Restart service worker không làm mất lease logic.
- Bài thành công được đưa qua post sync.

### 10.4 UI

- User thường, moderator và admin thấy đúng menu.
- Side panel và full tab cùng hoạt động.
- Admin basic flow không lộ trường kỹ thuật.
- Preview hiển thị đúng từng actor/turn.
- Pause và disconnect có feedback rõ ràng.

### 10.5 Lệnh kiểm tra

```bash
node scripts/test-engagement.mjs
node scripts/test-post-sync.mjs
node scripts/test-publishing.mjs
node --check background.js
node --check popup.js
node --check engagement-client.js
node --check engagement-worker.js
node --check engagement-ui.js
node --check discussion-import.js
node --check post-sync-client.js
node --check post-sync-worker.js
node --check post-sync-ui.js
node --check publishing-client.js
node --check publishing-worker.js
node --check publishing-ui.js
git diff --check
```

Không thực hiện live write vào TechHub trong test tự động. API tạo bài chỉ được
kiểm tra thủ công trên tài khoản/bài kiểm thử đã được cho phép.

## 11. Thứ tự deploy dự kiến

Mỗi phase phải có migration/function riêng, không chạy lại toàn bộ
`scripts/setup-supabase.sh` trên project đang hoạt động.

1. Backup schema và kiểm tra migration đã áp dụng.
2. Deploy `admin-api`/`engagement-api` tương thích cả schema cũ và mới nếu cần.
3. Áp migration security/role.
4. Deploy extension có consent, device enrollment và UI mới.
5. Áp migration content/publishing.
6. Deploy `publishing-api`.
7. Deploy extension có publishing worker nhưng để feature flag tắt.
8. Chạy smoke test admin và một user pilot.
9. Bật feature flag theo từng user.
10. Theo dõi metric trước khi mở rộng.

Rollback phải ưu tiên tắt feature flag/kill switch, không xóa dữ liệu hoặc
rollback migration bằng thao tác phá hủy.

## 12. Metric sản phẩm và vận hành

### 12.1 Engagement

- Thread completion rate.
- Turn success rate theo action comment/reply.
- Thời gian trung vị từ turn 1 đến thread hoàn thành.
- Tỷ lệ duplicate/rejected/blocked.
- Số user online đủ điều kiện.
- Số task mỗi user và mỗi cặp user.
- Tỷ lệ user pause/opt-out.
- Tỷ lệ draft được user duyệt không cần sửa.

### 12.2 Publishing

- Số draft được tạo/duyệt/schedule/published.
- Publish success rate.
- Số job late, ambiguous và manual review.
- Số bài trùng: mục tiêu bằng 0.
- Thời gian lệch so với lịch đăng.
- Tỷ lệ bài được sync và verified sau khi đăng.

### 12.3 Adoption

- Tỷ lệ cài đặt hoàn tất onboarding.
- Tỷ lệ opt-in engagement và auto-publish.
- Tỷ lệ user còn bật sau 7 và 14 ngày.
- Thời gian admin tạo một campaign.
- Số lần user phải can thiệp thủ công.

Không lưu nội dung nhạy cảm trong log metric.

## 13. Rủi ro và biện pháp

### Nội dung AI kém tự nhiên

- Preview mặc định trong pilot.
- Quality gate, similarity check và prompt version.
- Cho user sửa trước khi queue.
- Theo dõi tỷ lệ draft bị sửa/reject.

### User mất niềm tin vì tài khoản tự hành động

- Opt-in rõ ràng theo từng nhóm chức năng.
- Pause ngay, quiet hours, history và disconnect.
- Không thay đổi consent từ phía admin.

### Giả mạo username/device

- Device enrollment pending/approved.
- Mã mời một lần gắn với username.
- Kiểm tra live TechHub profile trước action nhạy cảm.

### Đăng trùng khi timeout

- Trạng thái ambiguous.
- So khớp bài gần đây bằng content hash và cửa sổ thời gian.
- Không tự retry POST ambiguous.

### TechHub thay đổi API

- Chuẩn hóa adapter trong worker.
- Lưu error code, không lưu response nhạy cảm.
- Feature flag và kill switch.
- Contract test fixture không gọi API thật.

### Vi phạm quy tắc vận hành nội bộ

- Xác nhận phạm vi được phép với đơn vị quản lý TechHub trước khi mở rộng.
- Có quota thấp, consent, audit history và cơ chế dừng toàn hệ thống.
- Nội dung do admin/user duyệt, không tối ưu theo hướng spam tương tác.

## 14. Scorecard 9/10

Trọng số đề xuất:

- Tin cậy và bảo mật: 25%.
- Giá trị cốt lõi: 25%.
- Độ ổn định: 20%.
- Dễ dùng: 15%.
- Minh bạch và kiểm soát: 10%.
- Vận hành: 5%.

Không được tự nhận mức 9/10 nếu bảo mật hoặc consent dưới 8/10, dù các metric
tương tác cao.

## 15. Definition of Done

Hệ thống đạt mục tiêu phát hành khi:

- User hiểu được lợi ích trong onboarding đầu tiên.
- User tạo và đưa một chuỗi thảo luận vào mạng lưới trong dưới ba phút.
- Chuỗi 3 turn chạy trên hai máy thật, đúng ancestry và phục hồi sau restart.
- Admin tạo campaign tiêu chuẩn trong dưới hai phút.
- Admin quản lý kho bài từ draft đến published trên một luồng rõ ràng.
- Auto-post đúng user, đúng giờ trong cửa sổ cho phép và không đăng trùng.
- Bài vừa đăng được sync và verified trước khi tham gia engagement.
- Tỷ lệ task hợp lệ thành công ít nhất 95% trong pilot.
- 100% user đã opt-in trước action nền.
- Pause có hiệu lực trong tối đa một chu kỳ worker.
- Không có đường tự cấp quyền bằng anon key.
- Không có cookie, CSRF, admin token, proxy token hoặc device token trong log.
- Privacy policy khớp với chức năng thật.
- Test liên quan pass, `git diff --check` pass và không có secret trong diff.

## 16. Thứ tự ưu tiên đề xuất

1. Security hardening, role và device enrollment.
2. Consent, pause và activity history.
3. Vertical slice: chọn bài → AI draft → preview → A/B/A thật.
4. Tinh gọn admin UI bằng preset và chiến dịch nhanh.
5. Kho bài AI và quy trình duyệt.
6. Publishing worker, chống trùng và post-sync.
7. Pilot, đo metric và hardening trước khi phát rộng.

Không nên xây toàn bộ màn hình kho bài trước khi vertical slice thảo luận chạy
ổn định trên ít nhất hai thiết bị thật.
