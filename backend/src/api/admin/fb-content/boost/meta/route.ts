import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, getFbAdAccounts, getFbAudiences, getFbPixels, getFbCampaignsWithAdsets, getPageTokens, getPool, ensureTables } from "../../_lib"

/**
 * GET /admin/fb-content/boost/meta
 *   → { accounts: [...] }   danh sách ad accounts MKT được phép dùng
 * GET /admin/fb-content/boost/meta?account_id=act_xxx
 *   → { audiences, pixels, campaigns } cho 1 account (load khi chọn account)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const q = req.query as Record<string, string>

    // Mode 2: lấy audiences/pixels/campaigns của 1 account
    if (q.account_id) {
      const [audiences, pixels, campaigns] = await Promise.all([
        getFbAudiences(q.account_id).catch(() => []),
        getFbPixels(q.account_id).catch(() => []),
        getFbCampaignsWithAdsets(q.account_id).catch(() => []),
      ])
      return res.json({ audiences, pixels, campaigns })
    }

    // Mode 1: danh sách ad accounts, lọc theo allowed_mkt_codes nếu không phải admin
    const fbAccounts = await getFbAdAccounts()

    // Lấy mapping allowed_mkt_codes từ DB
    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await svc.sql(`ALTER TABLE fb_ad_account ADD COLUMN IF NOT EXISTS allowed_mkt_codes TEXT[] DEFAULT '{}'`)
    const dbAccounts: any[] = await svc.sql(
      `SELECT account_id, mkt_name, allowed_mkt_codes FROM fb_ad_account WHERE deleted_at IS NULL`
    )
    const dbMap: Record<string, { mkt_name: string; allowed: string[] }> = {}
    for (const a of dbAccounts) {
      dbMap[a.account_id] = { mkt_name: a.mkt_name || "", allowed: a.allowed_mkt_codes || [] }
    }

    const myCode = (auth.mktCode || "").toUpperCase()
    const accounts = fbAccounts
      .filter(a => {
        if (auth.isAdmin) return true
        const info = dbMap[a.id]
        if (!info) return false
        // Cho phép nếu mkt_name khớp HOẶC mã có trong allowed_mkt_codes
        return info.mkt_name.toUpperCase() === myCode || info.allowed.map(c => c.toUpperCase()).includes(myCode)
      })
      .map(a => ({
        id: a.id,
        name: a.name,
        account_status: a.account_status,
        mkt_name: dbMap[a.id]?.mkt_name || "",
      }))

    // Trả thêm danh sách pages (cho mode Dark post). Dùng getPageTokens() thay vì query
    // thẳng bảng — nó tự refresh page nào token đã stale (>24h), tránh dropdown hiện page
    // mà bước tạo camp sau đó báo "Không tìm thấy page token" (bug thật đã verify 15/8/2026:
    // dropdown liệt kê mọi page trong DB không lọc TTL, còn bước tạo camp lọc TTL — page cũ
    // lỡ không refresh thì hiện ở đây nhưng tạo camp thì fail).
    const pool = getPool()
    await ensureTables(pool)
    const pages = await getPageTokens(pool)
      .then(rows => rows.map(r => ({ page_id: r.page_id, page_name: r.page_name })).sort((a, b) => a.page_name.localeCompare(b.page_name)))
      .catch(() => [])

    return res.json({ accounts, pages })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
