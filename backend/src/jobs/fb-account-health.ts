import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../lib/db"
import { FB_GRAPH_BASE } from "../lib/constants"
import { notifyTelegramByEmail } from "../lib/notify"

// Tài khoản ads chết là mất tiền im lặng: camp vẫn ACTIVE, dashboard vẫn xanh,
// nhưng Facebook không phân phối. Đã gặp thật 22/09/2026 — Ads342 còn 1,8tr hạn mức
// trong khi 3 camp trên đó tổng 3,5tr/ngày, và Ads340 bị khoá vì vi phạm chính sách
// từ lúc nào không ai biết. Không có gì tự báo.
//
// Job này đọc trạng thái tài khoản trực tiếp từ Facebook, ghi lại lịch sử, và chỉ
// báo khi tình trạng XẤU THÊM so với lần trước — để không thành tiếng ồn bị bỏ qua.

const TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_ACCESS_TOKEN || ""

// Ngưỡng "sắp hết hạn mức": còn dưới 3 ngày chi tiêu theo tốc độ thực tế 7 ngày qua.
// Tính theo tốc độ thật thay vì số tiền cố định — tài khoản chi 5tr/ngày và tài khoản
// chi 200k/ngày có cùng số dư nhưng khẩn cấp khác nhau hoàn toàn.
const NGAY_CANH_BAO = 3

// Mỗi tài khoản tối đa 1 tin/4 tiếng. Vấn đề hạn mức không tự khỏi, nhắc liên tục
// chỉ làm người nhận chai.
const COOLDOWN_MS = 4 * 3600_000

// Mức vàng chỉ gửi trong giờ làm. Mức đỏ (tài khoản bị khoá / FB chặn phân phối)
// gửi bất kể giờ — mỗi giờ chậm là tiền vẫn chảy mà không ra kết quả.
const GIO_VN_TU = 7
const GIO_VN_DEN = 22

type Muc = "do" | "vang"

type VanDe = {
  account_id: string
  ten: string
  muc: Muc
  ma: string          // mã vấn đề, dùng để so sánh giữa 2 lần kiểm tra
  mo_ta: string
  chi_tiet: string
}

// account_status của Meta: 1 = ACTIVE, còn lại đều là không chạy được
const TEN_STATUS: Record<number, string> = {
  2: "đã bị vô hiệu hoá",
  3: "chưa thanh toán (unsettled)",
  7: "đang bị xét duyệt rủi ro",
  8: "đang chờ quyết toán",
  9: "trong thời gian gia hạn",
  100: "đang chờ đóng",
  101: "đã đóng",
}

const TEN_DISABLE: Record<number, string> = {
  1: "vi phạm chính sách quảng cáo",
  2: "đang xem xét vi phạm sở hữu trí tuệ",
  3: "rủi ro thanh toán",
  4: "tài khoản bị đóng",
  5: "đang xem xét tài chính",
  6: "rủi ro tính toàn vẹn doanh nghiệp",
  7: "đóng vĩnh viễn",
  8: "tài khoản reseller không dùng",
  9: "tài khoản không hoạt động",
}

let bangDaTao = false

async function ensureBang(): Promise<void> {
  if (bangDaTao) return
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_account_health (
      id BIGSERIAL PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_name TEXT,
      account_status INT,
      disable_reason INT,
      balance BIGINT,
      amount_spent BIGINT,
      spend_cap BIGINT,
      is_prepay BOOLEAN,
      con_lai BIGINT,              -- hạn mức còn lại (NULL = không giới hạn)
      chi_moi_ngay BIGINT,         -- tốc độ chi 7 ngày qua
      so_ngay_con_lai NUMERIC(6,1),
      muc TEXT,                    -- do | vang | ok
      ma_van_de TEXT,
      mo_ta TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS fb_account_health_acc_idx
     ON fb_account_health (account_id, checked_at DESC)`
  )
  // Nhật ký gửi cảnh báo — dùng để áp cooldown, và để biết đã báo ai lúc nào
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_account_alert_log (
      id BIGSERIAL PRIMARY KEY,
      account_id TEXT NOT NULL,
      ma_van_de TEXT NOT NULL,
      muc TEXT NOT NULL,
      recipients TEXT[],
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS fb_account_alert_log_acc_idx
     ON fb_account_alert_log (account_id, sent_at DESC)`
  )
  bangDaTao = true
}

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + "đ"
}

/** Ai đang thực sự chạy trên tài khoản này — ưu tiên dữ liệu chi tiêu thật. */
async function nguoiDangChay(accountId: string): Promise<{ mkts: string[]; camps: number; budget: number }> {
  const { rows } = await getPool().query(
    `SELECT DISTINCT mkt_name,
            count(DISTINCT campaign_id) FILTER (WHERE effective_status = 'ACTIVE') AS camps,
            coalesce(sum(DISTINCT daily_budget) FILTER (WHERE effective_status = 'ACTIVE'), 0) AS budget
     FROM mkt_ads_cost
     WHERE ad_account_id = $1
       AND date >= current_date - 7
       AND mkt_name IS NOT NULL AND mkt_name <> ''
     GROUP BY mkt_name`,
    [accountId]
  )
  return {
    mkts: rows.map((r) => r.mkt_name),
    camps: rows.reduce((s, r) => s + Number(r.camps || 0), 0),
    budget: rows.reduce((s, r) => s + Number(r.budget || 0), 0),
  }
}

/** Email của các MKT theo mã — để gửi Telegram. Luôn kèm super admin. */
async function emailTheoMkt(userModule: any, maMkt: string[]): Promise<string[]> {
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const out = new Set<string>()
  if (superEmail) out.add(superEmail)
  if (!maMkt.length) return [...out]
  try {
    const users = await userModule.listUsers({}, { select: ["email", "metadata"] })
    for (const u of users) {
      const code = (u.metadata as any)?.mkt_code
      const codes = (u.metadata as any)?.mkt_codes
      const list: string[] = Array.isArray(codes) && codes.length ? codes : code ? [code] : []
      if (list.some((c) => maMkt.includes(c)) && u.email) out.add(u.email)
    }
  } catch {
    // Không tra được user thì vẫn báo cho super admin
  }
  return [...out]
}

async function docTaiKhoan(): Promise<any[]> {
  const fields = [
    "id", "account_id", "name", "account_status", "disable_reason",
    "balance", "amount_spent", "spend_cap", "is_prepay_account",
    "failed_delivery_checks",
  ].join(",")
  const url = `${FB_GRAPH_BASE}/me/adaccounts?fields=${fields}&limit=100&access_token=${TOKEN}`
  const res = await fetch(url)
  const json = (await res.json()) as any
  if (json?.error) throw new Error(json.error.message || "Facebook trả lỗi")
  return json?.data ?? []
}

/** Tốc độ chi 7 ngày qua của 1 tài khoản (đồng/ngày). */
async function tocDoChi(accountId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT coalesce(sum(spend), 0) / 7.0 AS chi_ngay
     FROM mkt_ads_cost
     WHERE ad_account_id = $1 AND date >= current_date - 7`,
    [accountId]
  )
  return Math.round(Number(rows[0]?.chi_ngay || 0))
}

function danhGia(acc: any, chiMoiNgay: number): {
  van_de: VanDe | null
  conLai: number | null
  soNgay: number | null
} {
  const id = acc.id || `act_${acc.account_id}`
  const ten = String(acc.name || id).slice(0, 60)
  const status = Number(acc.account_status)
  const disable = Number(acc.disable_reason || 0)
  const spendCap = Number(acc.spend_cap || 0)
  const spent = Number(acc.amount_spent || 0)
  const balance = Number(acc.balance || 0)
  const prepay = !!acc.is_prepay_account
  const fdc = acc.failed_delivery_checks

  // spend_cap = 0 nghĩa là KHÔNG giới hạn, không phải hết hạn mức
  const conLai = spendCap > 0 ? Math.max(0, spendCap - spent) : null
  const soNgay = conLai !== null && chiMoiNgay > 0
    ? Math.round((conLai / chiMoiNgay) * 10) / 10
    : null

  // --- Mức đỏ: tài khoản không chạy được ---
  if (status !== 1) {
    return {
      van_de: {
        account_id: id, ten, muc: "do", ma: `status_${status}`,
        mo_ta: `Tài khoản ${TEN_STATUS[status] || `trạng thái ${status}`}`,
        chi_tiet: disable ? `Lý do: ${TEN_DISABLE[disable] || disable}` : "",
      }, conLai, soNgay,
    }
  }
  if (disable !== 0) {
    return {
      van_de: {
        account_id: id, ten, muc: "do", ma: `disable_${disable}`,
        mo_ta: `Tài khoản bị khoá: ${TEN_DISABLE[disable] || disable}`,
        chi_tiet: "",
      }, conLai, soNgay,
    }
  }
  if (Array.isArray(fdc) && fdc.length > 0) {
    const ds = fdc.map((f: any) => f?.summary || f?.description || f?.check_name)
      .filter(Boolean).slice(0, 3).join("; ")
    return {
      van_de: {
        account_id: id, ten, muc: "do", ma: "failed_delivery",
        mo_ta: "Facebook đang chặn phân phối",
        chi_tiet: ds || "Xem chi tiết trong Ads Manager",
      }, conLai, soNgay,
    }
  }

  // --- Mức vàng: còn chạy nhưng sắp dừng ---
  if (soNgay !== null && soNgay < NGAY_CANH_BAO) {
    return {
      van_de: {
        account_id: id, ten, muc: "vang", ma: "sap_het_han_muc",
        mo_ta: `Sắp hết hạn mức: còn ${vnd(conLai!)}`,
        chi_tiet: `Đang chi ~${vnd(chiMoiNgay)}/ngày → hết trong ~${soNgay} ngày`,
      }, conLai, soNgay,
    }
  }
  // Trả trước mà hết tiền nạp: balance là số dư khả dụng, không phải nợ
  if (prepay && balance <= 0 && chiMoiNgay > 0) {
    return {
      van_de: {
        account_id: id, ten, muc: "vang", ma: "prepay_het_tien",
        mo_ta: "Tài khoản trả trước đã hết tiền nạp",
        chi_tiet: `Đang chi ~${vnd(chiMoiNgay)}/ngày — cần nạp thêm`,
      }, conLai, soNgay,
    }
  }

  return { van_de: null, conLai, soNgay }
}

/** Lần kiểm tra trước có cùng vấn đề này không — để chỉ báo khi xấu thêm. */
async function vanDeLanTruoc(accountId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT ma_van_de FROM fb_account_health
     WHERE account_id = $1 ORDER BY checked_at DESC LIMIT 1 OFFSET 0`,
    [accountId]
  )
  return rows[0]?.ma_van_de ?? null
}

async function dangCooldown(accountId: string, ma: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT sent_at FROM fb_account_alert_log
     WHERE account_id = $1 AND ma_van_de = $2
     ORDER BY sent_at DESC LIMIT 1`,
    [accountId, ma]
  )
  if (!rows.length) return false
  return Date.now() - new Date(rows[0].sent_at).getTime() < COOLDOWN_MS
}

export default async function fbAccountHealth(container: MedusaContainer) {
  const logger = container.resolve("logger") as any

  if (!TOKEN) {
    logger?.warn?.("[FbAccountHealth] Thiếu FB token — bỏ qua")
    return
  }

  try {
    await ensureBang()
    const accounts = await docTaiKhoan()
    if (!accounts.length) {
      logger?.warn?.("[FbAccountHealth] Facebook không trả tài khoản nào")
      return
    }

    const userModule = container.resolve(Modules.USER) as any
    const pool = getPool()
    const gioVN = new Date(Date.now() + 7 * 3600_000).getUTCHours()
    const trongGioLam = gioVN >= GIO_VN_TU && gioVN < GIO_VN_DEN

    let soVanDe = 0
    let soGui = 0

    for (const acc of accounts) {
      const id = acc.id || `act_${acc.account_id}`
      const chiMoiNgay = await tocDoChi(id)
      const { van_de, conLai, soNgay } = danhGia(acc, chiMoiNgay)

      const maTruoc = await vanDeLanTruoc(id)

      // Ghi lịch sử mọi lần kiểm tra — kể cả OK, để có đường cơ sở so sánh
      await pool.query(
        `INSERT INTO fb_account_health
           (account_id, account_name, account_status, disable_reason, balance,
            amount_spent, spend_cap, is_prepay, con_lai, chi_moi_ngay,
            so_ngay_con_lai, muc, ma_van_de, mo_ta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id, String(acc.name || "").slice(0, 200), Number(acc.account_status),
          Number(acc.disable_reason || 0), Number(acc.balance || 0),
          Number(acc.amount_spent || 0), Number(acc.spend_cap || 0),
          !!acc.is_prepay_account, conLai, chiMoiNgay, soNgay,
          van_de?.muc ?? "ok", van_de?.ma ?? null, van_de?.mo_ta ?? null,
        ]
      )

      if (!van_de) continue
      soVanDe++

      // Chỉ gửi khi: vấn đề MỚI xuất hiện, hoặc đổi sang vấn đề khác.
      // Cùng một vấn đề kéo dài thì cooldown lo phần nhắc lại.
      const laMoi = maTruoc !== van_de.ma
      if (!laMoi && (await dangCooldown(id, van_de.ma))) continue
      if (van_de.muc === "vang" && !trongGioLam) continue

      const { mkts, camps, budget } = await nguoiDangChay(id)
      const emails = await emailTheoMkt(userModule, mkts)

      const dong = [
        van_de.muc === "do" ? "🔴 <b>TÀI KHOẢN ADS BỊ CHẶN</b>" : "⚠️ <b>TÀI KHOẢN ADS SẮP DỪNG</b>",
        "",
        `<b>${van_de.ten}</b>`,
        van_de.mo_ta,
      ]
      if (van_de.chi_tiet) dong.push(van_de.chi_tiet)
      if (camps > 0) {
        dong.push("", `Camp đang chạy: ${camps}` + (budget > 0 ? ` (tổng ${vnd(budget)}/ngày)` : ""))
      }
      if (mkts.length) dong.push(`Người chạy: ${mkts.join(", ")}`)
      dong.push("", van_de.muc === "do"
        ? "→ Camp trên tài khoản này không phân phối được. Kiểm tra Ads Manager."
        : "→ Cần nạp thêm / nâng hạn mức, hoặc chuyển camp sang tài khoản khác.")

      await notifyTelegramByEmail(userModule, emails, dong.join("\n"), "fb-account-health")
      await pool.query(
        `INSERT INTO fb_account_alert_log (account_id, ma_van_de, muc, recipients)
         VALUES ($1, $2, $3, $4)`,
        [id, van_de.ma, van_de.muc, emails]
      )
      soGui++
      logger?.error?.(
        `[FbAccountHealth] ${van_de.muc.toUpperCase()} ${van_de.ten}: ${van_de.mo_ta}` +
        ` → gửi ${emails.length} người (${mkts.join(",") || "không rõ MKT"})`
      )
    }

    // Dọn lịch sử cũ: giữ 90 ngày là đủ để xem xu hướng
    await pool.query(
      `DELETE FROM fb_account_health WHERE checked_at < now() - interval '90 days'`
    ).catch(() => {})

    logger?.info?.(
      `[FbAccountHealth] Đã kiểm tra ${accounts.length} tài khoản — ${soVanDe} có vấn đề, gửi ${soGui} cảnh báo`
    )
  } catch (err: any) {
    logger?.error?.(`[FbAccountHealth] Lỗi: ${err.message}`)
  }
}

export const config = {
  name: "fb-account-health",
  schedule: "*/30 * * * *",
}
