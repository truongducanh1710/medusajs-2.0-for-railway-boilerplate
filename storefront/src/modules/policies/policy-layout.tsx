import React from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

const POLICY_LINKS = [
  { href: "/gioi-thieu", label: "Giới thiệu về chúng tôi" },
  { href: "/chinh-sach-doi-tra", label: "Chính sách đổi trả" },
  { href: "/chinh-sach-bao-mat", label: "Chính sách bảo mật" },
  { href: "/chinh-sach-giao-hang", label: "Chính sách giao hàng" },
  { href: "/chinh-sach-thanh-toan", label: "Chính sách thanh toán" },
  { href: "/chinh-sach-kiem-hang", label: "Chính sách kiểm hàng" },
]

export default function PolicyLayout({
  title,
  currentHref,
  children,
}: {
  title: string
  currentHref: string
  children: React.ReactNode
}) {
  return (
    <>
      {/* Hero strip */}
      <div className="bg-red-700 py-10 text-center">
        <div className="max-w-4xl mx-auto px-4">
          <p className="text-red-300 text-sm mb-2">
            <LocalizedClientLink href="/" className="hover:text-white transition-colors">Trang chủ</LocalizedClientLink>
            {" › "}
            <span className="text-white">{title}</span>
          </p>
          <h1 className="text-white font-black text-2xl sm:text-3xl md:text-4xl">{title}</h1>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="md:w-56 flex-shrink-0">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="font-black text-sm text-gray-700 mb-3 uppercase tracking-wide">Chính sách</p>
            <ul className="space-y-1">
              {POLICY_LINKS.map((link) => (
                <li key={link.href}>
                  <LocalizedClientLink
                    href={link.href}
                    className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                      currentHref === link.href
                        ? "bg-orange-500 text-white font-bold"
                        : "text-gray-600 hover:bg-orange-50 hover:text-orange-600"
                    }`}
                  >
                    {link.label}
                  </LocalizedClientLink>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-gray-100 p-6 sm:p-8 policy-content">
            <style>{`
              .policy-content h2 { font-weight: 900; font-size: 1.15rem; color: #111827; margin-top: 2rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #f97316; display: inline-block; }
              .policy-content h2:first-child { margin-top: 0; }
              .policy-content h3 { font-weight: 700; font-size: 1rem; color: #1f2937; margin-top: 1.25rem; margin-bottom: 0.5rem; }
              .policy-content p { color: #4b5563; line-height: 1.75; margin-bottom: 0.75rem; }
              .policy-content ul { list-style: none; padding: 0; margin: 0.5rem 0 1rem; }
              .policy-content ul li { color: #4b5563; padding: 0.35rem 0 0.35rem 1.25rem; position: relative; line-height: 1.65; }
              .policy-content ul li::before { content: "→"; position: absolute; left: 0; color: #f97316; font-weight: 700; }
              .policy-content strong { color: #111827; font-weight: 700; }
            `}</style>
            {children}
          </div>
        </main>
      </div>
    </>
  )
}
