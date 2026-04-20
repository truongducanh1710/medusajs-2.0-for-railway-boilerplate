import { Metadata } from "next"
import { Suspense } from "react"

import { LocaleProvider } from "@lib/locale-context"
import { localeFromCountryCode } from "@lib/i18n"
import Footer from "@modules/layout/templates/footer"
import Nav from "@modules/layout/templates/nav"
import { getBaseURL } from "@lib/util/env"
import FacebookPixel from "@components/FacebookPixel"
import UtmCapture from "@components/UtmCapture"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

const GLOBAL_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID || "1253926913606924"

export default async function PageLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const locale = localeFromCountryCode(countryCode)

  const pixelIds = GLOBAL_PIXEL_ID ? [GLOBAL_PIXEL_ID] : []

  return (
    <LocaleProvider locale={locale}>
      <FacebookPixel pixelIds={pixelIds} />
      <Suspense fallback={null}>
        <UtmCapture />
      </Suspense>
      <Nav countryCode={countryCode} />
      <main className="pt-16 sm:pt-20">
        {children}
      </main>
      <Footer countryCode={countryCode} />
    </LocaleProvider>
  )
}
