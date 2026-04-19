"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { usePathname } from "next/navigation"

export default function MobileBottomNav() {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/") return pathname.endsWith("/") || pathname.match(/^\/[a-z]{2}$/)
    return pathname.includes(href)
  }

  const links = [
    { href: "/", icon: "🏠", label: "Trang chủ" },
    { href: "/store", icon: "🛍️", label: "Cửa hàng" },
    { href: "/categories", icon: "📦", label: "Danh mục" },
    { href: "/account", icon: "👤", label: "Tài khoản" },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-white border-t border-slate-200 shadow-lg">
      <div className="grid grid-cols-4 h-16">
        {links.map((link) => (
          <LocalizedClientLink
            key={link.href}
            href={link.href}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
              isActive(link.href)
                ? "text-orange-500"
                : "text-slate-500"
            }`}
          >
            <span className="text-xl leading-none">{link.icon}</span>
            <span>{link.label}</span>
          </LocalizedClientLink>
        ))}
      </div>
    </nav>
  )
}
