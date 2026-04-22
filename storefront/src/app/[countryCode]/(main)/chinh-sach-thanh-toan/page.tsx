import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Chính sách thanh toán | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Chính sách bảo mật thanh toán" currentHref="/chinh-sach-thanh-toan">
      <h2>Phương thức thanh toán</h2>
      <ul>
        <li><strong>COD (Thanh toán khi nhận hàng):</strong> Trả tiền mặt cho nhân viên giao hàng.</li>
        <li><strong>Chuyển khoản QR:</strong> Quét mã QR VietQR, hỗ trợ tất cả ngân hàng Việt Nam. Giảm thêm 20.000đ khi chọn phương thức này.</li>
      </ul>

      <h2>Bảo mật giao dịch</h2>
      <p>
        Phan Việt sử dụng kết nối <strong>HTTPS/SSL</strong> cho toàn bộ website. Thông tin thanh toán
        được xử lý qua SePay — đối tác thanh toán uy tín, không lưu trữ thông tin thẻ ngân hàng của khách.
      </p>

      <h2>Xác nhận thanh toán</h2>
      <p>
        Sau khi chuyển khoản thành công, hệ thống tự động xác nhận trong vòng <strong>1–5 phút</strong>.
        Nếu quá 10 phút chưa nhận được xác nhận, vui lòng liên hệ hotline <strong>0967 993 609</strong>.
      </p>

      <h2>Hoàn tiền</h2>
      <p>
        Trong trường hợp cần hoàn tiền (đổi trả, hủy đơn), Phan Việt chuyển khoản về tài khoản ngân hàng
        của khách trong vòng <strong>3–5 ngày làm việc</strong>.
      </p>

      <h2>Lưu ý</h2>
      <ul>
        <li>Nội dung chuyển khoản phải đúng theo hướng dẫn (mã đơn hàng) để hệ thống tự xác nhận.</li>
        <li>Phan Việt không yêu cầu khách hàng cung cấp OTP hay mật khẩu ngân hàng qua bất kỳ kênh nào.</li>
      </ul>
    </PolicyLayout>
  )
}
