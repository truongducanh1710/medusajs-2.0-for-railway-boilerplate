import { Suspense } from "react"

import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

export default async function Nav() {
  const regions = await listRegions().then((regions: StoreRegion[]) => regions)

  return (
    <div className="fixed top-0 inset-x-0 z-50">
      <header className="bg-slate-50/80 backdrop-blur-md border-b border-slate-200/50">
        <nav className="flex justify-between items-center h-20 px-6 md:px-12 max-w-[1920px] mx-auto">
          {/* Mobile menu */}
          <div className="flex items-center md:hidden">
            <SideMenu regions={regions} />
          </div>

          {/* Logo */}
          <LocalizedClientLink
            href="/"
            className="text-2xl font-black tracking-tighter text-orange-500"
            data-testid="nav-store-link"
          >
            PHAN VIỆT
          </LocalizedClientLink>

          {/* Desktop nav links */}
          <div className="hidden md:flex gap-8 font-medium text-sm tracking-tight">
            <LocalizedClientLink
              href="/"
              className="text-orange-500 border-b-2 border-orange-500 pb-1"
            >
              Trang chủ
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/store"
              className="text-slate-600 hover:text-orange-500 transition-colors"
            >
              Chảo chống dính
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/store"
              className="text-slate-600 hover:text-orange-500 transition-colors"
            >
              Giặt &amp; Sấy
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/store"
              className="text-slate-600 hover:text-orange-500 transition-colors"
            >
              Thiết bị gia dụng
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/store"
              className="text-slate-600 hover:text-orange-500 transition-colors"
            >
              Khuyến mãi
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/store"
              className="text-slate-600 hover:text-orange-500 transition-colors"
            >
              Liên hệ
            </LocalizedClientLink>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-4 text-slate-600">
            {/* Search - desktop only */}
            <div className="relative hidden lg:block">
              <input
                className="bg-slate-100 border-none rounded-full py-2 px-6 w-64 text-sm focus:ring-2 focus:ring-orange-400 transition-all outline-none"
                placeholder="Tìm kiếm sản phẩm..."
                type="text"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            </div>

            {/* Account */}
            <LocalizedClientLink
              href="/account"
              className="hover:bg-slate-100 p-2 rounded-full transition-all"
              data-testid="nav-account-link"
            >
              <span className="text-xl">👤</span>
            </LocalizedClientLink>

            {/* Cart */}
            <Suspense
              fallback={
                <LocalizedClientLink
                  href="/cart"
                  className="hover:bg-slate-100 p-2 rounded-full transition-all relative"
                  data-testid="nav-cart-link"
                >
                  <span className="text-xl">🛒</span>
                </LocalizedClientLink>
              }
            >
              <CartButton />
            </Suspense>
          </div>
        </nav>
      </header>
    </div>
  )
}
