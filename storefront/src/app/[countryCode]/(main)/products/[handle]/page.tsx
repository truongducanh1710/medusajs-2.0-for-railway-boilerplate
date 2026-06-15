import { Metadata } from "next"
import { notFound } from "next/navigation"

import ProductTemplate from "@modules/products/templates"
import { getRegion } from "@lib/data/regions"
import { getProductByHandle } from "@lib/data/products"

export const revalidate = 3600

type Props = {
  params: { countryCode: string; handle: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const product = await getProductByHandle(handle, region.id)

  if (!product) {
    notFound()
  }

  const imageUrl = product.thumbnail || (product.images?.[0] as any)?.url || ""
  const ogImage = imageUrl
    ? [{ url: imageUrl, width: 800, height: 800, alt: product.title }]
    : []

  return {
    title: `${product.title} | Phan Việt`,
    description: product.description || product.title,
    openGraph: {
      title: `${product.title} | Phan Việt`,
      description: product.description || product.title,
      url: `https://phanviet.vn/vn/products/${handle}`,
      siteName: "Phan Việt",
      images: ogImage,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${product.title} | Phan Việt`,
      description: product.description || product.title,
      images: imageUrl ? [imageUrl] : [],
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const pricedProduct = await getProductByHandle(params.handle, region.id)
  if (!pricedProduct) {
    notFound()
  }

  return (
    <>
      <ProductTemplate
        product={pricedProduct}
        region={region}
        countryCode={params.countryCode}
      />
    </>
  )
}
