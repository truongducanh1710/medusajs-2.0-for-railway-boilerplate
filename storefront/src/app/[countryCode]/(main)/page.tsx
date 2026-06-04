import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import { getCollectionsWithProducts } from "@lib/data/collections"
import { getRegion } from "@lib/data/regions"

export const metadata: Metadata = {
  title: "Phan Việt",
  description:
    "Cửa hàng thương mại điện tử Phan Việt với trải nghiệm nhanh và thân thiện.",
  openGraph: {
    title: "Phan Việt",
    description:
      "Cửa hàng thương mại điện tử Phan Việt với trải nghiệm nhanh và thân thiện.",
    type: "website",
    siteName: "Phan Việt",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 1200,
        alt: "Chảo Hợp Kim Titan - Phan Việt",
      },
    ],
  },
}

export default async function Home({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const collections = await getCollectionsWithProducts(countryCode)
  const region = await getRegion(countryCode)

  if (!collections || !region) {
    return null
  }

  return (
    <>
      <Hero countryCode={countryCode} />
      <div className="py-8 sm:py-12">
        <ul className="flex flex-col gap-x-6">
          <FeaturedProducts collections={collections} region={region} />
        </ul>
      </div>
    </>
  )
}
