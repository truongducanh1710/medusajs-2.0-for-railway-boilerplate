import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import { Be_Vietnam_Pro } from "next/font/google"
import "styles/globals.css"

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-be-vietnam-pro",
})

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  viewport: "width=device-width, initial-scale=1.0",
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-mode="light">
      <body className={beVietnamPro.className}>
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
