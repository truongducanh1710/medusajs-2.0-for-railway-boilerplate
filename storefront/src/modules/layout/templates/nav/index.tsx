import { Suspense } from "react"

import { getCopy, localeFromCountryCode } from "@lib/i18n"
import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

export default async function Nav({
  countryCode,
}: {
  countryCode?: string
}) {
  const regions = await listRegions().then((regions: StoreRegion[]) => regions)
  const copy = getCopy(localeFromCountryCode(countryCode))

  return (
    <div className="fixed top-0 inset-x-0 z-50">
      <header className="bg-slate-50/90 backdrop-blur-md border-b border-slate-200/50">
        <nav className="flex justify-between items-center h-16 sm:h-20 px-4 sm:px-6 md:px-12 max-w-[1920px] mx-auto">
          {/* Mobile: hamburger left */}
          <div className="flex items-center md:hidden">
            <SideMenu regions={regions} />
          </div>

          {/* Logo center on mobile, left on desktop */}
          <LocalizedClientLink
            href="/"
            className="text-xl sm:text-2xl font-black tracking-tighter text-orange-500"
            data-testid="nav-store-link"
          >
            PHAN VIỆT
          </LocalizedClientLink>

          {/* Desktop nav links */}
          <div className="hidden md:flex gap-8 font-medium text-sm tracking-tight">
            <LocalizedClientLink href="/" className="text-orange-500 border-b-2 border-orange-500 pb-1">
              {copy.nav.home}
            </LocalizedClientLink>
            <LocalizedClientLink href="/store" className="text-slate-600 hover:text-orange-500 transition-colors">
              {copy.nav.store}
            </LocalizedClientLink>
            <LocalizedClientLink href="/categories" className="text-slate-600 hover:text-orange-500 transition-colors">
              {copy.nav.categories}
            </LocalizedClientLink>
            <LocalizedClientLink href="/store" className="text-slate-600 hover:text-orange-500 transition-colors">
              {copy.nav.promo}
            </LocalizedClientLink>
            <LocalizedClientLink href="/store" className="text-slate-600 hover:text-orange-500 transition-colors">
              {copy.nav.contact}
            </LocalizedClientLink>
          </div>

          {/* Right icons */}
          <div className="flex items-center gap-2 sm:gap-4 text-slate-600">
            {/* Search: icon on mobile, input on desktop */}
            <LocalizedClientLink
              href="/store"
              className="md:hidden hover:bg-slate-100 p-2 rounded-full transition-all"
              aria-label="Tìm kiếm"
            >
              <span className="text-lg">🔍</span>
            </LocalizedClientLink>
            <div className="relative hidden md:block">
              <input
                className="bg-slate-100 border-none rounded-full py-2 px-6 w-64 text-sm focus:ring-2 focus:ring-orange-400 transition-all outline-none"
                placeholder={copy.nav.searchPlaceholder}
                type="text"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            </div>

            <LocalizedClientLink
              href="/account"
              className="hidden sm:flex hover:bg-slate-100 p-2 rounded-full transition-all"
              data-testid="nav-account-link"
            >
              <span className="text-xl">👤</span>
            </LocalizedClientLink>

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
