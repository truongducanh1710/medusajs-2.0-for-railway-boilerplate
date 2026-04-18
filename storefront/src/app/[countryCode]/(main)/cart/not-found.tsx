import { Metadata } from "next"

import InteractiveLink from "@modules/common/components/interactive-link"

export const metadata: Metadata = {
  title: "404",
  description: "Đã có lỗi xảy ra",
}

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)]">
      <h1 className="text-2xl-semi text-ui-fg-base">Không tìm thấy trang</h1>
      <p className="text-small-regular text-ui-fg-base">
        Giỏ hàng bạn muốn truy cập không tồn tại. Hãy xoá cookie rồi thử lại.
      </p>
      <InteractiveLink href="/">Về trang chủ</InteractiveLink>
    </div>
  )
}
