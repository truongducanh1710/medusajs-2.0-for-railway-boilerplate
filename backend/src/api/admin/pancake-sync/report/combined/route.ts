import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMyrToVndRate } from "../../../../../lib/db"

/**
 * GET /admin/pancake-sync/report/combined?from=...&to=...
 *
 * Gop doanh so 2 thi truong ve MOT don vi (VND) de xem tong toan doanh nghiep.
 * Tra ve chuoi ngay voi breakdown theo nen tang cua tung thi truong:
 *
 *   VN: facebook | tiktok | shopee   (facebook = tong VN - tiktok - shopee,
 *       tuc "phan con lai" gom manual/webcake/medusa/zalo... theo yeu cau
 *       nghiep vu — KHONG phai rieng orders co source='facebook')
 *   MY: tiktok   | shopee            (2 san, da quy doi RM -> VND)
 *
 * Doanh thu = SUM(cod_amount) moi trang thai, khop dinh nghia o report/route.ts.
 * MY luu tien don vi sen (RM x 100) nen chia 100 truoc khi nhan ty gia.
 */

const MY_SEN_PER_RM = 100

// Don RAC — giong dinh nghia o report/route.ts, phai khop de 2 tab khong lech nhau:
//   - the "Don trung": loai o MOI trang thai (dem vao la tinh tien 2 lan)
//   - the "Don nhap" o nguon NOI BO: loai khi chua ai xac nhan (status 0/11) hoac
//     da huy/xoa. Nhap DA CHOT (xac nhan/gui hang/giao xong) van tinh — do la tien
//     that. Nguon SAN giu cach cu: san khong co don nhap do sale tao.
const INTERNAL_SOURCES = new Set(["manual", "facebook", "medusa", "webcake", "unknown"])
const hasTag = (o: any, name: string): boolean =>
  Array.isArray(o.tags) && o.tags.some((t: any) => String(t?.name ?? "") === name)
const isJunkOrder = (o: any): boolean => {
  if (hasTag(o, "Đơn trùng")) return true
  if (INTERNAL_SOURCES.has(o.source)) {
    if (o.status === -2 || o.status === 7) return true
    const chuaChot = o.status === 0 || o.status === 11 || o.status === 6 || o.status === -1
    return chuaChot && hasTag(o, "Đơn nháp")
  }
  const cancelledOrDeleted = o.status === 6 || o.status === 7 || o.status === -1
  return cancelledOrDeleted && hasTag(o, "Đơn nháp")
}

// Ngay dia phuong: VN=UTC+7, MY=UTC+8. Gom theo ngay dia phuong cua chinh thi
// truong do (khong ep ve 1 mui) — dung voi cach report/route.ts dang lam.
function localDateStr(d: Date, offsetHours: number): string {
  return new Date(d.getTime() + offsetHours * 3600_000).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  for (let t = start.getTime(); t <= end.getTime(); t += 86400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.query as Record<string, string | undefined>
    if (!from || !to) {
      return res.status(400).json({ error: "Missing required query params: from, to" })
    }

    const fromDate = new Date(from)
    const toDate = new Date(to)
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" })
    }

    const syncService = req.scope.resolve("pancakeSyncModule") as any
    const rate = await getMyrToVndRate(to.slice(0, 10))

    const orders = await syncService.listPancakeOrders(
      { pancake_created_at: { $gte: fromDate, $lte: toDate } },
      {
        take: 20000, // 2 thi truong trong 1 lan goi -> gap doi han cua report thuong
        select: ["id", "source", "status", "cod_amount", "market", "tags", "pancake_created_at"],
        order: { pancake_created_at: "ASC" },
      }
    )

    // Khung ngay lay tu khoang loc (theo ngay VN) de moi ngay deu co dong,
    // ke ca ngay khong phat sinh don — bieu do khong bi "nhay" ngay.
    const dayKeys = daysBetween(
      localDateStr(fromDate, 7),
      localDateStr(toDate, 7)
    )
    const blank = () => ({ vn_fb: 0, vn_tt: 0, vn_sp: 0, my_tt: 0, my_sp: 0, orders_vn: 0, orders_my: 0 })
    const byDay = new Map<string, ReturnType<typeof blank>>()
    for (const d of dayKeys) byDay.set(d, blank())

    let ordersVn = 0, ordersMy = 0, junkCount = 0
    for (const o of orders) {
      if (!o.pancake_created_at) continue
      if (isJunkOrder(o)) { junkCount++; continue }
      const isMy = o.market === "MY"
      const date = localDateStr(new Date(o.pancake_created_at), isMy ? 8 : 7)
      const cell = byDay.get(date)
      if (!cell) continue // don ngoai khung ngay (bien mui gio) — bo qua

      const src = String(o.source ?? "")
      if (isMy) {
        // sen -> RM -> VND
        const vnd = Math.round((Number(o.cod_amount ?? 0) / MY_SEN_PER_RM) * rate)
        if (src === "shopee") cell.my_sp += vnd
        else cell.my_tt += vnd // TikTok Shop la san chu dao cua MY; con lai gom vao day
        cell.orders_my++
        ordersMy++
      } else {
        const vnd = Number(o.cod_amount ?? 0)
        if (src === "tiktok") cell.vn_tt += vnd
        else if (src === "shopee") cell.vn_sp += vnd
        else cell.vn_fb += vnd // phan con lai coi nhu Facebook (theo yeu cau nghiep vu)
        cell.orders_vn++
        ordersVn++
      }
    }

    const days = dayKeys.map(date => {
      const c = byDay.get(date)!
      const vn = c.vn_fb + c.vn_tt + c.vn_sp
      const my = c.my_tt + c.my_sp
      return { date, ...c, vn, my, total: vn + my }
    })

    const sum = (k: keyof (typeof days)[number]) =>
      days.reduce((a, d) => a + Number(d[k] ?? 0), 0)
    const totals = {
      vn_fb: sum("vn_fb"), vn_tt: sum("vn_tt"), vn_sp: sum("vn_sp"),
      my_tt: sum("my_tt"), my_sp: sum("my_sp"),
      vn: sum("vn"), my: sum("my"), total: sum("total"),
      orders_vn: ordersVn, orders_my: ordersMy, orders: ordersVn + ordersMy,
      junk_count: junkCount,
    }

    // --- Ke hoach (target) trong cung khoang ngay ---
    let targets: any[] = []
    try {
      const cskhService = req.scope.resolve("cskhAnalysisModule") as any
      targets = await cskhService.sql(
        `SELECT date::text AS date, market, platform, amount::bigint AS amount
           FROM mkt_revenue_target
          WHERE date >= $1::date AND date <= $2::date`,
        [dayKeys[0], dayKeys[dayKeys.length - 1]]
      )
    } catch {
      // Bang chua migrate -> coi nhu chua dat ke hoach, van tra doanh so thuc.
      targets = []
    }

    const targetByDate = new Map<string, any>()
    for (const t of targets) {
      const key =
        t.market === "MY"
          ? (t.platform === "shopee" ? "my_sp" : "my_tt")
          : (t.platform === "tiktok" ? "vn_tt" : t.platform === "shopee" ? "vn_sp" : "vn_fb")
      const e = targetByDate.get(t.date) ?? { vn_fb: 0, vn_tt: 0, vn_sp: 0, my_tt: 0, my_sp: 0 }
      e[key] += Number(t.amount)
      targetByDate.set(t.date, e)
    }

    const targetDays = dayKeys.map(date => {
      const e = targetByDate.get(date) ?? { vn_fb: 0, vn_tt: 0, vn_sp: 0, my_tt: 0, my_sp: 0 }
      const vn = e.vn_fb + e.vn_tt + e.vn_sp
      const my = e.my_tt + e.my_sp
      return { date, ...e, vn, my, total: vn + my }
    })
    const tSum = (k: string) => targetDays.reduce((a: number, d: any) => a + Number(d[k] ?? 0), 0)
    const targetTotals = {
      vn_fb: tSum("vn_fb"), vn_tt: tSum("vn_tt"), vn_sp: tSum("vn_sp"),
      my_tt: tSum("my_tt"), my_sp: tSum("my_sp"),
      vn: tSum("vn"), my: tSum("my"), total: tSum("total"),
    }

    return res.json({
      from, to,
      myr_to_vnd_rate: rate,
      currency: "VND",
      days,
      totals,
      target: {
        has_target: targets.length > 0,
        days: targetDays,
        totals: targetTotals,
      },
    })
  } catch (err: any) {
    console.error("[Report Combined API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
