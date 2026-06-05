import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Xóa dữ liệu người dùng | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Yêu cầu xóa dữ liệu" currentHref="/xoa-du-lieu">
      <p>
        Nếu bạn đã sử dụng tính năng đăng nhập Facebook trên website Phan Việt và muốn yêu cầu xóa
        dữ liệu cá nhân của mình, vui lòng làm theo hướng dẫn bên dưới.
      </p>

      <h2>Dữ liệu chúng tôi lưu trữ</h2>
      <p>Khi bạn đăng nhập qua Facebook, chúng tôi có thể lưu: họ tên, địa chỉ email và ảnh đại diện do Facebook cung cấp. Chúng tôi không lưu mật khẩu Facebook hay thông tin thẻ ngân hàng.</p>

      <h2>Cách yêu cầu xóa dữ liệu</h2>
      <p>Gửi email đến <strong>hoanpd@phanviet.vn</strong> với tiêu đề <strong>"Yêu cầu xóa dữ liệu"</strong> và nội dung:</p>
      <ul>
        <li>Họ tên hoặc địa chỉ email đã dùng để đăng nhập.</li>
        <li>Yêu cầu cụ thể: xóa tài khoản / xóa toàn bộ dữ liệu.</li>
      </ul>

      <h2>Thời gian xử lý</h2>
      <p>Chúng tôi sẽ xác nhận và hoàn tất xóa dữ liệu trong vòng <strong>7 ngày làm việc</strong> kể từ khi nhận được yêu cầu hợp lệ.</p>

      <h2>Liên hệ</h2>
      <p>
        Email: <strong>hoanpd@phanviet.vn</strong><br />
        Hotline: <strong>0967 993 609</strong>
      </p>
    </PolicyLayout>
  )
}
