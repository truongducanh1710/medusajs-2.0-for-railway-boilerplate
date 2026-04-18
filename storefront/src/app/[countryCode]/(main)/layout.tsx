import { Metadata } from "next"

import { LocaleProvider } from "@lib/locale-context"
import { localeFromCountryCode } from "@lib/i18n"
import Footer from "@modules/layout/templates/footer"
import Nav from "@modules/layout/templates/nav"
import { getBaseURL } from "@lib/util/env"

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
      <Nav countryCode={countryCode} />
      <main className="pt-20">
        {children}
      </main>
      <Footer countryCode={countryCode} />
    </LocaleProvider>
  )
}
