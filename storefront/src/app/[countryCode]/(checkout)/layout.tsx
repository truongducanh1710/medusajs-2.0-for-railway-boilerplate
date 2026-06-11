import { LocaleProvider } from "@lib/locale-context"
import { localeFromCountryCode } from "@lib/i18n"
import FacebookPixel from "@components/FacebookPixel"
import { getStoreMetadata } from "@lib/data/store"

export default async function CheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const locale = localeFromCountryCode(countryCode)
  const storeMeta = await getStoreMetadata()
  const storePixelId = storeMeta.fb_pixel_id || ""

  return (
    <LocaleProvider locale={locale}>
      <FacebookPixel storePixelId={storePixelId} />
      <div className="w-full bg-white relative small:min-h-screen">
        {/* Header gộp vào SimpleCheckout — không render nav riêng để tiết kiệm chỗ mobile */}
        <div className="relative" data-testid="checkout-container">
          {children}
        </div>
      </div>
    </LocaleProvider>
  )
}
