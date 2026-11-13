import { Section, Text, Button, Hr } from '@react-email/components'
import { Base } from './base'

export const DIGITAL_DELIVERY = 'digital-delivery'

export interface DigitalDeliveryEmailProps {
  customerName?: string
  productTitle: string
  variantTitle?: string
  orderCode: string
  driveUrl: string
  shipsPhysical: boolean
}

export const isDigitalDeliveryData = (data: any): data is DigitalDeliveryEmailProps =>
  typeof data?.productTitle === 'string' && typeof data?.driveUrl === 'string' && typeof data?.orderCode === 'string'

export const DigitalDeliveryEmail = ({
  customerName,
  productTitle,
  variantTitle,
  orderCode,
  driveUrl,
  shipsPhysical,
}: DigitalDeliveryEmailProps) => (
  <Base preview={`Tài liệu ${productTitle} của bạn đã sẵn sàng`}>
    <Section className="mt-[24px]">
      <Text className="text-black text-[16px] leading-[24px]">
        Chào {customerName || 'bạn'},
      </Text>
      <Text className="text-black text-[14px] leading-[22px]">
        Phan Việt đã nhận được thanh toán cho đơn <strong>{orderCode}</strong>. Cảm ơn bạn!
      </Text>
      <Text className="text-black text-[14px] leading-[22px]">
        <strong>{productTitle}</strong>
        {variantTitle ? ` — ${variantTitle}` : ''}
        <br />
        Toàn bộ file PDF và bộ video bài giảng nằm trong thư mục dưới đây. Bạn có thể xem trực tiếp hoặc tải về máy.
      </Text>
      <Section className="mt-4 mb-4 text-center">
        <Button
          className="bg-[#f97316] rounded text-white text-[14px] font-semibold no-underline px-6 py-3"
          href={driveUrl}
        >
          Mở thư mục PDF + video
        </Button>
      </Section>
      <Text className="text-[#555] text-[12px] leading-[20px] break-all">
        Nếu nút không bấm được, dán link này vào trình duyệt: {driveUrl}
      </Text>
      {shipsPhysical && (
        <Text className="text-black text-[14px] leading-[22px]">
          📦 Lịch in của bạn sẽ được đóng gói và giao sau. Phan Việt sẽ liên hệ qua số điện thoại khi gửi hàng.
        </Text>
      )}
    </Section>
    <Hr className="border border-solid border-[#eaeaea] my-[20px] mx-0 w-full" />
    <Text className="text-[#666666] text-[12px] leading-[20px]">
      Cần hỗ trợ? Gọi 0967 993 609 hoặc trả lời email này.
    </Text>
  </Base>
)

export default DigitalDeliveryEmail
