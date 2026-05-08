import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { LocaleProvider } from "@lib/locale-context"
import { getCopy, localeFromCountryCode } from "@lib/i18n"
import MedusaCTA from "@modules/layout/components/medusa-cta"
import BackButton from "@modules/checkout/components/back-button"

export default async function CheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const locale = localeFromCountryCode(countryCode)
  const checkoutCopy = getCopy(locale) as any

  return (
    <LocaleProvider locale={locale}>
      <div className="w-full bg-white relative small:min-h-screen">
        <div className="h-16 bg-white border-b ">
          <nav className="flex h-full items-center content-container justify-between">
            <BackButton backLabel={checkoutCopy.backToCart} mobileLabel={checkoutCopy.back} />
            <LocalizedClientLink
              href="/"
              className="txt-compact-xlarge-plus text-ui-fg-subtle hover:text-ui-fg-base uppercase"
              data-testid="store-link"
            >
              {checkoutCopy.storeName}
            </LocalizedClientLink>
            <div className="flex-1 basis-0" />
          </nav>
        </div>
        <div className="relative" data-testid="checkout-container">
          {children}
        </div>
        <div className="py-4 w-full flex items-center justify-center">
          <MedusaCTA locale={locale} />
        </div>
      </div>
    </LocaleProvider>
  )
}
