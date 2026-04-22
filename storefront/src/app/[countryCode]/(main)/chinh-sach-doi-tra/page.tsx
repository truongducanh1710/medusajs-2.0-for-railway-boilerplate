import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Chính sách đổi trả | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Chính sách đổi trả" currentHref="/chinh-sach-doi-tra">
      <h2>Điều kiện đổi trả</h2>
      <p>Phan Việt chấp nhận đổi trả sản phẩm trong vòng <strong>7 ngày</strong> kể từ ngày nhận hàng nếu đáp ứng các điều kiện sau:</p>
      <ul>
        <li>Sản phẩm còn nguyên vẹn, chưa qua sử dụng, còn nguyên seal/hộp.</li>
        <li>Có hóa đơn mua hàng hoặc xác nhận đơn hàng từ Phan Việt.</li>
        <li>Sản phẩm không thuộc danh mục hàng không đổi trả (hàng tiêu hao, hàng giảm giá sâu).</li>
      </ul>

      <h2>Các trường hợp được đổi trả</h2>
      <ul>
        <li><strong>Sản phẩm lỗi nhà sản xuất:</strong> Đổi mới hoàn toàn miễn phí, Phan Việt chịu phí vận chuyển.</li>
        <li><strong>Giao sai sản phẩm:</strong> Đổi đúng sản phẩm, miễn phí toàn bộ.</li>
        <li><strong>Không hài lòng:</strong> Đổi sản phẩm khác hoặc hoàn tiền trong 7 ngày đầu.</li>
      </ul>

      <h2>Quy trình đổi trả</h2>
      <ul>
        <li>Bước 1: Liên hệ hotline <strong>0967 993 609</strong> hoặc email <strong>hoanpd@phanviet.vn</strong>.</li>
        <li>Bước 2: Cung cấp mã đơn hàng và mô tả lý do đổi trả.</li>
        <li>Bước 3: Đóng gói sản phẩm và gửi về địa chỉ được hướng dẫn.</li>
        <li>Bước 4: Nhận sản phẩm mới hoặc hoàn tiền trong 3–5 ngày làm việc.</li>
      </ul>

      <h2>Hoàn tiền</h2>
      <p>
        Tiền hoàn trả được chuyển khoản về tài khoản ngân hàng của khách trong vòng <strong>3–5 ngày làm việc</strong>
        sau khi Phan Việt nhận và kiểm tra sản phẩm.
      </p>
    </PolicyLayout>
  )
}
