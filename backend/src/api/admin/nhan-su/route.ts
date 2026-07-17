import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCurrentUserEmail, userHasPerm } from "../cham-cong/_lib"

// GET /admin/nhan-su?q=&team= — list + search
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const svc = req.scope.resolve("mktTaskModule") as any
    const { q, team } = req.query as any

    const filter: any = { deleted_at: null }
    if (team) filter.team = team

    let employees = await svc.listEmployeeProfiles(filter, { order: { ma_nv: "ASC" } })

    if (q) {
      const needle = String(q).trim().toLowerCase()
      employees = employees.filter((e: any) =>
        e.ma_nv.toLowerCase().includes(needle) ||
        e.ho_ten.toLowerCase().includes(needle) ||
        (e.sdt || "").includes(needle)
      )
    }

    res.json({ employees })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

// POST /admin/nhan-su — tạo hồ sơ mới, chỉ ai có page.nhan-su.manage
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const email = await getCurrentUserEmail(req)
    if (!email) return res.status(401).json({ error: "Unauthenticated" })
    if (!(await userHasPerm(req, email, "page.nhan-su.manage"))) {
      return res.status(403).json({ error: "Ban khong co quyen them nhan su" })
    }

    const body = req.body as any
    if (!body?.ma_nv || !body?.ho_ten) {
      return res.status(400).json({ error: "ma_nv va ho_ten la bat buoc" })
    }

    const svc = req.scope.resolve("mktTaskModule") as any
    const employee = await svc.createEmployeeProfiles(sanitizeInput(body))
    res.json({ employee })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

const DATE_FIELDS = ["ngay_bat_dau", "ngay_chinh_thuc", "ngay_sinh", "ngay_cap", "ngay_het_han_hdld"]
const TEXT_FIELDS = [
  "ma_nv", "ho_ten", "gioi_tinh", "team", "chuc_vu", "email_cong_ty", "email_ca_nhan",
  "sdt", "cccd", "noi_cap", "noi_o_hien_tai", "dia_chi_thuong_tru", "trinh_do", "hon_nhan",
  "hdtv", "hdld", "ghi_chu", "trang_thai",
]

export function sanitizeInput(body: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f] ? String(body[f]).slice(0, 500) : null
  }
  for (const f of DATE_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f] ? new Date(body[f]) : null
  }
  if (body.ho_so_du !== undefined) out.ho_so_du = !!body.ho_so_du
  return out
}
