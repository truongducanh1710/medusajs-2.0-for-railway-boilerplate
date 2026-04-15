import { Suspense } from "react"

import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import SideMenu from "@modules/layout/components/side-menu"

export default async function Nav() {
  const regions = await listRegions().then((regions: StoreRegion[]) => regions)

  return (
    <div className="sticky top-0 inset-x-0 z-50 group">
      {/* Top bar */}
      <div className="bg-brand-secondary text-white text-xs text-center py-1.5 hidden small:block">
        🚚 Miễn phí vận chuyển cho đơn hàng từ 500.000đ &nbsp;|&nbsp; Hotline: 1800 xxxx
      </div>
      {/* Main nav */}
      <header className="relative h-16 mx-auto duration-200 bg-white border-b border-gray-200 shadow-sm">
        <nav className="content-container flex items-center justify-between w-full h-full">
          {/* Mobile menu */}
          <div className="flex-1 basis-0 h-full flex items-center small:hidden">
            <SideMenu regions={regions} />
          </div>

          {/* Logo */}
          <div className="flex items-center h-full">
            <LocalizedClientLink
              href="/"
              className="flex items-center gap-2"
              data-testid="nav-store-link"
            >
              <span className="text-brand-primary font-extrabold text-2xl tracking-tight">PHAN</span>
              <span className="text-brand-secondary font-extrabold text-2xl tracking-tight">VIET</span>
            </LocalizedClientLink>
          </div>

          {/* Desktop links */}
          <div className="flex items-center gap-x-6 h-full flex-1 basis-0 justify-end">
            <div className="hidden small:flex items-center gap-x-6 h-full text-sm font-medium text-gray-700">
              <LocalizedClientLink className="hover:text-brand-primary transition-colors" href="/store">
                Sản phẩm
              </LocalizedClientLink>
              {process.env.NEXT_PUBLIC_FEATURE_SEARCH_ENABLED && (
                <LocalizedClientLink
                  className="hover:text-brand-primary transition-colors"
                  href="/search"
                  scroll={false}
                  data-testid="nav-search-link"
                >
                  Tìm kiếm
                </LocalizedClientLink>
              )}
              <LocalizedClientLink
                className="hover:text-brand-primary transition-colors"
                href="/account"
                data-testid="nav-account-link"
              >
                Tài khoản
              </LocalizedClientLink>
            </div>
            <Suspense
              fallback={
                <LocalizedClientLink
                  className="hover:text-brand-primary flex gap-2 text-sm font-medium"
                  href="/cart"
                  data-testid="nav-cart-link"
                >
                  Giỏ hàng (0)
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
