import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Chính sách kiểm hàng | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Chính sách kiểm hàng" currentHref="/chinh-sach-kiem-hang">
      <h2>Quyền kiểm hàng trước khi nhận</h2>
      <p>
        Phan Việt cho phép khách hàng <strong>kiểm tra sản phẩm trước khi thanh toán</strong> (với đơn COD).
        Bạn có quyền từ chối nhận nếu sản phẩm không đúng mô tả hoặc bị hỏng hóc.
      </p>

      <h2>Quy trình kiểm hàng</h2>
      <ul>
        <li>Yêu cầu nhân viên giao hàng chờ trong khi kiểm tra.</li>
        <li>Mở hộp, kiểm tra ngoại quan, số lượng và phụ kiện đi kèm.</li>
        <li>Kiểm tra tem bảo hành và hóa đơn trong hộp.</li>
        <li>Ký nhận chỉ khi đã hài lòng với sản phẩm.</li>
      </ul>

      <h2>Phát hiện lỗi sau khi nhận</h2>
      <ul>
        <li><strong>Trong 48 giờ:</strong> Báo ngay hotline, được hỗ trợ đổi mới ưu tiên.</li>
        <li><strong>Trong 7 ngày:</strong> Áp dụng chính sách đổi trả thông thường.</li>
        <li><strong>Sau 7 ngày:</strong> Áp dụng chính sách bảo hành 12 tháng.</li>
      </ul>

      <h2>Khuyến nghị</h2>
      <ul>
        <li><strong>Quay video khi mở hộp</strong> — đây là bằng chứng quan trọng nếu cần khiếu nại.</li>
        <li>Giữ lại hộp và phụ kiện cho đến khi chắc chắn sản phẩm hoạt động tốt.</li>
        <li>Chụp ảnh tem bảo hành để lưu giữ thông tin.</li>
      </ul>

      <h2>Liên hệ hỗ trợ</h2>
      <p>Hotline: <strong>0967 993 609</strong> — Email: <strong>hoanpd@phanviet.vn</strong></p>
    </PolicyLayout>
  )
}
