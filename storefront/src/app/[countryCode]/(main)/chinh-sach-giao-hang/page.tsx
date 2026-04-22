import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Chính sách giao hàng | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Chính sách giao hàng" currentHref="/chinh-sach-giao-hang">
      <h2>Phạm vi giao hàng</h2>
      <p>Phan Việt giao hàng toàn quốc — tất cả 63 tỉnh thành trên cả nước.</p>

      <h2>Thời gian giao hàng</h2>
      <ul>
        <li><strong>Hà Nội & TP. HCM:</strong> 1–2 ngày làm việc.</li>
        <li><strong>Các tỉnh thành khác:</strong> 2–4 ngày làm việc.</li>
        <li><strong>Vùng sâu, vùng xa:</strong> 4–7 ngày làm việc.</li>
      </ul>
      <p>Thời gian tính từ khi đơn hàng được xác nhận và thanh toán thành công.</p>

      <h2>Phí vận chuyển</h2>
      <ul>
        <li><strong>Miễn phí vận chuyển</strong> cho tất cả đơn hàng trên toàn quốc.</li>
        <li>Đơn hàng đổi trả do lỗi nhà sản xuất: Phan Việt chịu toàn bộ phí vận chuyển.</li>
      </ul>

      <h2>Theo dõi đơn hàng</h2>
      <p>
        Sau khi đơn hàng được giao cho đơn vị vận chuyển, bạn sẽ nhận được mã vận đơn qua SMS/Zalo.
        Có thể tra cứu tình trạng tại trang <strong>Tra cứu đơn hàng</strong> hoặc liên hệ hotline.
      </p>

      <h2>Lưu ý khi nhận hàng</h2>
      <ul>
        <li>Kiểm tra tình trạng kiện hàng trước khi ký nhận.</li>
        <li>Nếu hàng bị móp méo, hư hỏng bên ngoài — từ chối nhận và liên hệ ngay với Phan Việt.</li>
        <li>Quay video khi mở hộp để có bằng chứng nếu cần đổi trả.</li>
      </ul>
    </PolicyLayout>
  )
}
