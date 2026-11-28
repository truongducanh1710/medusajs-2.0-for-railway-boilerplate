import type { MetadataRoute } from "next"

// Canonical host used by every page's <link rel="canonical">
const SITE = "https://phanviet.vn"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private or per-visitor pages: account, cart, checkout, order confirmations, search results
        disallow: ["/*/account", "/*/cart", "/*/checkout", "/*/order/", "/*/results/", "/api/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  }
}
