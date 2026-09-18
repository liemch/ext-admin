# Kế hoạch phát triển My Angel thành sản phẩm 9/10

> Bản rà soát ngày 17/09/2026, đối chiếu source tại commit `840604e`.
> Đây là đặc tả mục tiêu triển khai; không phải thông báo các tính năng đã chạy
> trên production. Trạng thái migration/function remote chưa được xác minh.

## 0. Cách đọc và khác biệt cần nhìn thấy

### 0.1 Hiện trạng đã kiểm tra trong source

- Đã có: copy prompt, nhập JSON cho bài của mình; thread A/B 2–3 turn;
  claim task, comment ID, dependency, retry và điểm/Ultra. Không xây lại queue này.
- Đã có: moderator trong UI/background, `admin-api.isModerator` và migration
  `016_add_moderator_role.sql`. Cần xác minh deploy và test quyền thực tế;
  không tiếp tục ghi đây là tính năng chưa có code.
- Đã có: cache device dùng chung engagement/post-sync và đọc live profile.
- Chưa có: consent riêng của actor, hộp duyệt việc được giao, trạng thái chờ
  người phù hợp, kho bài có phiên bản và hàng đợi đăng bài.
- Đồng bộ mặc định hiện là đồng bộ bài cá nhân; leader là đường tương thích cũ
  theo phần đầu `PLAN_POST_SYNC.md`. User không được quét feed cộng đồng.
- Test offline đã báo 278 engagement + 159 post-sync ở lần bàn giao trước.
  Các con số này không chứng minh chạy đúng trên hai máy hoặc database production.

### 0.2 Trước và sau — kết quả người dùng phải thấy

**Tạo thảo luận:** hiện user copy prompt, dán JSON và gửi chuỗi. Bản mới dẫn qua
Chọn bài → Copy prompt hoặc Tạo bằng AI → Dán kết quả → Xem hội thoại → Xác nhận;
hiện đúng số chuỗi, số comment/reply dự kiến, trạng thái chờ và link kết quả.

**Kết nối user:** hiện có phân công actor và task. Bản mới cho thấy “Chờ thành viên
phù hợp”, “Chờ Lan duyệt”, “Lan đã bình luận”, “Đang chờ bạn trả lời”; user biết
tài khoản mình sẽ nói gì. Thành viên có thật, nhưng lời thoại có thể do AI soạn;
không gọi đây là ý kiến tự phát của thành viên.

**Admin điều phối:** hiện có nhiều ô số và công cụ vận hành cùng màn hình. Bản mới
chỉ cần nhóm tham gia, bài mục tiêu, số chuỗi, khung giờ và preset; có dự báo thiếu
người/quota trước khi chạy và danh sách lỗi kèm hành động sửa.

**Đăng bài:** hiện chưa có kho/lịch publish. Bản mới admin nhập kho AI đã chuẩn bị,
duyệt bản nội dung, chia bài cho user, xem lịch tuần và tình trạng từng lần đăng;
user thấy bài được giao, tác giả, giờ đăng và có quyền từ chối.

**Niềm tin:** hiện admin điều phối pool mặc định bật. Bản mới admin đặt giới hạn
vận hành, user quyết định tham gia và nội dung được phép dùng tên mình. Không
chuyển user cũ sang auto-post chỉ vì nâng cấp extension.

### 0.3 Các quyết định sản phẩm của bản kế hoạch này

- Giữ copy prompt → ChatGPT/Gemini → nhập JSON làm đường chính của bản đầu.
  “Tạo bằng AI trong extension” là lựa chọn bổ sung, có quota và dự toán chi phí.
- Admin tạo kho nội dung; bài mặc định đăng bằng **tài khoản user được gán**.
  Muốn đăng bằng tài khoản admin thì gán job cho admin, chạy trên máy admin.
  Không dùng trường `author` để giả định có thể đăng hộ một tài khoản khác.
- Một chuỗi có visitor A và tác giả B; chỉ 2–3 turn ở bản đầu.
- Một bản bài được cấp cho một lịch/user ở MVP. Không phát cùng bài cho nhiều
  tài khoản. Nhân bản để biên tập phải qua kiểm tra trùng và duyệt lại.
- “Đến giờ đăng” nghĩa là chạy khi browser/thiết bị sẵn sàng trong cửa sổ đã chọn.
  Không cam kết chạy khi máy tắt hoặc trình duyệt đã thoát.
- Pilot luôn duyệt từng nội dung. Sau khi đạt gate mới mở **Tự động có kiểm soát**:
  user tự cấp quyền theo phạm vi chủ đề, tone, quota và giờ chạy; nội dung ngoài
  phạm vi vẫn phải duyệt. Điểm AI không bao giờ tự tạo quyền phát ngôn thay user.
- Chiến dịch Tăng tốc và lịch lặp vô hạn vẫn là phần sau pilot, tách khỏi quyền
  tự động có kiểm soát để user không vô tình bật cả ba hành vi cùng lúc.

### 0.4 Quan hệ với các plan cũ

`PLAN_CROSS_USER_ENGAGEMENT.md` hiện cấm user tự bật/tắt pool và khởi tạo tới
40 chuỗi/bài. Kế hoạch mới **đề xuất thay đổi contract đó**: user được pause,
admin vẫn giữ trần quota; batch mới mặc định 3 chuỗi. Không thay quota/job cũ
một cách âm thầm. Khi thực thi phải cập nhật đồng thời plan cũ và test liên quan.
Trong thời gian chưa triển khai, source và contract đang chạy vẫn là hiện trạng.

Chi tiết nghiệp vụ có thể chuyển thành ticket và bộ nghiệm thu nằm ở mục 17–22.

Đọc nhanh: mục 0 cho khác biệt; 17 cho màn hình; 18–20 cho contract; 21 cho
thứ tự làm; 22 cho demo và cách đo. Mục 1–16 giữ định hướng tổng thể. Khi một
quy tắc được mô tả chi tiết hơn ở 17–22, dùng đặc tả chi tiết đó để viết test.

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
- Cách tạo: copy prompt/dán JSON hoặc AI tích hợp nếu đã bật.
- Pilot luôn duyệt trước; tự chạy nội dung đã duyệt không đồng nghĩa tự duyệt draft.
- Sau pilot có thể chọn Tự động có kiểm soát theo policy do chính user cấu hình;
  đây là opt-in mới, không kế thừa từ công tắc tham gia mạng lưới.

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
- Sau pilot: lựa chọn Tự động có kiểm soát với phạm vi chủ đề, tone được phép,
  quota, giờ chạy và ngày hết hạn; mặc định tắt.
- Quyền phê duyệt gắn với revision; duyệt của chủ bài không thay duyệt của visitor.
- Nút bỏ qua một task không phù hợp.
- Lịch sử bài, nội dung, thời gian, actor và kết quả.
- Chức năng ngắt kết nối thiết bị và xóa dữ liệu theo chính sách.

Consent phải được lưu có version và thời gian:

```text
consent_version
engagement_enabled
auto_publish_enabled
delegated_engagement_enabled
delegation_policy_version
delegation_expires_at
consented_at
paused_at
quiet_hours
daily_action_limit
```

Phạm vi chi tiết của Tự động có kiểm soát lưu ở policy version bất biến riêng,
không nhét JSON có thể bị sửa tại chỗ vào profile. Mỗi lần thay đổi tạo version
mới và audit version đã được dùng cho từng action.

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

AI chỉ tạo draft. Pilot chỉ queue sau khi các actor liên quan phê duyệt đúng bản
nội dung sẽ dùng tên mình. Sau pilot, standing authorization hợp lệ có thể thay
click duyệt từng lần theo mục 18.1. Điểm AI chỉ hỗ trợ đánh giá; không phải quyền
phê duyệt và không được coi là bằng chứng nội dung đúng.

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

- Chưa bật trong MVP; chỉ đánh giá sau pilot.
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
status              draft|review|approved|rejected|archived
current_revision_id
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
content_revision_id
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
status              pending|claimed|executing|published|retry_wait|ambiguous|failed|skipped|cancelled|expired|session_required
content_revision_id
lease_generation
execution_started_at
request_id
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

Thêm `content_revisions` lưu snapshot bất biến: title/body/preset/terms/hash,
người duyệt, thời điểm duyệt. Trạng thái “Đã lên lịch/Đã đăng” trên kho bài là
trạng thái tổng hợp từ schedule/job; không dùng một cột content để biểu diễn
đồng thời trạng thái biên tập và trạng thái chạy. Chi tiết ở mục 19.

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
- `beginPublishingExecution`
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

Mặc định pilot là `manual_review`. Admin có thể chọn `publish_within_window`
với cửa sổ 120 phút sau giờ hẹn; hết cửa sổ chuyển expired, không tự đăng bù.
Job đã ở executing/ambiguous luôn được đối soát, không expire rồi tạo job thay thế.

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

Source tại `840604e` đã có `is_moderator`, migration 016, nhánh `isModerator`
trong `admin-api`, allowlist background và UI. Phần còn lại:

- Xác minh migration 016 và phiên bản `admin-api` đã deploy.
- Kiểm tra quyền bằng request trực tiếp tới API và database trên môi trường test.
- Kiểm tra lại role/lock trên server mỗi action đặc quyền; background là lớp
  kiểm tra phía client, không phải kiểm tra server-side.
- UI chỉ là lớp hiển thị, không được xem là security boundary.
- Test contract giữa popup, background, Edge Function và migration.

### 7.3 Device enrollment

Không cho token mới tự nhận bất kỳ username nào chỉ bằng request body.

Luồng đề xuất:

1. Extension tạo device ID/token và đọc live TechHub username.
2. Device đăng ký ở trạng thái `pending`.
3. Admin duyệt device hoặc user nhập mã mời một lần đã gắn với username.
4. Chỉ device `approved` mới được heartbeat, claim hoặc publish.
5. Admin có thể revoke từng device; chặn claim/begin mới ngay. Lease chưa execute
   được release; lease đã execute giữ để đối soát, không phát lại POST.

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
- Migration identity/consent và hardening grants số tăng dần tiếp theo.
- Tái sử dụng migration 016 đã có; không tạo lại cột moderator trong migration mới.
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
- Xác minh deploy/test role moderator đã có trong source.
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

Tổng các khoảng trên: 25–39 ngày công cho một developer, khoảng 5–8 tuần làm
việc, sau đó pilot hai tuần lịch. Đây là dự toán, chưa gồm thời gian chờ xác
minh API hoặc kết nối hai thiết bị. Chốt lại sau spike ở ticket R0.

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
3. Xác minh migration 016 đã có; áp schema bổ sung tương thích. Siết các grants
   còn lại sau khi đã chuyển client cũ sang API theo mục 20.4.
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
- Auto-post đúng user; mục tiêu bắt đầu trong 5 phút sau giờ hẹn khi thiết bị,
  browser, phiên và approval đủ điều kiện. Đo p95 trên cohort đủ điều kiện;
  trường hợp offline/late báo riêng. Không có duplicate quan sát được trong pilot.
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

## 17. Đặc tả màn hình và thao tác nhìn thấy được

### 17.1 User — Bài viết và Thảo luận của tôi

Mỗi bài có nút **Tạo thảo luận**. Bài chưa verified hiển thị lý do và nút Đồng bộ;
không để user bấm tạo rồi mới nhận lỗi kỹ thuật.

Wizard giữ dữ liệu khi đóng panel và mở lại:

1. **Nội dung bài:** title, đoạn tóm tắt, link và thời điểm đọc gần nhất.
2. **Soạn hội thoại:** mặc định 3 chuỗi, mục tiêu Hỏi sâu; nút Copy prompt và ô
   Dán JSON. AI tích hợp chỉ xuất hiện khi server bật tính năng.
3. **Xem trước:** hội thoại gắn nhãn “Thành viên” / “Tác giả”; cho sửa, bỏ một
   chuỗi, xem lỗi tại đúng chuỗi/turn. Chưa ghép người thì không hiển thị tên giả.
4. **Xác nhận:** “3 chuỗi, tối đa 9 comment/reply; phụ thuộc thành viên online”.
   Hiển thị quota còn lại và thời hạn chờ. Không hứa số lượt chắc chắn nhận được.

Sau xác nhận, trang **Thảo luận của tôi** có ba vùng:

- Bài của tôi đang được thảo luận: tiến độ từng chuỗi và link comment thật.
- Việc cần tôi duyệt: nội dung dùng tài khoản mình, bài đích, actor còn lại;
  nút Đồng ý / Từ chối, không bắt user hiểu JSON.
- Hoạt động đã thực hiện: comment/reply, thời gian, nội dung và kết quả.

Tiêu chí UI: side panel hiển thị hội thoại một cột; full tab có danh sách và
chi tiết cạnh nhau. JSON thô nằm trong vùng mở rộng, không thay preview.

### 17.2 Admin — Thiết lập tương tác

Màn hình cơ bản chỉ có năm quyết định: nhóm user, bài đích, số chuỗi/bài,
khung giờ, preset. Các trần kỹ thuật do server quản lý.

Preset pilot đề xuất, cần hiệu chỉnh theo số liệu thực tế:

- An toàn: tối đa 2 hành động/user/ngày, 1 chuỗi mới/bài/ngày.
- Cân bằng: tối đa 5 hành động/user/ngày, 3 chuỗi mới/bài/ngày.
- Khoảng cách tối thiểu giữa hai hành động cùng user: 10 phút ở pilot;
  lịch chung không thay thế giới hạn riêng do user đặt thấp hơn.
- Batch import tối đa 50 chuỗi để giữ tương thích; chỉ một phần được lập lịch
  trong quota. Không coi 50 chuỗi là chỉ tiêu phải chạy ngay.

Một **hành động** = một comment hoặc một reply; một chuỗi ba turn tiêu thụ
2 hành động của A và 1 của B. UI phải dùng đúng đơn vị; vote có quota riêng,
không tự thêm vào chiến dịch thảo luận.

Preview trước khi chạy trả về: số bài hợp lệ, thành viên đủ điều kiện, chuỗi
có thể xếp ngay, chuỗi chờ và nguyên nhân. Ví dụ chỉ có một user online thì
hiện “Chưa đủ hai tài khoản”, vẫn lưu draft nhưng không tạo task giả.

### 17.3 Admin — Kho bài và lịch tuần

Luồng chính giữ đúng nhu cầu admin chuẩn bị AI bên ngoài:

1. **Tạo prompt kho bài:** chủ đề, đối tượng, số bài và cấu trúc mong muốn.
2. **Nhập kho:** dán JSON hoặc chọn file JSON UTF-8, giới hạn 20 bài/batch và
   1 MB để pilot dễ kiểm soát. Mỗi item gồm title, body, description, preset.
3. **Kiểm tra:** lỗi chỉ rõ item/field; mặc định import nguyên batch hoặc không
   import gì. Cho bỏ item lỗi rồi kiểm tra lại, không âm thầm bỏ mất bài.
4. **Biên tập/duyệt:** preview Markdown đã sanitize, cảnh báo gần trùng, tạo
   revision bất biến khi duyệt. AI tích hợp có thể thêm sau mà dùng cùng workflow.
5. **Phân bài:** chọn các bài approved và user đủ điều kiện; xem trước ánh xạ
   bài → user → giờ. Mặc định mỗi user tối đa một bài/ngày trong pilot.
6. **Lịch tuần:** lọc theo user/trạng thái, click để xem đúng bản sắp đăng;
   nút Đổi giờ, Tạm dừng, Hủy và Xem trên TechHub.

MVP hỗ trợ lập lịch một lần hoặc phân ngày cho batch hữu hạn. Kho hết thì dừng
và báo trong dashboard, không tự sinh bài rồi đăng để lấp lịch.

User thấy **Bài sắp đăng của tôi**, preview đầy đủ, giờ địa phương, tài khoản
đăng và lựa chọn Chấp nhận / Từ chối. Opt-in auto-post chỉ cho phép chức năng;
approval của revision mới là quyền đăng nội dung cụ thể.

## 18. Contract vận hành thảo luận

### 18.1 Ai duyệt và ai được sửa

- Trong pilot, các quy tắc dưới đây yêu cầu duyệt từng `script_revision`.
- Tác giả B duyệt kịch bản trên bài của mình; việc đó không thay visitor A
  đồng ý cho hệ thống nói thay tài khoản A.
- Sau khi ghép A, A duyệt các turn được giao cùng ngữ cảnh toàn chuỗi. B cũng
  phải duyệt lại nếu nội dung đã thay đổi sau lần B xác nhận.
- Chỉ queue khi approval của cả hai gắn với cùng `script_revision`/hash.
- Sửa turn chưa chạy tạo revision mới và hủy approval của phần chịu ảnh hưởng.
  Không sửa/xóa comment đã đăng trên TechHub chỉ vì đổi draft trong hệ thống.
- Sau khi A đã đăng turn đầu, giữ A cho turn ba. Không đổi actor giữa chừng
  để một người khác giả làm cùng người đang nói.

Sau pilot, user có thể tự bật **Tự động có kiểm soát**. Khi đó approval của actor
có thể được thỏa bởi một standing authorization còn hạn và khớp toàn bộ policy:
nhóm/chủ đề được phép, tone, độ dài, quota, quiet hours và mức rủi ro nội dung.
Server lưu `delegation_policy_version` cùng revision đã queue để audit. Sửa policy,
pause, revoke device hoặc hết hạn làm mất quyền cho mọi turn chưa bắt đầu; nội dung
ngoài policy quay về `awaiting_approval`, không tự nới policy hoặc bỏ qua user.

### 18.2 Ghép người và chờ

Visitor cần: device approved, không bị khóa/revoke, consent hợp lệ, quota còn,
không trùng tác giả, chưa bị user bỏ qua/cấm ghép, có heartbeat trong 5 phút.
Trạng thái online chỉ là tín hiệu gần đây, không bảo đảm request tiếp theo chạy.

MVP giữ điều kiện pool hiện có: mỗi thành viên có bài open + verified. Nếu muốn
nhận thành viên chỉ đóng góp nhưng chưa có bài, phải tách policy và test riêng.

Ưu tiên người ít đóng góp hôm nay, ít ghép với tác giả gần đây; dùng thời gian
chờ và ID làm tie-break để có kết quả kiểm thử được. Giới hạn một chuỗi active
cho cùng cặp/bài; reserve quota trước khi mở chuỗi, giải phóng phần chưa dùng
khi hủy/hết hạn. Tổng quota hữu hiệu là mức thấp nhất của admin và user.

Chờ ghép/duyệt tối đa 24 giờ trong pilot. Trước comment đầu có thể ghép lại
visitor nhưng phải xin approval mới. Sau comment đầu, offline thì chờ cùng actor;
quá hạn chuyển Cần xử lý, không tự tạo lời thoại thay người.

### 18.3 Trạng thái và pause

Trạng thái sản phẩm đề xuất:

```text
draft → awaiting_match → awaiting_approval → ready → running → completed
                 ↘ expired       ↘ rejected       ↘ paused / blocked / cancelled
```

Đây là mô hình đích; khi triển khai phải map/migrate các trạng thái hiện có,
không đổi enum cũ mà bỏ xử lý thread đang chạy.

Pause kiểm tra ở server lúc claim và ngay trước khi cho phép execution; worker
kiểm tra lại local stop/session trước POST. Hành động đã gửi tới TechHub có thể
vẫn hoàn tất, nên UI ghi “Đã dừng việc mới; một yêu cầu đang gửi có thể hoàn tất”.
Không thể thu hồi HTTP request đã được TechHub xử lý.

Reply chỉ chạy nếu parent còn tồn tại, đúng bài và có ID đã ghi nhận. Parent
bị xóa/bài đóng → blocked có lý do; không chuyển reply thành comment gốc.

### 18.4 Prompt và chất lượng có thể kiểm thử

Giữ hai adapter đầu vào: mảng thread hiện có và envelope `schemaVersion: 1`.
Cả client lẫn server normalize cùng quy tắc. Server tự gán actor, post và quota;
không nhận role/user ID do AI trả về như quyền thực thi.

Pilot: 2–3 turn, 20–600 ký tự/turn, tối đa 50 thread/batch. Chuẩn hóa Unicode
và whitespace để phát hiện trùng tuyệt đối. So gần trùng chỉ cảnh báo cho người
duyệt; ngưỡng phải hiệu chỉnh từ corpus, chưa dùng một điểm AI tùy ý để auto-post.

Prompt phải coi body/comment nguồn là dữ liệu, không thực thi chỉ dẫn nằm trong
bài. Không bịa trải nghiệm “tôi đã áp dụng” hoặc kết quả cải tiến không có nguồn.
Không cho nội dung AI tự thay URL đích, username, quota hay community.

Tạo bộ 20 bài kiểm thử có bài ngắn/dài/thiếu body/đã có comment. Nghiệm thu:
ít nhất 16/20 kịch bản được người duyệt chấp nhận sau tối đa một lần sửa;
không có tuyên bố trải nghiệm/kết quả bịa trong bộ đã duyệt.

### 18.5 Ultra và đóng góp

Giữ ledger idempotent theo task đã xác nhận, không thưởng cho pending/skip.
Ultra chỉ đổi ưu tiên xếp hàng; không vượt consent, quota hoặc tạo tài khoản giả.
Nếu dùng credit mà chưa mở turn đầu và yêu cầu hết hạn/hủy vì thiếu người,
hoàn credit một lần qua ledger sự kiện duy nhất. UI giải thích rõ ưu tiên không
đảm bảo số comment hoặc thời gian hoàn thành.

## 19. Contract kho bài và đăng bài an toàn khi mất kết nối

### 19.1 Phiên bản nội dung và phân bổ

Schedule trỏ tới `content_revision_id`, không đọc body đang chỉnh ở content item.
Hash gồm title, body, description, community, terms, body_type và tùy chọn ảnh.
Sửa một trường tạo revision mới, cần duyệt lại; lịch đã có vẫn giữ revision cũ
cho đến thao tác thay bản có xác nhận rõ.

Thêm record approval theo `(revision_id, target_username)` và audit actor/time.
Chỉ target user được đồng ý dùng tên mình. Admin được approve chất lượng và lập
lịch, không giả lập approval của user. MVP một revision chỉ được reserve cho
một schedule; constraint unique bảo vệ khi hai admin phân kho đồng thời.

Lưu `scheduled_at` bằng UTC, timezone dùng `Asia/Ho_Chi_Minh` để nhập/hiển thị.
Nếu lịch nằm trong giờ yên lặng, yêu cầu chọn giờ khác trước khi lưu. Nếu user
đổi giờ yên lặng sau đó, đánh dấu xung đột và áp late policy, không âm thầm dồn
nhiều bài đăng cùng lúc khi bật máy lại.

### 19.2 Request lifecycle và giới hạn bảo đảm

```text
pending → claimed → executing → published
             ↓           ↓
         retry_wait   ambiguous → published hoặc manual_review
```

`manual_review` là hàng xử lý UI cho job ambiguous/failed, không thêm một state
DB khác không được định nghĩa. `session_required`, `expired`, `cancelled` và
`skipped` có reason code, không được báo như published.

- Claim atomically trả job, revision snapshot và `lease_generation` tăng dần.
- `beginPublishingExecution` kiểm tra lease/owner/generation, approval, quota,
  consent/role và state; ghi execution intent trước khi worker gửi POST.
- `complete/fail` phải gửi job ID, generation và request ID; replay complete
  cùng kết quả trả lại kết quả cũ, không sinh event/điểm lần hai.
- Lease hết khi mới claimed và chưa begin: có thể trả queue.
- Lease hết sau begin hoặc worker chết giữa POST và complete: chuyển ambiguous,
  không cho máy thứ hai POST cùng job.
- Hai request begin/claim đồng thời phải có integration test database thật ở dev.

Unique idempotency key trong Supabase chỉ chống trùng job, không tạo bảo đảm
exactly-once cho API TechHub. Nếu TechHub không có idempotency key hoặc receipt
có thể kiểm chứng thì không thể hứa tuyệt đối không trùng trong mọi lỗi mạng.
MVP ưu tiên chặn gửi lại khi chưa rõ kết quả và cho admin đối soát.

### 19.3 Đối soát ambiguous

Chỉ đọc bài gần đây của target user với budget hữu hạn; không quét feed cộng đồng.
So username, community, title, body chuẩn hóa và cửa sổ quanh execution_started_at.
Một ứng viên khớp rõ → ghi bằng chứng/ID và complete; nhiều ứng viên hoặc thiếu
body → giữ ambiguous. Không tìm thấy ngay không chứng minh POST chưa thành công.

Admin có thể gắn ID bài đã đăng hoặc xác nhận bỏ lần đăng. Retry thủ công cần
hiển thị rủi ro trùng, audit quyết định và lần đối soát cuối; worker cũ không
được tiếp tục gửi request sau khi job đã được giải quyết.

Phân loại lỗi: 401 cần phiên; 403 cần xác định hết phiên hay thiếu quyền community;
429 backoff theo hướng dẫn response nếu có; validation error cần sửa/duyệt lại;
timeout/network/5xx sau begin xử lý ambiguous nếu chưa chứng minh chưa tạo bài.

### 19.4 Published không đồng nghĩa verified

Sau POST thành công, lưu receipt local trước rồi complete server; nếu mất mạng
chỉ retry complete, không retry POST. UI ghi “Đã đăng — đang đồng bộ”. Worker
thực hiện đọc lại chi tiết bài để đưa qua post-sync, không bắt Edge Function gọi
TechHub với cookie vốn chỉ nằm ở máy.

State verified hiện dựa dữ liệu do client gửi và username device; đây không phải
bằng chứng xác thực độc lập từ TechHub. Nếu cần chống client đã sửa giả receipt,
phải có nguồn xác minh độc lập được TechHub hỗ trợ hoặc bước duyệt/đối soát admin.
MVP ghi rõ mô hình tin cậy là nhóm thiết bị nội bộ đã được duyệt.

## 20. Hợp đồng xác thực, quyền và tương thích nâng cấp

### 20.1 Bootstrap danh tính

Đọc live profile local giúp tránh nhầm tài khoản nhưng server không thể tin một
request tự khai “đã kiểm tra profile”. Pilot dùng lời mời một lần gắn username,
admin giao mã qua kênh đã xác minh; lưu hash, hạn dùng 24 giờ, consume atomically
và giới hạn thử. Device mới pending chỉ xem trạng thái đăng ký, không claim.

Mã mời là quyền đăng ký do admin cấp, không phải SSO TechHub. Đổi username yêu
cầu enrollment mới; token cũ không được tự rebind hoặc xóa revoked qua heartbeat.
Device bị khóa/revoke phải bị kiểm tra tại mọi API, kể cả complete và AI proxy.
Kết quả đã thực thi trước revoke cần đường reconcile có audit, không bỏ receipt.

Migration 016 giới hạn cột quyền nhưng chưa bảo vệ sở hữu từng dòng profile;
phải chuyển read/write nhạy cảm sang API có danh tính trước khi revoke direct
access. Không mô tả 016 như hoàn tất toàn bộ security roadmap.

### 20.2 Vai trò và consent

- User: bài/approval/lịch/hoạt động của mình, pause và disconnect.
- Moderator: quyền Auto comment/Hẹn xóa hiện hành; không mặc định được duyệt
  kho, phân bài hoặc tạo campaign khi chưa có quyết định riêng.
- Admin: cấu hình trần, duyệt kho, phân lịch và vận hành; không ghi consent hộ user.
- Server: xác định actor từ credential, kiểm tra ownership trên mọi ID được gửi;
  danh sách theo user không đủ nếu endpoint lấy chi tiết vẫn đọc ID bất kỳ.

Standing authorization chỉ do user tạo/sửa/tắt trên thiết bị đã approved. Admin
có thể đặt trần chặt hơn hoặc tắt feature toàn hệ thống, nhưng không thể bật hay
mở rộng policy thay user. Audit phải trả lời được revision nào chạy theo approval
từng lần, revision nào chạy theo policy version nào và policy có hiệu lực lúc nào.

### 20.3 Hợp đồng API mới phải có trước khi code UI

Mỗi action định nghĩa request, response, role, idempotency, lỗi và test ID.
Dùng error code ổn định như `APPROVAL_REQUIRED`, `NO_ELIGIBLE_ACTOR`,
`QUOTA_EXCEEDED`, `LEASE_STALE`, `SESSION_REQUIRED`, `RESULT_AMBIGUOUS`;
UI dịch thành tiếng Việt. Danh sách có pagination và giới hạn response.

Ngoài actions mục 6.4, cần các contract cho: create/preview discussion draft,
approve/reject assigned turns, update own consent, disconnect device,
enrollment request/approval và user approve/reject content revision.
Tên chính xác chốt trong ticket API; không cho frontend tự ghi bảng để lấp chỗ trống.

### 20.4 Rollout không làm hỏng user đang chạy

1. Kiểm kê DB/function đã deploy, grants và phiên bản extension đang dùng.
2. Thêm schema và API tương thích; feature flags mặc định tắt, không backfill
   consent thành true cho user cũ.
3. Ship client đọc được trạng thái mới; backend yêu cầu minimum client version
   cho các action mới và vô hiệu đường claim cũ khi mở consent gate.
4. Quiesce task cũ đã bắt đầu: đối soát receipt; task chưa chạy chờ opt-in/approval.
5. Chuyển legacy direct reads/writes sang API xong mới siết grants tương ứng.
6. Mở theo nhóm pilot. Rollback tắt tạo/claim/begin mới nhưng vẫn cho phép
   complete/reconcile hợp lệ để không mất kết quả đã gửi.

Kill switch engagement và publishing độc lập, có nút dừng tất cả. Không rollback
bằng cách mở lại anon write hoặc tắt kiểm tra quyền.

## 21. Backlog có thứ tự, đầu ra và ca nghiệm thu

Các ticket sau là đơn vị triển khai; mỗi ticket có commit nhỏ, test và ghi chú
deploy. Không đánh dấu xong chỉ vì đã có UI hoặc test kiểm tra chuỗi source.

### R0 — Xác nhận nền tảng và API tạo bài

- Phụ thuộc: không.
- Đầu ra: checklist deployed versions/migrations, response fixture đã bỏ dữ liệu
  nhạy cảm, contract create/detail/list article, identity và idempotency hỗ trợ gì.
- Nghiệm thu: có ID/UUID thực từ lần thử được cho phép; xác định `author:null`
  dùng tài khoản session, ý nghĩa terms và bài tạo ở trạng thái nào.
- Chặn auto-post nếu chưa xác minh response/auth. Công việc copy/import UI vẫn làm được.

### R1 — Identity, role, quyền dữ liệu và consent

- Phụ thuộc: kiểm kê R0; tái sử dụng 016.
- Đầu ra: enrollment, ownership API, consent versioned, pause, thu hồi device.
- Nghiệm thu: user A không đọc/sửa object của B bằng ID; invitation replay bị chặn;
  heartbeat không hồi sinh revoked; client cũ không bypass consent.
- Test: API/DB dev dùng anon, authenticated, device và admin; không chỉ string test.

### R2 — Wizard copy prompt/import/preview

- Phụ thuộc: R1 để submit; UI có thể làm với fixture trước.
- Đầu ra: giữ đường copy prompt hiện có, import hai format, lỗi theo turn,
  preview, lưu draft và revision; mặc định 3 chuỗi.
- Nghiệm thu: user tạo draft trong dưới 3 phút, reload không mất draft;
  server từ chối actor/post/quota do JSON tự khai trái quyền.

### R3 — Ghép actor, approval và thực thi chuỗi

- Phụ thuộc: R1, R2.
- Đầu ra: waiting states, hộp duyệt của A/B, reservation quota, execution checks,
  link comment thật và history.
- Nghiệm thu: hai tài khoản A/B trên hai browser profile chạy đúng ba turn;
  tắt máy A sau turn 1 rồi mở lại vẫn dùng A cho turn 3; không mất receipt khi
  complete lỗi; parent bị xóa thì blocked.
- Trạng thái 18/09/2026: **đã hoàn tất implementation và test local; chờ demo
  tích hợp hai browser profile sau deploy**. Đã có assignment giữ nguyên visitor
  cho cả revision, approval riêng của tác giả/visitor, giữ quota trước khi duyệt,
  trạng thái chờ/ready/running/completed, execution gate kiểm lại consent/lease/
  bài verified/parent ngay trước POST và receipt bền vững để complete lỗi không
  gửi lại POST đã xác định thành công. Bằng chứng: commit `3112de2`, `b8e1c63`,
  `e7e7639`; test DB `scripts/test-r3-approval-receipts.sql`; 370 test engagement
  và 165 test post-sync pass. Chưa đánh dấu nghiệm thu production cho tới khi chạy
  đủ kịch bản A/B, offline-resume, parent bị xóa và crash sau POST trên extension.

### R4 — Admin cơ bản và điểm/Ultra

- Phụ thuộc: R3.
- Đầu ra: năm trường cấu hình, hai preset MVP, preview capacity, lỗi có hành động,
  ledger hoàn Ultra cho yêu cầu chưa bắt đầu đủ điều kiện.
- Nghiệm thu: admin hoàn thành chiến dịch trong 2 phút; bài ưu tiên vẫn chịu quota;
  retry reward/refund không thay đổi số dư lần hai.

### R5 — Kho bài, revision và phân lịch

- Phụ thuộc: R1; có thể tiến hành sau contract R3 đã ổn định.
- Đầu ra: copy prompt kho bài, import batch, editor/preview, revision approved,
  user approval, phân bài và lịch tuần.
- Nghiệm thu: hai admin reserve cùng revision chỉ một người thành công;
  sửa draft không đổi bài đã duyệt đang chờ đăng; nhập batch lặp không nhân đôi kho.

### R6 — Publish execution và phục hồi

- Phụ thuộc: R0 xác minh API, R5, R1.
- Đầu ra: publishing-api/client/worker, begin intent, generation, journal receipt,
  ambiguous review và late policies.
- Nghiệm thu: một request POST tối đa trong các test crash đã mô phỏng; crash sau
  begin không tự requeue POST; đổi tài khoản trước giờ chạy thì chặn; máy offline
  quá hạn hiển thị đúng reason. Không hứa exactly-once ngoài khả năng API.

### R7 — Publish → sync → discussion

- Phụ thuộc: R3, R6.
- Đầu ra: post receipt được sync idempotent, tùy chọn tạo **draft** thảo luận sau
  verified; không mặc định lấy approval bài viết thay approval lời thoại.
- Nghiệm thu: replay publish complete không tạo hai bài cache/hai batch thảo luận;
  sync lỗi chỉ retry sync, không đăng lại bài.

### R8 — AI tích hợp và pilot đo chất lượng

- Phụ thuộc: R2/R5 để tái sử dụng preview, R1 để bảo vệ proxy.
- Đầu ra: generation request ID, quota user/admin, giới hạn output, budget/ngày,
  retry không tạo batch trùng; fallback sang copy prompt khi hết budget/lỗi AI.
- Pilot có thể bắt đầu bằng copy prompt trước AI tích hợp nếu các gate khác đạt.
- Nghiệm thu: user thường không dùng token chung để gọi AI không giới hạn;
  timeout generation không tự tiêu thụ lại budget vô hạn.

### R9 — Tự động có kiểm soát sau pilot

- Phụ thuộc: R3, R8 và pilot đạt toàn bộ gate ở mục 22; mặc định feature flag tắt.
- Đầu ra: policy versioned do user tự cấu hình, allowlist chủ đề/tone, quota và
  thời hạn; engine đánh giá policy server-side; audit và nút thu hồi tức thì.
- Nghiệm thu: nội dung khớp policy chạy không cần click từng task; chỉ cần lệch
  một điều kiện thì quay về chờ duyệt. Pause/revoke/policy mới chặn mọi turn chưa
  bắt đầu; admin không thể bật hoặc mở rộng delegation bằng API đặc quyền.
- Rollout: mở theo nhóm nhỏ, so sánh tỷ lệ hoàn thành và phản hồi kiểm soát với
  chế độ duyệt tay; tự tắt nếu có action ngoài policy hoặc khiếu nại sai tài khoản.

## 22. Demo nghiệm thu và định nghĩa 9/10 bằng bằng chứng

### 22.1 Demo bắt buộc trước mở rộng

**Demo A — Từ một bài đến chuỗi có thật:** Minh chọn bài, copy prompt, dán 3
chuỗi, xem preview và xác nhận. Lan được ghép, duyệt turn của mình. Lan comment,
Minh reply, Lan phản hồi; mỗi turn có link/ID thật. Khi không có Lan online,
UI báo chờ thay vì báo hệ thống đã tạo tương tác.

**Demo B — Kho 5 bài cho 5 ngày:** admin import kho, sửa một bài, duyệt revision,
gán lịch cho Minh. Minh chấp nhận. Đến giờ browser mở thì đăng bằng tài khoản
Minh; một ngày browser tắt thì hiển thị trễ/chờ xử lý đúng policy. Admin nhìn
được bài nào đã đăng và bài nào chưa, không phải mở log kỹ thuật.

**Demo C — Sự cố:** hai device cùng user claim đồng thời; crash sau POST;
session hết; parent comment bị xóa; user pause sau claim; admin sửa draft đang
có lịch; request complete gửi hai lần. Có kết quả dự kiến cho từng tình huống,
không bỏ qua case lỗi để chỉ demo đường thành công.

**Demo D — Tự động có kiểm soát:** sau khi pilot đạt gate, Lan tự cho phép chủ đề
“Cải tiến quy trình”, tone chuyên môn, tối đa 2 action/ngày trong 30 ngày. Một turn
khớp policy chạy không cần click; turn khác tone chuyển chờ duyệt. Lan bấm pause
thì turn chưa bắt đầu bị chặn; admin thử mở rộng policy qua API và bị từ chối.

### 22.2 Cách tính metric để không tự đánh giá sai

- Task success: succeeded / số task đã bắt đầu execution trong cohort quan sát.
  Retry không tạo mẫu mới; failed/ambiguous vẫn nằm trong mẫu. Báo riêng chờ
  approval, thiếu actor, offline và session-required, không ẩn chúng khỏi dashboard.
- Thread completion: thread hoàn thành / thread đã bắt đầu turn 1; luôn kèm số
  thread đang chờ và tuổi chờ. Đo thêm tỷ lệ từ xác nhận draft tới hoàn thành.
- Publish đúng giờ: tỷ lệ trong cửa sổ mục tiêu khi thiết bị/phiên/approval đủ
  điều kiện; báo song song tỷ lệ của **toàn bộ lịch** để phản ánh trải nghiệm thật.
- Pilot mục tiêu: ≥100 action trên ≥5 user trong 14 ngày, không ép tăng hành động
  để đủ mẫu. Thiếu mẫu thì kéo dài pilot, ghi “chưa đủ dữ liệu”.
- Mục tiêu task ≥95%, duplicate được quan sát = 0; mọi ambiguous được giải thích
  và xử lý. Zero observed không phải chứng minh không thể có duplicate.
- Retention: ≥70% số user đã hoàn tất onboarding còn chủ động bật ở ngày 7;
  kèm số người cụ thể, không chỉ phần trăm trong mẫu nhỏ.
- User đánh giá hữu ích và khả năng kiểm soát trung bình ≥4/5; admin đo thời gian
  tạo chiến dịch dưới 2 phút trong ít nhất 3 lượt không được developer hướng dẫn.

### 22.3 Chấm điểm và điều kiện chặn

Điểm chung = tổng điểm từng trụ cột nhân trọng số mục 14. Mỗi trụ cột 0–10:
0 chưa có, 5 chỉ chạy đường thành công, 8 qua cả lỗi/restart và hai thiết bị,
9 có số liệu pilot đạt gate, 10 duy trì ổn định qua nhiều đợt sử dụng.

Không công bố 9/10 khi còn bất kỳ lỗi: sai tài khoản, vượt consent, lộ dữ liệu,
quyền sở hữu bị bypass hoặc tự gửi lại POST ambiguous. Đây là gate bắt buộc,
không được bù bằng nhiều tính năng hay số comment cao.

Checklist bàn giao mỗi release: commit/branch, file/contract thay đổi, test và
demo đã chạy, migration/function cần deploy theo đúng thứ tự, feature flag,
metric theo dõi, rollback và phần chưa kiểm chứng. Trong lần rà soát plan này
R1–R3 đã có implementation và test local trên branch `product-9-10`; R0 create
API được hoãn đến lúc chạy extension. R4–R9 chưa triển khai và chưa có ticket nào
được xác minh production. Trước demo R3 phải áp lần lượt migration
`20260917020158`, `20260917025828`, `20260918043557`, deploy `engagement-api`
và `post-sync-api`, sau đó reload extension trên hai browser profile.
