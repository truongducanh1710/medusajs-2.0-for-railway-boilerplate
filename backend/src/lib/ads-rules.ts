/**
 * Luật ads (chảo vàng / Tự scale / lên camp) lưu trong DB — nguồn sự thật để mọi AI đọc cùng một luật.
 * Chỉ tài khoản AI (admin@yourmail.com) được sửa luật, bộ điều kiện Tự scale và gắn/gỡ camp (user chốt 19/10/2026);
 * mọi lần sửa ghi ads_rule_history (cũ → mới, ai, vì sao). Trang /app/tu-scale chỉ hiển thị.
 */
import { getPool } from "./db"

export const ADS_RULE_EDITORS = ["admin@yourmail.com"]
export const canEditAdsRules = (email?: string | null) => !!email && ADS_RULE_EDITORS.includes(email.toLowerCase())
export const EDIT_DENIED = "Chỉ AI (admin@yourmail.com) được sửa luật / bộ điều kiện / camp của Tự scale — trang này chỉ để xem"

let ready: Promise<void> | null = null
export function ensureAdsRuleTables() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS ads_rule (
        key TEXT PRIMARY KEY,
        nhom TEXT NOT NULL,
        tieu_de TEXT NOT NULL,
        noi_dung TEXT NOT NULL,
        nguon TEXT,
        bang_chung TEXT,
        sort INT NOT NULL DEFAULT 0,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ads_rule_history (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        ref TEXT,
        old_value JSONB,
        new_value JSONB,
        reason TEXT,
        changed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ads_rule_history_created_idx ON ads_rule_history (created_at DESC);
    `).then(() => undefined).catch((e) => { ready = null; throw e })
  }
  return ready
}

/** kind: ads_rule | auto_scale_rule | auto_scale_camp | auto_scale_mkt */
export async function logRuleChange(kind: string, ref: string | number | null, oldValue: any, newValue: any, by: string | null, reason?: string | null) {
  await ensureAdsRuleTables()
  await getPool().query(
    `INSERT INTO ads_rule_history (kind, ref, old_value, new_value, reason, changed_by) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
    [kind, ref === null ? null : String(ref), oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), reason || null, by]
  ).catch((e) => console.error("[ads-rules] log history failed:", e.message))
}
