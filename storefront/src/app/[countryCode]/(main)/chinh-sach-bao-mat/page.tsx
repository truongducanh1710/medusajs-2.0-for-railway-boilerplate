import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Chính sách bảo mật | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Chính sách bảo mật" currentHref="/chinh-sach-bao-mat">
      <h2>Thu thập thông tin</h2>
      <p>Phan Việt thu thập các thông tin cần thiết khi bạn đặt hàng, bao gồm: họ tên, số điện thoại, địa chỉ giao hàng và email. Chúng tôi không thu thập thông tin thẻ ngân hàng — mọi giao dịch được xử lý qua cổng thanh toán bảo mật.</p>

      <h2>Mục đích sử dụng</h2>
      <ul>
        <li>Xử lý đơn hàng và giao hàng đến đúng địa chỉ.</li>
        <li>Liên hệ xác nhận đơn hàng và hỗ trợ sau bán hàng.</li>
        <li>Gửi thông tin khuyến mãi (nếu bạn đồng ý nhận).</li>
      </ul>

      <h2>Bảo mật thông tin</h2>
      <p>
        Thông tin cá nhân của bạn được lưu trữ trên hệ thống bảo mật, mã hóa SSL. Phan Việt cam kết
        <strong> không chia sẻ, bán hoặc cho thuê</strong> thông tin cá nhân của khách hàng cho bên thứ ba,
        ngoại trừ đơn vị vận chuyển để thực hiện giao hàng.
      </p>

      <h2>Cookie</h2>
      <p>Website sử dụng cookie để cải thiện trải nghiệm mua sắm (lưu giỏ hàng, ghi nhớ đăng nhập). Bạn có thể tắt cookie trong cài đặt trình duyệt, tuy nhiên một số tính năng có thể bị ảnh hưởng.</p>

      <h2>Quyền của khách hàng</h2>
      <ul>
        <li>Yêu cầu xem, chỉnh sửa hoặc xóa thông tin cá nhân.</li>
        <li>Hủy đăng ký nhận email marketing bất cứ lúc nào.</li>
      </ul>
      <p>Liên hệ: <strong>hoanpd@phanviet.vn</strong> hoặc <strong>0967 993 609</strong>.</p>
    </PolicyLayout>
  )
}
