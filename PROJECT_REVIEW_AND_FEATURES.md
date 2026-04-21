# Đánh giá dự án & cập nhật tính năng

**Cập nhật:** 2026-04-21

## Tổng quan

Đây là một monorepo thương mại điện tử dựa trên Medusa 2.0 + Next.js, được tối ưu cho thị trường Việt Nam.

Mô hình chính:

- Backend Medusa chịu trách nhiệm module, API, thanh toán, storage và admin extensions.
- Storefront Next.js render sản phẩm, giỏ hàng, checkout và trang nội dung tùy biến.
- Admin được mở rộng bằng widget và route riêng để quản lý nội dung sản phẩm và landing page.

## Đánh giá nhanh

| Hạng mục | Đánh giá | Nhận xét |
| --- | --- | --- |
| Kiến trúc backend | Tốt | Chia module rõ: `page`, `minio-file`, `email-notifications`, `sepay-payment`. |
| Tùy biến admin | Tốt | Có page builder riêng cho landing page và product content widget cho sản phẩm. |
| Thanh toán | Khá tốt | Hỗ trợ Stripe và SePay; phù hợp checkout cho thị trường VN. |
| Storefront | Tốt | Render nội dung từ Medusa metadata và hỗ trợ trang public theo slug. |
| Khả năng vận hành | Khá | Có fallback storage, notification provider, search; vẫn nên bổ sung test và hardening bảo mật. |

## Điểm mạnh

- Có thể triển khai như một nền tảng bán hàng thực tế, không chỉ là boilerplate.
- Tích hợp các mảnh ghép quan trọng: thanh toán, upload ảnh, email, search, landing page.
- Luồng nội dung sản phẩm đủ linh hoạt để làm content marketing, not chỉ product listing.
- Có fallback hợp lý ở một số chỗ:
  - MinIO không cấu hình thì quay về local storage.
  - Notification có thể dùng SendGrid hoặc Resend.
  - Search tích hợp có điều kiện theo cấu hình.

## Điểm cần chú ý

- SePay đang phụ thuộc vào nội dung chuyển khoản để match đơn hàng, nên format nội dung cần được giữ ổn định.
- Custom page content và product page content dùng HTML/CSS sinh từ GrapesJS, cần kiểm soát chặt đầu vào nếu mở cho nhiều người dùng.
- Một số giá trị còn hardcode, ví dụ `PHAN VIET`, `/vn/products/...`, và một số copy trong page builder.
- `getWebhookActionAndData()` của SePay provider hiện chưa hỗ trợ webhook theo cơ chế Medusa mặc định, nên luồng thanh toán thực tế đang dựa nhiều vào API custom.

## Tính năng đã cập nhật

### 1. Thanh toán SePay

Thêm provider thanh toán `sepay` trong Medusa:

- Tạo QR VietQR từ số tiền đơn hàng.
- Kiểm tra trạng thái thanh toán bằng API SePay.
- Webhook riêng để xác nhận giao dịch chuyển khoản vào.
- Lưu metadata thanh toán vào order.

Các file liên quan:

- `backend/src/modules/sepay-payment/index.ts`
- `backend/src/api/store/sepay/qr/route.ts`
- `backend/src/api/store/sepay/webhook/route.ts`
- `backend/src/lib/constants.ts`
- `backend/src/scripts/sync-sepay-region.ts`

### 2. Module landing page / CMS

Thêm module `pageModule` để quản lý trang nội dung public:

- Model `page` có `title`, `slug`, `content`, `status`.
- Admin có danh sách trang, tạo mới, chỉnh sửa và xóa.
- Storefront public render theo slug và chỉ hiển thị trang đã `published`.

Các file liên quan:

- `backend/src/modules/page/index.ts`
- `backend/src/modules/page/service.ts`
- `backend/src/modules/page/models/page.ts`
- `backend/src/modules/page/migrations/Migration20260415000000.ts`
- `backend/src/api/admin/pages/route.ts`
- `backend/src/api/admin/pages/[id]/route.ts`
- `backend/src/api/store/pages/[slug]/route.ts`
- `backend/src/admin/routes/pages/page.tsx`
- `backend/src/admin/routes/pages/[id]/edit/page.tsx`

### 3. Page Builder cho landing page

Admin editor dùng GrapesJS để tạo landing page nhanh:

- Có block sẵn cho hero, benefits, testimonials, countdown, CTA, FAQ, comparison table, gallery, v.v.
- Hỗ trợ lưu `html`, `css` và `projectData`.
- Có auto-save và publish/draft state.

### 4. Product Page Builder

Thêm widget chỉnh sửa nội dung trang sản phẩm ngay trong admin:

- Quản lý các section như video, pain points, benefits, specs, reviews, FAQ, bundle, trust badges.
- Cho phép upload ảnh từ admin và chọn ảnh từ bộ ảnh sản phẩm.
- Lưu `page_content` vào metadata sản phẩm để storefront render lại.

Các file liên quan:

- `backend/src/admin/widgets/product-content-widget.tsx`
- `backend/src/admin/components/product-page-builder.tsx`
- `storefront/src/lib/grapes.ts`
- `storefront/src/modules/products/components/product-page-content/index.tsx`
- `storefront/src/modules/products/templates/index.tsx`

### 5. Render page content trên storefront

Storefront parse nội dung GrapesJS từ metadata và render trực tiếp:

- Hỗ trợ format cũ là project JSON.
- Hỗ trợ format mới `{ html, css, projectData }`.
- Áp dụng cho trang sản phẩm và custom page public.

Các file liên quan:

- `storefront/src/lib/grapes.ts`
- `storefront/src/app/[countryCode]/(main)/p/[slug]/page.tsx`
- `storefront/src/modules/products/templates/index.tsx`

### 6. MinIO file provider

Thêm file provider MinIO cho Medusa:

- Upload, download, xóa file qua MinIO.
- Tự tạo bucket và cấu hình public read policy.
- Có fallback sang local storage nếu chưa cấu hình MinIO.

Các file liên quan:

- `backend/src/modules/minio-file/index.ts`
- `backend/src/modules/minio-file/service.ts`
- `backend/src/modules/minio-file/README.md`
- `backend/medusa-config.js`

### 7. Email notifications

Thêm notification module dựa trên Resend, đồng thời vẫn hỗ trợ SendGrid:

- Dùng `react-email` template để tạo email dễ bảo trì.
- Có template cho order placed và invite user.
- Có preview server cho email template.

Các file liên quan:

- `backend/src/modules/email-notifications/index.ts`
- `backend/src/modules/email-notifications/services/resend.ts`
- `backend/src/modules/email-notifications/templates/*`
- `backend/src/modules/email-notifications/README.md`
- `backend/src/subscribers/order-placed.ts`
- `backend/src/subscribers/invite-created.ts`

### 8. Search integration

Meilisearch được bật theo cấu hình:

- Index sản phẩm với các field quan trọng.
- Tìm kiếm theo title, description, SKU.

Các file liên quan:

- `backend/medusa-config.js`
- `storefront/src/lib/search-client.ts`
- `storefront/src/app/[countryCode]/(main)/search/page.tsx`
- `storefront/src/app/[countryCode]/(main)/results/[query]/page.tsx`

### 9. Tracking và marketing

Có sẵn các thành phần tracking:

- Facebook Pixel theo sản phẩm.
- Product purchase / add-to-cart tracking.
- UTM capture.

Các file liên quan:

- `storefront/src/components/FacebookPixel.tsx`
- `storefront/src/components/UtmCapture.tsx`
- `storefront/src/components/PurchaseTracker.tsx`
- `storefront/src/components/ProductPixelTracker.tsx`

## Kết luận

Project này đã vượt mức boilerplate và tiến gần một nền tảng bán hàng có thể dùng thực tế:

- Có backend module hóa.
- Có storefront hoàn chỉnh.
- Có admin mở rộng để quản lý nội dung.
- Có các tích hợp cần thiết cho thị trường Việt Nam.

Nếu cần ưu tiên bước tiếp theo, mình khuyến nghị:

1. Thêm test cho luồng SePay webhook và parse page content.
2. Rà soát bảo mật cho HTML/CSS sinh từ GrapesJS.
3. Chuẩn hóa các giá trị hardcode và đưa vào config/env.
