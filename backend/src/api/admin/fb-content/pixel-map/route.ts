import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, getFbAdAccounts, getFbPixels, getAdsetsPixelMap } from "../_lib"

// Parse MKT + SP từ tên camp theo convention:
// MÃSP_DD/MM_MKTCODE_TÊN SP_ADSXXX_AUDIENCE_VDXXX
const CAMP_REGEX = /^([A-Z0-9]+)_(\d{1,2}\/\d{1,2})_([A-Z]+)_(.+?)_(ADS\d+)_(.+?)_(VD[\w\d\-\.]+)(_.+)?$/i
function parseCamp(name: string): { mkt: string; sp: string } {
  const m = CAMP_REGEX.exec((name || "").trim())
  if (m) return { mkt: m[3].toUpperCase(), sp: m[4].trim() }
  // fallback: tìm MKT code bất kỳ trong tên
  const mkt = (name.match(/KIENLB|XUANLT|NAMDV|LINHMT|ANHNT|DUPD/i) || [""])[0].toUpperCase()
  return { mkt, sp: "" }
}

// Cache 10 phút để tránh quét FB liên tục
let _cache: { at: number; data: any } | null = null
const CACHE_MS = 10 * 60 * 1000

/**
 * GET /admin/fb-content/pixel-map?only_active=1&force=1
 * Quét adsets các ad account → map campaign ↔ pixel + JOIN spend.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const q = req.query as Record<string, string>
    const onlyActive = q.only_active === "1"

    if (!q.force && _cache && Date.now() - _cache.at < CACHE_MS) {
      return res.json({ ..._cache.data, cached: true })
    }

    // 1. Ad accounts (admin = tất cả; MKT = account được gán)
    const allAccounts = await getFbAdAccounts()
    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await svc.sql(`ALTER TABLE fb_ad_account ADD COLUMN IF NOT EXISTS allowed_mkt_codes TEXT[] DEFAULT '{}'`)
    const dbAccs: any[] = await svc.sql(`SELECT account_id, mkt_name, allowed_mkt_codes FROM fb_ad_account WHERE deleted_at IS NULL`)
    const dbMap: Record<string, any> = {}
    for (const a of dbAccs) dbMap[a.account_id] = a
    const myCode = (auth.mktCode || "").toUpperCase()

    const accounts = allAccounts.filter(a => {
      if (auth.isAdmin) return true
      const info = dbMap[a.id]; if (!info) return false
      return (info.mkt_name || "").toUpperCase() === myCode ||
             (info.allowed_mkt_codes || []).map((c: string) => c.toUpperCase()).includes(myCode)
    })

    // 2. Quét adsets + pixel + lấy tên pixel cho mỗi account (song song)
    const perAcc = await Promise.all(accounts.map(async acc => {
      const [adsets, pixels] = await Promise.all([
        getAdsetsPixelMap(acc.id).catch(() => []),
        getFbPixels(acc.id).catch(() => []),
      ])
      const pixelName: Record<string, string> = {}
      for (const p of pixels) pixelName[p.id] = p.name
      return { acc, adsets, pixelName }
    }))

    // 3. Spend/orders theo campaign_id (30 ngày gần nhất) từ mkt_ads_cost
    const today = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const spendRows: any[] = await svc.sql(
      `SELECT campaign_id, SUM(spend)::bigint AS spend
         FROM mkt_ads_cost
        WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date
        GROUP BY campaign_id`,
      [from, today]
    )
    const spendMap: Record<string, number> = {}
    for (const r of spendRows) spendMap[r.campaign_id] = Number(r.spend) || 0

    // 4. Gom adset theo campaign (1 camp = 1 dòng, lấy pixel của adset đầu)
    const campRows: Record<string, any> = {}
    for (const { acc, adsets, pixelName } of perAcc) {
      for (const ad of adsets) {
        if (onlyActive && ad.status !== "ACTIVE") continue
        if (!ad.campaign_id) continue
        const key = ad.campaign_id
        if (!campRows[key]) {
          const { mkt, sp } = parseCamp(ad.campaign_name)
          campRows[key] = {
            campaign_id: ad.campaign_id,
            campaign_name: ad.campaign_name,
            account_id: acc.id,
            account_name: acc.name,
            mkt, sp,
            status: ad.status,
            pixel_id: ad.pixel_id,
            pixel_name: ad.pixel_id ? (pixelName[ad.pixel_id] || ad.pixel_id) : "(không pixel)",
            event_type: ad.event_type,
            spend: spendMap[ad.campaign_id] || 0,
          }
        }
      }
    }
    const rows = Object.values(campRows)

    // 5. Group theo pixel + warnings (SP dùng nhiều pixel)
    const byPixel: Record<string, { pixel_id: string; pixel_name: string; camps: number; spend: number; mkts: Set<string>; sps: Set<string>; is_common: boolean }> = {}
    const COMMON_PIXEL = "941188901527786" // PX CHUNG VIETNAM — đích gộp về
    for (const r of rows as any[]) {
      const pid = r.pixel_id || "none"
      if (!byPixel[pid]) byPixel[pid] = { pixel_id: pid, pixel_name: r.pixel_name, camps: 0, spend: 0, mkts: new Set(), sps: new Set(), is_common: pid === COMMON_PIXEL }
      byPixel[pid].camps++
      byPixel[pid].spend += r.spend
      if (r.mkt) byPixel[pid].mkts.add(r.mkt)
      if (r.sp) byPixel[pid].sps.add(r.sp)
    }
    const byPixelArr = Object.values(byPixel).map(p => ({
      pixel_id: p.pixel_id, pixel_name: p.pixel_name, camps: p.camps, spend: p.spend,
      is_common: p.is_common, mkts: [...p.mkts], sp_count: p.sps.size,
    })).sort((a, b) => b.camps - a.camps)
    // Cảnh báo: cùng SP (chuẩn hoá) dùng >1 pixel
    const spPixels: Record<string, Set<string>> = {}
    for (const r of rows as any[]) {
      if (!r.sp || !r.pixel_id) continue
      const k = r.sp.toUpperCase()
      ;(spPixels[k] = spPixels[k] || new Set()).add(r.pixel_id)
    }
    const warnings = Object.entries(spPixels)
      .filter(([, set]) => set.size > 1)
      .map(([sp, set]) => ({ sp, pixel_count: set.size }))

    const data = {
      rows,
      byPixel: byPixelArr,
      warnings,
      total_camps: rows.length,
      total_pixels: byPixelArr.length,
      common_camps: byPixel[COMMON_PIXEL]?.camps || 0,
      scanned_accounts: accounts.length,
    }
    _cache = { at: Date.now(), data }
    return res.json(data)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
