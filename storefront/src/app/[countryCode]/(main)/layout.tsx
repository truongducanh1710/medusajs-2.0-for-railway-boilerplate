import { Metadata } from "next"
import { Suspense } from "react"

import { LocaleProvider } from "@lib/locale-context"
import { localeFromCountryCode } from "@lib/i18n"
import Footer from "@modules/layout/templates/footer"
import Nav from "@modules/layout/templates/nav"
import { getBaseURL } from "@lib/util/env"
import FacebookPixel from "@components/FacebookPixel"
import UtmCapture from "@components/UtmCapture"
import FloatingContact from "@components/FloatingContact"
import ChatBot from "@components/ChatBot"
import SocialProofPopup from "@components/SocialProofPopup"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function PageLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const locale = localeFromCountryCode(countryCode)

  return (
    <LocaleProvider locale={locale}>
      <FacebookPixel />
      <Suspense fallback={null}>
        <UtmCapture />
      </Suspense>
      <Nav countryCode={countryCode} />
      <main className="pt-24 sm:pt-28">
        {children}
      </main>
      <Footer countryCode={countryCode} />
      <FloatingContact />
      {/* <ChatBot /> */}
      <SocialProofPopup />
    </LocaleProvider>
  )
}
