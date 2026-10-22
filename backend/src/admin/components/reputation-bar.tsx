// Customer reputation across the whole Pancake network (the green/red bar on the POS order
// screen): delivered vs returned orders for this phone number, plus the shop's own history.

export type Rep = { available?: boolean; success?: number; fail?: number; return_rate?: number | null; flagged?: boolean } | null

export function repTier(rep: Rep): { label: string; tone: "good" | "bad" | "neutral" | "new" | "unknown" } {
  if (!rep?.available) return { label: "Chưa tải được uy tín", tone: "unknown" }
  const s = rep.success ?? 0, f = rep.fail ?? 0, rate = rep.return_rate ?? 0
  if (rep.flagged || (s + f >= 3 && rate >= 30)) return { label: "Hay bom / hoàn hàng", tone: "bad" }
  if (s + f === 0) return { label: "Khách mới, chưa có lịch sử", tone: "new" }
  if (s >= 3 && rate < 10) return { label: "Khách tốt", tone: "good" }
  return { label: "Bình thường", tone: "neutral" }
}

const TONE: Record<string, string> = {
  good: "border-green-300 bg-green-50 text-green-800",
  bad: "border-red-400 bg-red-50 text-red-800",
  neutral: "border-gray-200 bg-gray-50 text-gray-800",
  new: "border-gray-200 bg-gray-50 text-gray-700",
  unknown: "border-gray-200 bg-gray-50 text-gray-500",
}

export default function ReputationBar({ rep, shop }: { rep: Rep; shop?: { orders: number; succeeded: number; returned: number } }) {
  const t = repTier(rep)
  const s = rep?.success ?? 0, f = rep?.fail ?? 0
  const total = s + f
  return (
    <div className={`rounded-lg border-2 p-3 ${TONE[t.tone]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">{t.tone === "bad" ? "⚠ " : ""}{t.label}</div>
        {rep?.available && total > 0 && (
          <div className="text-sm">
            <b className="text-green-700">{s}</b> thành công · <b className="text-red-700">{f}</b> hoàn ·{" "}
            tỷ lệ hoàn <b className={(rep.return_rate ?? 0) >= 30 ? "text-red-700" : ""}>{rep.return_rate}%</b>
            {rep.flagged && <span className="ml-1 px-1.5 rounded bg-red-600 text-white text-xs">POS cảnh báo</span>}
          </div>
        )}
      </div>
      {rep?.available && total > 0 && (
        <div className="mt-2 h-2 rounded-full overflow-hidden flex bg-gray-200" aria-label={`${s} thành công, ${f} hoàn`}>
          <div className="bg-green-500" style={{ width: `${(s / total) * 100}%` }} />
          <div className="bg-red-500" style={{ width: `${(f / total) * 100}%` }} />
        </div>
      )}
      <div className="mt-1 text-xs opacity-80">
        Toàn mạng Pancake theo SĐT{shop ? ` · Shop mình: ${shop.orders} đơn, ${shop.succeeded} thành công, ${shop.returned} hoàn` : ""}
        {t.tone === "bad" && " · Xác nhận kỹ, yêu cầu chuyển khoản / cọc trước"}
      </div>
    </div>
  )
}

/** Compact chip for queue rows. */
export function RepChip({ rep }: { rep: Rep }) {
  const t = repTier(rep)
  if (t.tone === "unknown") return <span className="text-xs text-gray-400">—</span>
  const cls = t.tone === "bad" ? "bg-red-100 text-red-700" : t.tone === "good" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
  const total = (rep?.success ?? 0) + (rep?.fail ?? 0)
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${cls}`} title={t.label}>
      {total ? `${rep?.success}/${rep?.fail} · hoàn ${rep?.return_rate}%` : "mới"}
    </span>
  )
}
