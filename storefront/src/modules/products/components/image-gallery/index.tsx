"use client"

import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { useState } from "react"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
}

const ImageGallery = ({ images }: ImageGalleryProps) => {
  const [active, setActive] = useState(0)

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
