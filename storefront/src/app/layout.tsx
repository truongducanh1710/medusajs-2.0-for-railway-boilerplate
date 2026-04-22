import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import { Be_Vietnam_Pro } from "next/font/google"
import Script from "next/script"
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
        <Script id="clarity" strategy="afterInteractive">{`
          (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "wfm2h22kzr");
        `}</Script>
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
