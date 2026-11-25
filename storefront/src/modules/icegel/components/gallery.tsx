"use client"

import { useRef, useState } from "react"

export default function IcegelGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  const go = (index: number) => {
    const track = trackRef.current
    if (!track) return
    track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" })
  }

  return (
    <div>
      <div
        ref={trackRef}
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar rounded-2xl bg-white border border-gray-100 aspect-square"
        onScroll={(event) => {
          const track = event.currentTarget
          setActive(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)))
        }}
      >
        {images.map((src, index) => (
          <img
            key={src}
            src={src}
            alt={index === 0 ? alt : `${alt} – ảnh ${index + 1}`}
            loading={index === 0 ? "eager" : "lazy"}
            fetchPriority={index === 0 ? "high" : "auto"}
            className="w-full h-full flex-shrink-0 snap-center object-contain"
          />
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {images.map((src, index) => (
            <button
              key={src}
              type="button"
              onClick={() => go(index)}
              aria-label={`Xem ảnh ${index + 1}`}
              aria-current={active === index}
              className={`w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden border-2 bg-white ${active === index ? "border-sky-600" : "border-transparent"}`}
            >
              <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
