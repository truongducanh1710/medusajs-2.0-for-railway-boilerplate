import { Metadata } from "next"
import PolicyLayout from "@modules/policies/policy-layout"

export const metadata: Metadata = { title: "Giới thiệu về chúng tôi | Phan Việt" }

export default function Page() {
  return (
    <PolicyLayout title="Giới thiệu về chúng tôi" currentHref="/gioi-thieu">
      <h2>Về Phan Việt</h2>
      <p>
        <strong>CÔNG TY TNHH PHAN VIỆT INVEST</strong> (MST: 0109890417) được thành lập ngày 18/01/2022,
        cấp phép bởi Sở Kế hoạch và Đầu tư TP. Hà Nội. Chúng tôi chuyên cung cấp các sản phẩm gia dụng
        cao cấp, thiết kế hiện đại dành cho mọi gia đình Việt.
      </p>

      <h2>Sứ mệnh</h2>
      <p>
        Mang đến những sản phẩm gia dụng chất lượng cao, giá cả hợp lý — giúp nâng tầm không gian sống
        của mỗi gia đình Việt Nam. Chúng tôi cam kết 100% sản phẩm chính hãng, bảo hành đầy đủ.
      </p>

      <h2>Cam kết của chúng tôi</h2>
      <ul>
        <li><strong>Chính hãng 100%:</strong> Tất cả sản phẩm đều có nguồn gốc rõ ràng, tem chính hãng.</li>
        <li><strong>Bảo hành 12 tháng:</strong> Đổi mới hoàn toàn nếu sản phẩm lỗi do nhà sản xuất.</li>
        <li><strong>Giao hàng toàn quốc:</strong> 1–3 ngày làm việc, miễn phí vận chuyển.</li>
        <li><strong>Hoàn tiền 7 ngày:</strong> Đổi trả không cần lý do trong 7 ngày đầu.</li>
      </ul>

      <h2>Liên hệ</h2>
      <ul>
        <li><strong>Hotline:</strong> 0967 993 609</li>
        <li><strong>Email:</strong> hoanpd@phanviet.vn</li>
      </ul>
    </PolicyLayout>
  )
}
