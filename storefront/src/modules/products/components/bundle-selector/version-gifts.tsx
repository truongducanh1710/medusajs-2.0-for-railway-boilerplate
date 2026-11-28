/**
 * Gifts of a version card (bundle_options_v2 variants[].gifts), each tagged with the payment
 * method that earns it. Each version now has one payment method (printed calendar = COD,
 * download = QR transfer, user 28/11), so every listed gift comes with the order and no tag is shown.
 * The backend sends the same gifts by email from variant.metadata.gift_links.
 */
export type VersionGift = {
  name: string
  value?: number
  image?: string
  when?: "any" | "transfer"
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export function validGifts(gifts: unknown): VersionGift[] {
  return Array.isArray(gifts) ? gifts.filter((g: any) => g && typeof g.name === "string" && g.name.trim()) : []
}

export default function VersionGifts({ gifts, compact, codAllowed = true }: { gifts: VersionGift[]; compact?: boolean; codAllowed?: boolean }) {
  if (!gifts.length) return null
  if (compact) {
    return <p className="mt-1.5 text-[12px] font-bold text-blue-600">🎁 +{gifts.length} QUÀ TẶNG MIỄN PHÍ</p>
  }
  return (
    <div className="mt-2.5 rounded-lg border border-dashed border-blue-200 bg-blue-50 px-3 py-2">
      <p className="text-[12px] font-black text-blue-700">🎁 QUÀ TẶNG KÈM</p>
      {gifts.map((g, i) => (
        <div key={i} className={`flex items-center gap-2.5 py-1.5 ${i ? "border-t border-blue-100" : ""}`}>
          {g.image ? (
            <img src={g.image} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg border border-blue-200 object-cover" />
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-lg">🎁</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold leading-snug text-gray-800">
              <span className="font-black text-blue-600">TẶNG! </span>
              {g.name}
            </p>
          </div>
          {typeof g.value === "number" && g.value > 0 && (
            <p className="flex-shrink-0 text-xs text-gray-400 line-through">{formatVND(g.value)}</p>
          )}
        </div>
      ))}
    </div>
  )
}
