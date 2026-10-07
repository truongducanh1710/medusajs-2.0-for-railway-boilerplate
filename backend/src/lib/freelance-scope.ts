import type { MedusaRequest } from "@medusajs/framework/http"
import { getPool } from "./db"

/**
 * Phạm vi dữ liệu của nhân sự FREELANCE (metadata.role = "freelance").
 *
 * Freelancer được vào hệ thống nhưng chỉ thấy dữ liệu của CHÍNH MÌNH — không thấy
 * số liệu chung của công ty. Hai lớp cùng gác:
 *   1. freelanceGuard (api/_freelance-guard.ts) — allowlist endpoint, fail-closed.
 *      Endpoint không có trong danh sách → 403, kể cả route Medusa gốc.
 *   2. Handler của endpoint được phép đọc scope này để lọc dữ liệu về đúng người.
 *
 * Scope do guard gắn vào req — handler KHÔNG tự xác định ai là freelancer, chỉ cần
 * gọi getOwnScope(req): null = người dùng thường (không lọc), có giá trị = phải lọc.
 */
export type OwnScope = {
  userId: string
  email: string
  /** mkt_code chính + mkt_codes bàn giao, upper-case. Luôn có ít nhất 1 phần tử. */
  mktCodes: string[]
}

export const FREELANCE_ROLE = "freelance"

// Freelancer chưa được gán mkt_code vẫn phải bị lọc — dùng một mã không bao giờ
// khớp thay vì mảng rỗng (nhiều handler hiểu "không có mã" là "không lọc").
const NO_MKT_CODE = "__NO_MKT_CODE__"

export function buildOwnScope(user: { id: string; email?: string | null; metadata?: any }): OwnScope {
  const meta = user.metadata ?? {}
  const raw = [meta.mkt_code, ...(Array.isArray(meta.mkt_codes) ? meta.mkt_codes : [])]
  const codes = [...new Set(raw.filter((c) => typeof c === "string" && c.trim()).map((c: string) => c.trim().toUpperCase()))]
  return {
    userId: user.id,
    email: String(user.email ?? "").trim().toLowerCase(),
    mktCodes: codes.length ? codes : [NO_MKT_CODE],
  }
}

export function getOwnScope(req: MedusaRequest): OwnScope | null {
  return ((req as any).freelanceScope as OwnScope | undefined) ?? null
}

/**
 * Điều kiện SQL "video này thuộc về freelancer": video do họ tạo trong Marketing Hub,
 * hoặc ad_name mang tiền tố mã MKT của họ (quy ước {MKT}_{SP}_{LOẠI}_{VD}).
 * `vdExpr` là biểu thức cột vd_code ở query ngoài; `emailParam`/`codesParam` là
 * placeholder ($n) đã push email và mảng mã.
 */
export function ownVideoSql(vdExpr: string, emailParam: string, codesParam: string): string {
  return `EXISTS (
    SELECT 1 FROM mkt_video own_v
    WHERE own_v.vd_code = ${vdExpr}
      AND (lower(own_v.created_by) = ${emailParam}
           OR upper(split_part(own_v.ad_name, '_', 1)) = ANY(${codesParam}::text[]))
  )`
}

/** Như ownVideoSql, cộng thêm video agent đang quản lý dưới mã MKT của họ. */
export function ownAgentVideoSql(vdExpr: string, emailParam: string, codesParam: string): string {
  return `(${ownVideoSql(vdExpr, emailParam, codesParam)} OR EXISTS (
    SELECT 1 FROM video_budget_state own_s
    WHERE own_s.vd_code = ${vdExpr} AND upper(own_s.mkt_name) = ANY(${codesParam}::text[])
  ))`
}

export async function ownsCampaign(scope: OwnScope, campaignId: string): Promise<boolean> {
  if (!campaignId) return false
  const { rows } = await getPool().query(
    `SELECT mkt_name FROM mkt_ads_cost WHERE campaign_id = $1 ORDER BY date DESC LIMIT 1`,
    [campaignId]
  )
  return !!rows[0] && scope.mktCodes.includes(String(rows[0].mkt_name ?? "").toUpperCase())
}

export async function ownsProductTest(scope: OwnScope, caseId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM product_test_case
     WHERE id = $1 AND deleted_at IS NULL
       AND (lower(marketer_email) = $2 OR lower(assignee_email) = $2)`,
    [caseId, scope.email]
  )
  return rows.length > 0
}

export async function ownsMktVideo(scope: OwnScope, videoId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM mkt_video WHERE id = $1 AND lower(created_by) = $2`,
    [videoId, scope.email]
  )
  return rows.length > 0
}
