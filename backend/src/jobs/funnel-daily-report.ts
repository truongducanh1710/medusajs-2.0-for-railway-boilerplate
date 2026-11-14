import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { FUNNEL_EXTRAS, FUNNEL_MIN_SAMPLE, FUNNEL_STEPS, funnelReport } from "../lib/funnel"
import { notifyTelegramByEmail } from "../lib/notify"

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–")

/**
 * 21:00 VN — today's landing funnel per product that has metadata.notify_tg_emails,
 * total + per video (ad name), and the step with the biggest drop.
 */
export default async function funnelDailyReport(container: MedusaContainer) {
  try {
    const productService = container.resolve(Modules.PRODUCT) as any
    const userModule = container.resolve(Modules.USER)
    const products = await productService.listProducts({}, { select: ["id", "title", "handle", "metadata"], take: 500 })
    const day = vnToday()
    for (const p of products) {
      const emails = String(p.metadata?.notify_tg_emails ?? "").split(",").map((s: string) => s.trim()).filter(Boolean)
      if (!emails.length || !p.handle) continue
      const [all] = await funnelReport(p.handle, day, day, "none")
      if (!all?.events?.view) continue
      const ev = all.events, base = ev.view
      const lines = [`📊 <b>Phễu landing hôm nay — ${p.title}</b>`]
      for (const s of FUNNEL_STEPS) lines.push(`${s.label}: <b>${ev[s.key] ?? 0}</b> (${pct(ev[s.key] ?? 0, base)})`)
      lines.push(FUNNEL_EXTRAS.map((s) => `${s.label}: <b>${ev[s.key] ?? 0}</b>`).join(" · "))
      if (all.med_sec != null) lines.push(`⏱️ Ở trang (trung vị): ${all.med_sec}s`)
      // Biggest relative drop between consecutive steps (ignore steps with too few sessions before)
      let worst: { from: string; to: string; keep: number } | null = null
      for (let i = 1; i < FUNNEL_STEPS.length; i++) {
        const a = ev[FUNNEL_STEPS[i - 1].key] ?? 0, b = ev[FUNNEL_STEPS[i].key] ?? 0
        if (a < FUNNEL_MIN_SAMPLE) continue
        const keep = b / a
        if (!worst || keep < worst.keep) worst = { from: FUNNEL_STEPS[i - 1].label, to: FUNNEL_STEPS[i].label, keep }
      }
      if (worst) lines.push(``, `⚠️ Rơi nhiều nhất: ${worst.from} → ${worst.to} (chỉ còn ${Math.round(worst.keep * 100)}%)`)
      const byAd = await funnelReport(p.handle, day, day, "ad")
      if (byAd.length > 1) {
        lines.push(``, `<b>Theo video</b> (vào → chọn bản → mở form → đặt đơn):`)
        for (const r of byAd.slice(0, 8)) {
          const e = r.events
          lines.push(`${r.group}: ${e.view ?? 0} → ${e.variant_select ?? 0} → ${e.checkout_open ?? 0} → ${e.order ?? 0}`)
        }
      }
      lines.push(``, `Chi tiết: api.phanviet.vn/app/phieu-landing`)
      await notifyTelegramByEmail(userModule, emails, lines.join("\n"), "funnel_daily")
    }
  } catch (e: any) {
    console.error("[FunnelDailyReport] error:", e.message)
  }
}

export const config = {
  name: "funnel-daily-report",
  schedule: "0 14 * * *", // 21:00 VN (server cron runs in UTC)
}
