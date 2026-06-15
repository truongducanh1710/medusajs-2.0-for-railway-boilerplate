"use client"

const FALLBACK = "/logo-vietmate.png.png"

export default function LogoImage({ src }: { src: string }) {
  return (
    <img
      src={src || FALLBACK}
      alt="Vietmate"
      className="h-9 sm:h-20 object-contain"
      style={{ mixBlendMode: "multiply" }}
      onError={(e) => {
        const img = e.target as HTMLImageElement
        if (img.src !== window.location.origin + FALLBACK) {
          img.src = FALLBACK
        }
      }}
    />
  )
}
