import { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRegion } from "@lib/data/regions"
import { getIcegelItems } from "@modules/icegel/data"
import IcegelShop, { TierProgress } from "@modules/icegel/components/icegel-shop"
import IcegelGallery from "@modules/icegel/components/gallery"
import { IcegelFaq, IcegelTrust } from "@modules/icegel/components/sections"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ProductPixelTracker from "@components/ProductPixelTracker"
import { formatVND } from "@modules/icegel/components/format"
import { LandingBody, LandingCautions, LandingHero } from "@modules/icegel/components/landing"

export const revalidate = 300

type Props = { params: Promise<{ countryCode: string; slug: string }> }

async function load(params: Props["params"]) {
  const { countryCode, slug } = await params
  const region = await getRegion(countryCode)
  if (!region) notFound()
  const items = await getIcegelItems(region.id)
  const item = items.find((entry) => entry.slug === slug)
  if (!item) notFound()
  return { countryCode, items, item }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { countryCode, item } = await load(params)
  const url = `https://phanviet.vn/${countryCode}/icegel/${item.slug}`
  const title = `${item.title} | Phan Việt`
  return {
    title,
    description: item.description,
    alternates: { canonical: url },
    openGraph: { title, description: item.description, url, siteName: "Phan Việt", type: "website", images: item.thumb ? [{ url: item.thumb, width: 1000, height: 1000, alt: item.title }] : [] },
    twitter: { card: "summary_large_image", title, description: item.description, images: item.thumb ? [item.thumb] : [] },
  }
}

export default async function IcegelProductPage({ params }: Props) {
  const { countryCode, items, item } = await load(params)
  const url = `https://phanviet.vn/${countryCode}/icegel/${item.slug}`
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: item.title,
      image: item.images,
      description: item.description,
      sku: item.variantId,
      brand: { "@type": "Brand", name: "ICEgel" },
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: "VND",
        price: item.price,
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
        seller: { "@type": "Organization", name: "Phan Việt" },
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Phan Việt", item: `https://phanviet.vn/${countryCode}` },
        { "@type": "ListItem", position: 2, name: "ICEgel", item: `https://phanviet.vn/${countryCode}/icegel` },
        { "@type": "ListItem", position: 3, name: item.short, item: url },
      ],
    },
  ]
  const specs: [string, string][] = [
    ["Quy cách", item.pack],
    ["Dùng cho", item.who],
    ["Cách dùng", item.how],
    ["Thành phần", item.ingredients],
    ["Số công bố", `${item.congBo} — thiết bị y tế loại A`],
    ["Sản xuất", "Foshan Biours (Trung Quốc). Phân phối: Công ty TNHH Xinh Today"],
  ]

  const landing = item.landing
  // The landing hero carries the page's h1; the product block then uses h2
  const TitleTag = landing ? "h2" : "h1"

  return (
    <div className="bg-gray-50 min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ProductPixelTracker pixelIds={[]} productId={item.id} productTitle={item.title} price={item.price} currency="VND" />
      <div className="max-w-5xl mx-auto px-4">
        <nav aria-label="Đường dẫn" className="pt-3 text-[12px] text-gray-500">
          <LocalizedClientLink href="/icegel" className="font-semibold text-sky-700">ICEgel</LocalizedClientLink>
          <span className="mx-1.5" aria-hidden="true">›</span>
          <span>{item.short}</span>
        </nav>

        {landing && (
          <div className="mt-2">
            <LandingHero data={landing} price={item.price} pack={item.pack} />
            <LandingBody data={landing} />
          </div>
        )}

        <div className={`grid grid-cols-1 md:grid-cols-2 gap-5 ${landing ? "mt-8" : "mt-2"}`}>
          <div className="min-w-0">
            <IcegelGallery images={item.images} alt={item.title} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {item.badges.map((badge) => (
                <span key={badge} className={`text-[11px] font-black px-2 py-0.5 rounded-full ${badge === "Bán chạy" ? "bg-orange-500 text-white" : "bg-sky-50 text-sky-800 border border-sky-100"}`}>{badge}</span>
              ))}
            </div>
            <TitleTag className="mt-2 text-xl sm:text-2xl font-black text-gray-900 leading-snug">{item.title}</TitleTag>
            {item.subtitle && <p className="mt-1 text-[14px] text-gray-600">{item.subtitle}</p>}
            <p className="mt-2 text-2xl font-black text-orange-600">{formatVND(item.price)} <span className="text-[13px] font-semibold text-gray-500">/ hộp</span></p>
            <ul className="mt-3 space-y-1.5">
              {item.benefits.map((benefit) => (
                <li key={benefit} className="flex gap-2 text-[14px] text-gray-800"><span className="text-sky-600 font-black" aria-hidden="true">✓</span>{benefit}</li>
              ))}
            </ul>
            <div className="mt-4 rounded-2xl bg-white border border-sky-100 p-3">
              <p className="text-[13px] font-black text-gray-900">Mua nhiều hộp bất kỳ, nhận thêm quà</p>
              <div className="mt-2"><TierProgress boxes={0} /></div>
            </div>
          </div>
        </div>

        <section className="mt-6" aria-labelledby="mua-kem">
          <h2 id="mua-kem" className="text-lg font-black text-gray-900">Chọn số hộp & mua kèm</h2>
          <p className="text-[13px] text-gray-600">Cộng dồn với các dòng khác để đạt mốc tặng quà và miễn phí ship.</p>
          <div className="mt-3">
            <IcegelShop items={items} focus={item} mode="addons" />
          </div>
        </section>

        <section className="mt-8 rounded-2xl bg-white border border-gray-100 p-4" aria-labelledby="thong-tin">
          <h2 id="thong-tin" className="text-lg font-black text-gray-900">Thông tin sản phẩm</h2>
          <p className="mt-2 text-[14px] text-gray-700 leading-relaxed">{item.description}</p>
          <dl className="mt-3 divide-y divide-gray-100">
            {specs.map(([label, value]) => (
              <div key={label} className="py-2.5 grid grid-cols-[6.5rem_1fr] gap-3 text-[14px]">
                <dt className="font-bold text-gray-500">{label}</dt>
                <dd className="text-gray-800 leading-relaxed">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-gray-500">Sản phẩm không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh.</p>
        </section>

        {landing && <LandingCautions data={landing} />}
        <IcegelTrust />
        <IcegelFaq extra={landing?.faq ?? []} />
      </div>
    </div>
  )
}
