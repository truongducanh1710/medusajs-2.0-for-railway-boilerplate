import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPool, getAuthInfo, ensureTables, nextVdCode, STATUS_KEY_TO_VI, STATUS_VI_TO_KEY } from "./_lib"

/** Tên Ad (tên quảng cáo cho video) — mặc định = VD_CODE.
 * Khi lên camp, ad name thật sẽ là "[VD_CODE] - [post_id]" (xử lý ở boost route). */
function computeAdName(r: any): string {
  return r.vd_code
}

/** Map 1 DB row → shape UI design (field tiếng Việt). */
function toUiRow(r: any) {
  return {
    id: r.id,
    vdCode: r.vd_code,
    ngayDang: r.post_date ? new Date(r.post_date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "",
    postDate: r.post_date,
    createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "",
    adName: r.ad_name || computeAdName(r),
    script: r.script || "",
    nguon: r.source === "ctv" ? "CTV" : "Team",
    nguoiLam: r.maker,
    sp: r.product || "",
    productCode: r.product_code || "",
    loaiVideo: r.video_type || "",
    link: r.link || "",
    trangThai: STATUS_KEY_TO_VI[r.status] || "Cần làm",
    ghiChu: r.note || "",
    createdBy: r.created_by,
    fbPostLinks: Array.isArray(r.fb_post_links) ? r.fb_post_links : [],
    deadline: r.deadline ? new Date(r.deadline).toISOString().slice(0, 10) : null,
  }
}

/**
 * GET /admin/marketing-video?maker=&status=&product=&from=&to=&mine=true&q=
 * List nguyên liệu video, filter linh hoạt.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const q = req.query as Record<string, string>
    const params: any[] = []
    let where = "WHERE 1=1"

    if (q.maker && q.maker !== "all") { params.push(q.maker); where += ` AND maker = $${params.length}` }
    if (q.status && q.status !== "all") {
      const key = STATUS_VI_TO_KEY[q.status] || q.status
      params.push(key); where += ` AND status = $${params.length}`
    }
    if (q.product && q.product !== "all") { params.push(`${q.product}%`); where += ` AND product ILIKE $${params.length}` }
    if (q.from) { params.push(q.from); where += ` AND post_date >= $${params.length}` }
    if (q.to)   { params.push(q.to);   where += ` AND post_date <= $${params.length}` }
    if (q.mine === "true" && auth.email) { params.push(auth.email); where += ` AND created_by = $${params.length}` }
    if (q.q) {
      params.push(`%${q.q}%`)
      where += ` AND (product ILIKE $${params.length} OR note ILIKE $${params.length})`
    }

    const pool = getPool()
    await ensureTables(pool)
    const { rows } = await pool.query(
      `SELECT * FROM mkt_video ${where} ORDER BY post_date DESC NULLS LAST, created_at DESC`,
      params
    )
    // Backfill ad_name chỉ khi thực sự trống
    const needsFill = rows.filter(r => !r.ad_name)
    if (needsFill.length > 0) {
      await Promise.all(needsFill.map(r => {
        r.ad_name = computeAdName(r)
        return pool.query(`UPDATE mkt_video SET ad_name = $1 WHERE id = $2`, [r.ad_name, r.id])
      }))
    }
    return res.json({ rows: rows.map(toUiRow), total: rows.length })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/marketing-video
 * Tạo dòng nguyên liệu mới, tự sinh vd_code. created_by = email người login.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })

    const b: Record<string, any> = (req.body && typeof req.body === "object") ? (req.body as any) : {}
    const maker: string = b.nguoiLam ?? b.maker ?? "Hậu"
    if (!maker) return res.status(400).json({ error: "Thiếu người làm" })

    const source = (b.nguon === "CTV" || b.source === "ctv") ? "ctv" : "team"
    const statusVi: string = b.trangThai ?? "Cần làm"
    const status = STATUS_VI_TO_KEY[statusVi] || "todo"
    const postDate: string | null = b.postDate ?? b.post_date ?? null

    const pool = getPool()
    await ensureTables(pool)
    const vdCode = await nextVdCode(pool)

    // Lấy mkt_code của người tạo để sinh ad_name
    const userModule = (req as any).scope.resolve(Modules.USER)
    const userDetail = await userModule.retrieveUser((req as any).auth_context.actor_id, { select: ["metadata"] })
    const mktCode: string = (userDetail.metadata as any)?.mkt_code || maker.toUpperCase().replace(/\s+/g, "").slice(0, 8)

    // Sinh sp_code từ tên SP (SP1, SP2...) hoặc dùng maker
    const spRaw: string = b.sp ?? b.product ?? ""
    const spCodeMatch = spRaw.match(/^(SP\d+)/i)
    const spCode = spCodeMatch ? spCodeMatch[1].toUpperCase() : "SP"

    const loaiCode = (b.loaiVideo ?? b.video_type ?? "Video AI")
      .replace(/\s+/g, "").replace(/AI/i, "AI").toUpperCase().slice(0, 8)

    const adName = `${mktCode}_${spCode}_${loaiCode}_${vdCode}`

    const { rows: [row] } = await pool.query(
      `INSERT INTO mkt_video
        (vd_code, post_date, source, maker, product, product_code, video_type, link, status, note, ad_name, script, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        vdCode,
        postDate,
        source,
        maker,
        spRaw,
        b.productCode ?? b.product_code ?? null,
        b.loaiVideo ?? b.video_type ?? "Video AI",
        b.link ?? "",
        status,
        b.ghiChu ?? b.note ?? "",
        adName,
        b.script ?? "",
        auth.email,
      ]
    )
    return res.json({ row: toUiRow(row) })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
