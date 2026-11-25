import { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRegion } from "@lib/data/regions"
import { getIcegelItems } from "@modules/icegel/data"
import IcegelShop from "@modules/icegel/components/icegel-shop"
import { IcegelFaq, IcegelTrust, IcegelHowItWorks } from "@modules/icegel/components/sections"

export const revalidate = 300

type Props = { params: Promise<{ countryCode: string }> }

const TITLE = "Miếng dán hydrogel tinh dầu ICEgel – Thông mũi, hạ sốt, giảm đau | Phan Việt"
const DESCRIPTION =
  "Đủ 10 dòng miếng dán gel ICEgel: thông mũi, giảm ho, hạ sốt cho bé, thái dương, mặt nạ mắt, giảm đau, làm ấm. Mua 2 hộp bất kỳ tặng 2 miếng, từ 3 hộp miễn phí giao hàng. Nhận hàng mới trả tiền."

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { countryCode } = await params
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `https://phanviet.vn/${countryCode}/icegel` },
    openGraph: { title: TITLE, description: DESCRIPTION, url: `https://phanviet.vn/${countryCode}/icegel`, siteName: "Phan Việt", type: "website" },
  }
}

export default async function IcegelPage({ params }: Props) {
  const { countryCode } = await params
  const region = await getRegion(countryCode)
  if (!region) notFound()
  const items = await getIcegelItems(region.id)
  if (!items.length) notFound()

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Miếng dán ICEgel",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `https://phanviet.vn/${countryCode}/icegel/${item.slug}`,
      name: item.title,
    })),
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="bg-gradient-to-b from-sky-100 via-sky-50 to-gray-50">
        <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
          <p className="text-[12px] font-black tracking-widest text-sky-700 uppercase">ICEgel · Gel hydrogel tinh dầu</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black text-gray-900 leading-tight">Miếng dán ICEgel cho cả nhà</h1>
          <p className="mt-2 text-[15px] text-gray-700 max-w-2xl">
            Thông mũi, giảm ho, hạ sốt cho bé, thái dương, mặt nạ mắt, giảm đau và làm ấm. Chọn hộp nào cũng được, cộng dồn để nhận quà.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 max-w-xl">
            <Offer big="2 hộp" small="tặng 2 miếng" />
            <Offer big="3 hộp" small="tặng 4 miếng + free ship" highlight />
            <Offer big="4 hộp" small="tặng 6 miếng + free ship" />
          </div>
          <p className="mt-2 text-[12px] text-gray-600">Quà là miếng dán lẻ các dòng ICEgel — bạn tự chọn loại khi đặt hàng.</p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4">
        <IcegelShop items={items} />
        <IcegelTrust />
        <IcegelHowItWorks />
        <IcegelFaq />
      </div>
    </div>
  )
}

function Offer({ big, small, highlight }: { big: string; small: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl px-2 py-2 text-center border ${highlight ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-sky-100 text-gray-900"}`}>
      <p className="font-black text-[15px] leading-tight">{big}</p>
      <p className={`text-[11px] font-semibold leading-tight ${highlight ? "text-white" : "text-gray-600"}`}>{small}</p>
    </div>
  )
}
