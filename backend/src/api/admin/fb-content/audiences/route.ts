import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthInfo, getFbAudiences, getFbPixels, createWebsiteAudience, createLookalike } from "../_lib"

// Bộ audience chuẩn (mirror camp-naming.ts AUDIENCE_PRESETS)
const PRESETS = [
  { key: "PUR", group: "exclude",   event: "Purchase",             retention: 90 },
  { key: "ATC", group: "hot",       event: "AddToCart",            retention: 14 },
  { key: "VC",  group: "hot",       event: "ViewContent",          retention: 30 },
  { key: "REG", group: "hot",       event: "CompleteRegistration", retention: 30 },
  { key: "LAL", group: "lookalike", lookalike: true,               ratio: 1 },
]

/** Phân loại audience theo tên/subtype → hot | exclude | lookalike | other */
function classify(a: any): string {
  if (a.subtype === "LOOKALIKE" || /^LAL_|tương tự/i.test(a.name)) return "lookalike"
  if (/^PUR_|PURCH|MUA|purchase/i.test(a.name)) return "exclude"
  if (/^(ATC|VC|REG)_|ADD|VIEW|XEM|TRUY CẬP|ĐKHT|REGISTR|ENGAGE|TƯƠNG TÁC|VIDEO/i.test(a.name) || a.subtype === "ENGAGEMENT") return "hot"
  return "other"
}

/**
 * GET  /admin/fb-content/audiences?account_id=act_xxx  → list + phân loại
 * POST /admin/fb-content/audiences  → tạo bộ chuẩn cho 1 SP
 *   body: { account_id, sku_sp, pixel_id }
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const accId = (req.query as any).account_id
    if (!accId) return res.status(400).json({ error: "Thiếu account_id" })

    const [auds, pixels] = await Promise.all([
      getFbAudiences(accId).catch(() => []),
      getFbPixels(accId).catch(() => []),
    ])
    const rows = auds.map(a => ({ ...a, audience_group: classify(a) }))
    const summary = { hot: 0, exclude: 0, lookalike: 0, other: 0 } as Record<string, number>
    for (const r of rows) summary[r.audience_group]++
    return res.json({ audiences: rows, pixels, summary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const b = req.body as any
    if (!b.account_id) return res.status(400).json({ error: "Thiếu account_id" })
    if (!b.sku_sp) return res.status(400).json({ error: "Thiếu tên SP" })
    if (!b.pixel_id) return res.status(400).json({ error: "Thiếu pixel_id" })

    const sp = String(b.sku_sp).toUpperCase().trim()
    const created: any[] = []
    const errors: any[] = []

    // 1. Tạo website audiences (PUR/ATC/VC/REG)
    let purchaseAudId: string | null = null
    for (const p of PRESETS.filter(x => !x.lookalike)) {
      const name = `${p.key}_${sp}_${p.retention}d`
      try {
        const id = await createWebsiteAudience(b.account_id, {
          name, pixelId: b.pixel_id, event: p.event!, retentionDays: p.retention!,
        })
        created.push({ key: p.key, name, id, group: p.group })
        if (p.key === "PUR") purchaseAudId = id
      } catch (e: any) {
        errors.push({ key: p.key, name, error: e.message })
      }
    }

    // 2. Lookalike từ tệp Purchase (nếu tạo được)
    if (purchaseAudId) {
      const lalName = `LAL_${sp}_1pct`
      try {
        const id = await createLookalike(b.account_id, {
          name: lalName, sourceAudienceId: purchaseAudId, ratio: 1, country: "VN",
        })
        created.push({ key: "LAL", name: lalName, id, group: "lookalike" })
      } catch (e: any) {
        errors.push({ key: "LAL", name: lalName, error: e.message })
      }
    }

    return res.json({ created, errors, ok: errors.length === 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
