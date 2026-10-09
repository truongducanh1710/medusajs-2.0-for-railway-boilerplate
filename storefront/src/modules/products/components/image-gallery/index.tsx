"use client"

import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { useState, useEffect } from "react"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
  productId?: string
  bundleGallerySync?: boolean
  initialBundleImage?: string
}

const ImageGallery = ({ images, productId, bundleGallerySync = false, initialBundleImage }: ImageGalleryProps) => {
  const [active, setActive] = useState(() => {
    const index = bundleGallerySync ? images.findIndex(image => image.url === initialBundleImage) : 0
    return index >= 0 ? index : 0
  })

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent<string>).detail
      if (!url) return
      const idx = images.findIndex(img => img.url === url)
      if (idx >= 0) setActive(idx)
    }
    window.addEventListener("variant-image-change", handler)
    return () => window.removeEventListener("variant-image-change", handler)
  }, [images])


  useEffect(() => {
    if (!bundleGallerySync || !productId) return
    const selectImage = (url: unknown) => {
      if (typeof url !== "string" || !url) return
      const index = images.findIndex(image => image.url === url)
      if (index >= 0) setActive(index)
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ productId?: string; image?: string }>).detail
      if (detail?.productId === productId) selectImage(detail.image)
    }
    window.addEventListener("pvb-bundle-select", handler)
    // A selector may publish before this listener mounts; consume its latest scoped pick.
    const shared = window as Window & {
      __pvBundleGallerySelections?: Record<string, { qty: number; image?: string }>
    }
    selectImage(shared.__pvBundleGallerySelections?.[productId]?.image || initialBundleImage)
    return () => window.removeEventListener("pvb-bundle-select", handler)
  }, [images, productId, bundleGallerySync, initialBundleImage])

  if (!images.length) return null

  const mainImage = images[active]

  return (
    <div className="flex flex-col gap-3">
      {/* Main image */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white">
        {mainImage?.url && (
          <Image
            src={mainImage.url}
            alt={`Product image ${active + 1}`}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            style={{ objectFit: "contain" }}
            className="transition-opacity duration-200"
          />
        )}
      </div>

      {/* Thumbnail strip — only show if >1 image */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActive(i)}
              className={`flex-shrink-0 relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border-2 transition-all ${
                i === active
                  ? "border-blue-600 shadow-md"
                  : "border-gray-200 hover:border-gray-400"
              }`}
            >
              {img.url && (
                <Image
                  src={img.url}
                  alt={`Thumbnail ${i + 1}`}
                  fill
                  sizes="80px"
                  style={{ objectFit: "cover" }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageGallery
