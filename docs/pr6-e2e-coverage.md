# PR6 · E2E và C2 cho AuthController

C2 trong báo cáo này là **condition coverage**. Mỗi điều kiện thành phần
được tính riêng và phải thực sự được đánh giá thành cả `true` lẫn `false`.
V8 đo statement, branch, function và line coverage. Ma trận dưới đây dùng
đường đi và kết quả HTTP để đối chiếu từng điều kiện của luồng login.

## Phạm vi

`AuthController` sở hữu `POST /api/users/login`. Phương thức `login()` chuyển
DTO vào `AuthService.login()` và không chứa biểu thức điều kiện. Registration
thuộc `UsersController` và cung cấp fixture. Đọc người dùng hiện tại và logout
thuộc `CurrentUserController` và `LogoutController`. Hai route ấy dùng
`JwtAuthGuard`, nên các ca token được báo riêng với C2 của login.

## Ma trận điều kiện login

| ID | Source location | Condition | True case | False case | Expected result | Actual result |
| --- | --- | --- | --- | --- | --- | --- |
| L0 | `auth.controller.ts` · `login` | Không có điều kiện thành phần | — | — | Chuyển DTO hợp lệ vào service | Ca C2-01 đi hết luồng HTTP và trả người dùng đã lưu |
| L1 | `auth.service.ts` · `login` | `Buffer.byteLength(password, 'utf8') > 72` | C2-04, 73 byte | C2-01, mật khẩu hợp lệ | 401 / 200 | 401 với lỗi credentials chung / 200 với JWT |
| L2 | `auth.service.ts` · `login` | `user?.passwordHash` là nullish, quyết định dùng dummy hash | C2-02, không có user | C2-01, có user với hash | 401 / 200 | 401 với lỗi credentials chung / 200 |
| L3 | `auth.service.ts` · `login` | `!user` trong `!user \|\| !passwordMatches` | C2-02, email vắng trong DB | C2-03 hoặc C2-01, tìm thấy user | 401 / đánh giá điều kiện L4 | 401 / 401 hoặc 200 theo mật khẩu |
| L4 | `auth.service.ts` · `login` | `!passwordMatches` trong `!user \|\| !passwordMatches` | C2-03, user tồn tại và sai mật khẩu | C2-01, user tồn tại và đúng mật khẩu | 401 / 200 | 401 với lỗi credentials chung / 200 |

L4 không được đánh giá ở C2-02 vì L3 đã `true`. C2-04 dừng trước lookup,
nên chỉ chứng minh nhánh `true` của L1. Ca email sai định dạng trả 400 từ
validation pipe, trước khi gọi controller. C2-01 kiểm dữ liệu response với
user thật trong MySQL và xác minh JWT phát ra có TTL 900 giây.

## Kiểm tra guard và các route liên quan

| Điểm quyết định | Ca E2E | Kết quả HTTP |
| --- | --- | --- |
| `JwtAuthGuard`: thiếu token, JWT sai định dạng, sai chữ ký hoặc hết hạn | `GET /api/user` với từng đầu vào tương ứng | 401 |
| `JwtAuthGuard`: claims hợp lệ hoặc sai dạng | Token login thật / token test có `jti` sai dạng | 200 / 401 |
| `JwtAuthGuard`: token có bị thu hồi | Đọc user trước / sau khi logout thành công | 200 / 401 |
| `JwtAuthGuard`: user còn tồn tại | Token login thật / token test có `sub` vắng trong DB | 200 / 401 |
| `LogoutController`: đường đi hợp lệ và guard từ chối | Logout với token hợp lệ / gửi lại token đã thu hồi | 204 / 401 |

Các ca auth này dùng JWT, Nest app, MySQL và Redis thật. Bảng guard là
bằng chứng theo từng kịch bản, không dùng để tuyên bố đã bao phủ mọi điều kiện
thành phần của bộ kiểm tra claims. Nhánh thiếu `request.auth` bên trong logout
không được exercise bằng HTTP vì guard từ chối request trước khi vào controller.
Không tạo lỗi kết nối Redis trong E2E này. Các suite concurrency có fault
injection riêng để kiểm tra rollback và retry.

## Kết quả đo V8

Nguồn đo là `test/auth-flow.e2e-spec.ts`, chạy độc lập với **10/10 test đạt**.

| File | Statement | Branch | Function | Line |
| --- | ---: | ---: | ---: | ---: |
| `auth.controller.ts` | 100% (3/3) | — (0 nhánh) | 100% (2/2) | 100% (3/3) |
| `auth.service.ts` | 100% (15/15) | 90% (9/10) | 100% (2/2) | 100% (15/15) |
| `jwt-auth.guard.ts` | 96,55% (28/29) | 96,29% (26/27) | 100% (3/3) | 96,55% (28/29) |
| `logout.controller.ts` | 80% (4/5) | 50% (1/2) | 100% (2/2) | 80% (4/5) |
| Tổng bốn file | 96,15% (50/52) | 92,30% (36/39) | 100% (9/9) | 96,15% (50/52) |

Trong phạm vi login đã chọn, cả hai giá trị của các điều kiện L1–L4 đều có
ca E2E chứng minh. V8 báo 100% branch cho `AuthController` theo quy ước
khi mẫu số bằng 0, vì phương thức chỉ gọi service. Tỷ lệ branch của V8 và
ma trận điều kiện trả lời hai câu hỏi khác nhau.

## Kiểm chứng vòng đời E2E

- Full E2E đạt 229/229 test trên 21 suite. Runner tuần tự, các ca concurrency
  giữ nguyên các request đồng thời bên trong ca kiểm thử.
- Full test runner đạt 380/380 test trên 29 file. Build, test typecheck, lint
  production, lint phần E2E và `git diff --check` đều đạt.
- MySQL xác nhận cả 8 bảng ứng dụng rỗng sau các lượt E2E. Bảng `migrations`
  vẫn có 7 bản ghi. Hook `afterEach` kiểm tra trạng thái rỗng sau từng ca.
- Redis dùng logical DB 2 trên Redis local. Luồng logout xóa đúng key
  revocation của token test, có TTL làm cơ chế dự phòng. Avatar dùng thư mục
  tạm theo suite và dọn các file do ca kiểm thử tạo.
- Các ca auth mới seed user trong `beforeEach`. Những ca cũ giữ bước tạo fake
  data riêng trong phần chuẩn bị của ca, bao gồm các ca lấy thao tác tạo dữ
  liệu qua HTTP làm đối tượng kiểm thử.

Các tệp bổ sung gồm `test/helpers/dedicated-e2e-database.ts`,
`test/helpers/dedicated-e2e-database.spec.ts`, `test/helpers/e2e.setup.ts`,
`test/migrate-e2e.mjs` và báo cáo này. Bản sửa cập nhật `README.md`,
`package.json`, `vitest.config.e2e.ts`, 21 suite trong danh sách `include`,
`test/helpers/test-app.helper.ts`, cặp `article-fixture.helper.ts` và
`article-fixture.helper.spec.ts`, cặp `user-fixture.helper.ts` và
`user-fixture.helper.spec.ts`.
