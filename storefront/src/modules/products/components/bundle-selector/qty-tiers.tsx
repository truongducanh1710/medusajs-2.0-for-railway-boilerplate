"use client"

type TierOption = { qty: number; price: number; originalPrice: number }

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

/**
 * Quantity stepper for a version whose bundle_options_v2 entry lists several quantities
 * (e.g. printed calendar: 1 / 2 −20% / 3+ −30%). Prices come from metadata; the server
 * re-applies the same table to the cart line.
 */
export default function QtyTiers({
  options,
  selected,
  onSelect,
  note,
  unit = "cuốn",
}: {
  options: TierOption[]
  selected: number
  onSelect: (qty: number) => void
  note?: string
  unit?: string
}) {
  const qtys = options.map((o) => o.qty).sort((a, b) => a - b)
  const current = options.find((o) => o.qty === selected) ?? options[0]
  const idx = qtys.indexOf(current.qty)
  const saved = Math.max(0, current.originalPrice - current.price)
  const btn = "w-9 h-9 rounded-lg border-2 border-gray-300 bg-white text-lg font-black text-gray-700 disabled:opacity-30 active:scale-95"

  return (
    <div className="mt-2.5 rounded-xl border border-orange-200 bg-orange-50/60 p-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-gray-800">Số lượng</span>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Giảm số lượng" className={btn} disabled={idx <= 0} onClick={() => onSelect(qtys[idx - 1])}>−</button>
          <span className="min-w-[2.2rem] text-center text-base font-black tabular-nums" aria-live="polite">{current.qty}</span>
          <button type="button" aria-label="Tăng số lượng" className={btn} disabled={idx >= qtys.length - 1} onClick={() => onSelect(qtys[idx + 1])}>+</button>
        </div>
        <span className="ml-auto text-right leading-tight">
          <span className="block font-black text-orange-500 text-base">{formatVND(current.price)}</span>
          {saved > 0 && <span className="block text-[11px] text-gray-400 line-through">{formatVND(current.originalPrice)}</span>}
        </span>
      </div>
      {note && <p className="text-[12px] font-bold text-red-600">🔥 {note}</p>}
      {saved > 0 && (
        <p className="text-[11.5px] font-semibold text-green-700">
          {current.qty} {unit} · tiết kiệm {formatVND(saved)}
        </p>
      )}
    </div>
  )
}
