/**
 * "Pick 1 gift" for a bundle option (bundle_options[].giftChoice = { label, items: [{ name, value, image, sku }] }).
 * The picked item is merged into the option's gifts by BundleSelector, so cart metadata, the
 * checkout page and the Pancake push (gift sku → 0đ POS line) all see the customer's choice.
 */
export type GiftChoiceItem = { name: string; value?: number; image?: string; sku?: string }
export type GiftChoice = { label?: string; items: GiftChoiceItem[] }

export function validGiftChoice(raw: unknown): GiftChoice | undefined {
  const items = Array.isArray((raw as any)?.items)
    ? (raw as any).items.filter((g: any) => g && typeof g.name === "string" && g.name.trim())
    : []
  return items.length >= 2 ? { label: (raw as any)?.label, items } : undefined
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export default function GiftChoicePicker({
  choice,
  picked,
  onPick,
}: {
  choice: GiftChoice
  picked: number
  onPick: (index: number) => void
}) {
  return (
    <div className="rounded-lg border-2 border-orange-300 bg-orange-50 px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
      <p className="mb-1.5 text-[12px] font-black text-orange-700">🎁 {choice.label || "CHỌN 1 QUÀ TẶNG"}</p>
      <div className="grid grid-cols-2 gap-2">
        {choice.items.map((item, i) => {
          const active = i === picked
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              aria-pressed={active}
              className={`relative flex flex-col items-center rounded-lg border-2 bg-white p-1.5 text-center transition-all ${
                active ? "border-orange-500 shadow-md" : "border-gray-200"
              }`}
            >
              {active && (
                <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white">
                  ✓
                </span>
              )}
              {item.image ? (
                <img src={item.image} alt={item.name} className="h-16 w-16 rounded-md object-contain" loading="lazy" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center text-3xl">🎁</span>
              )}
              <span className="mt-1 text-[11.5px] font-bold leading-tight text-gray-800">{item.name}</span>
              {typeof item.value === "number" && item.value > 0 && (
                <span className="text-[11px] text-gray-400 line-through">{formatVND(item.value)}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
