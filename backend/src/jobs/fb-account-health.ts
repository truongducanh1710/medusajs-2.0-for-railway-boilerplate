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

  // Ngưỡng thanh toán + ngày tới hạn + hạn thẻ: Marketing API KHÔNG trả các trường
  // này (billing_threshold / next_bill_date / threshold_amount đều "nonexisting field"
  // ở v25, /transactions và /invoices cũng không có; token đã đủ ads_read +
  // business_management nên không phải vấn đề quyền — Meta bỏ dữ liệu tài chính
  // khỏi API). Vì vậy nhập tay từ Ads Manager > Lập hóa đơn và thanh toán.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fb_account_billing (
      account_id TEXT PRIMARY KEY,
      ten_ngan TEXT,
      nguong_thanh_toan BIGINT,      -- "Số dư của bạn đạt X" → Facebook trừ tiền
      ngay_thanh_toan DATE,          -- "Và vào ngày này" (NULL nếu chỉ theo ngưỡng)
      theo_nguong BOOLEAN DEFAULT true,
      gioi_han_ngay BIGINT,          -- Giới hạn chi tiêu hàng ngày do Meta đặt
      the_mac_dinh TEXT,
      the_het_han DATE,              -- quy về ngày cuối tháng hết hạn
      la_quy BOOLEAN DEFAULT false,  -- tài khoản trả trước (nạp quỹ)
      tu_dong_nap BOOLEAN DEFAULT false,
      ghi_chu TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Seed lần đầu từ ảnh Ads Manager 22/09/2026. ON CONFLICT DO NOTHING để lần chạy
  // sau không ghi đè khi anh sửa lại trong DB.
  await pool.query(`
    INSERT INTO fb_account_billing
      (account_id, ten_ngan, nguong_thanh_toan, ngay_thanh_toan, theo_nguong,
       gioi_han_ngay, the_mac_dinh, the_het_han, la_quy, tu_dong_nap, ghi_chu)
    VALUES
      ('act_1133464788237858','Ads327',   7948357,'2026-09-30',true, 10278859,'Visa 4359','2031-04-30',false,false,null),
      ('act_467272752744880', 'Ads328',    213420,'2026-09-23',true,  7879358,'Visa 3793','2029-03-31',false,false,null),
      -- Ads329: Facebook ghi "khoảng 1 lần/ngày" thay vì một ngày cố định,
      -- nên chỉ cảnh báo theo ngưỡng số dư (theo_nguong=true, ngay_thanh_toan=NULL).
      ('act_899712815703406', 'Ads329',   9970092, NULL,       true, 63191491,'Visa 3793','2029-03-31',false,false,'Tru khoang 1 lan/ngay'),
      ('act_1169258974603627','Ads341',      NULL, NULL,       false, 3218515,'Visa 4065', NULL,       true, false,'Quy het tien - ads dang dung'),
      ('act_741222868885235', 'Ads342',      NULL, NULL,       false, 6533727,'Visa 5281','2031-02-28',true, true, 'Tu dong nap 2tr khi duoi 1tr'),
      ('act_1397084955139677','Ads344',  13451583,'2026-09-30',true, 37329535,'Visa 3793','2029-03-31',false,false,null),
      ('act_2801056226892845','Ads346',  23697306,'2026-09-28',true, 29722003,'Visa 4359','2031-04-30',false,false,null),
      ('act_27214643188160995','Ads348',  1102692,'2026-10-16',true,  7579385,'MasterCard 2746','2030-05-31',false,false,null),
      ('act_1108526648426194','Ads349',     52500,'2026-09-30',true,  7198433,'Visa 3793','2029-03-31',false,false,null)
    ON CONFLICT (account_id) DO NOTHING
  `)

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

// Người luôn nhận mọi cảnh báo tài khoản, bất kể tài khoản đó ai chạy — người
// giữ thẻ / lo thanh toán cần biết hết để kịp mở thẻ. Tách khỏi mkt_code vì họ
// không chạy camp nào nên không tra ra được theo cách thông thường.
// Đổi danh sách qua env FB_ALERT_ALWAYS (các email cách nhau bởi dấu phẩy).
const NHAN_LUON = (process.env.FB_ALERT_ALWAYS || "hoanpd@phanviet.vn")
  .split(",").map((s) => s.trim()).filter(Boolean)

/** Email của các MKT theo mã — để gửi Telegram. Luôn kèm super admin + NHAN_LUON. */
async function emailTheoMkt(userModule: any, maMkt: string[]): Promise<string[]> {
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  const out = new Set<string>()
  if (superEmail) out.add(superEmail)
  for (const e of NHAN_LUON) out.add(e)
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

type Billing = {
  ten_ngan: string | null
  nguong_thanh_toan: number | null
  ngay_thanh_toan: string | null
  theo_nguong: boolean
  gioi_han_ngay: number | null
  the_mac_dinh: string | null
  the_het_han: string | null
  la_quy: boolean
  tu_dong_nap: boolean
}

async function docBilling(accountId: string): Promise<Billing | null> {
  const { rows } = await getPool().query(
    `SELECT ten_ngan, nguong_thanh_toan, ngay_thanh_toan, theo_nguong, gioi_han_ngay,
            the_mac_dinh, the_het_han, la_quy, tu_dong_nap
     FROM fb_account_billing WHERE account_id = $1`,
    [accountId]
  )
  if (!rows.length) return null
  const r = rows[0]
  return {
    ten_ngan: r.ten_ngan,
    nguong_thanh_toan: r.nguong_thanh_toan === null ? null : Number(r.nguong_thanh_toan),
    ngay_thanh_toan: r.ngay_thanh_toan ? new Date(r.ngay_thanh_toan).toISOString().slice(0, 10) : null,
    theo_nguong: !!r.theo_nguong,
    gioi_han_ngay: r.gioi_han_ngay === null ? null : Number(r.gioi_han_ngay),
    the_mac_dinh: r.the_mac_dinh,
    the_het_han: r.the_het_han ? new Date(r.the_het_han).toISOString().slice(0, 10) : null,
    la_quy: !!r.la_quy,
    tu_dong_nap: !!r.tu_dong_nap,
  }
}

// Cảnh báo khi số dư đạt 80% ngưỡng — anh cần thời gian mở thẻ trước khi Facebook trừ.
const TY_LE_CANH_BAO = 0.8
// Hoặc trước ngày thanh toán 2 ngày, cái nào đến trước.
const NGAY_TRUOC_HAN = 2
// Thẻ sắp hết hạn: báo trước 30 ngày.
const NGAY_TRUOC_HET_THE = 30

/**
 * Sắp bị trừ tiền chưa. Tách riêng khỏi danhGia() vì đây là cảnh báo "cần mở thẻ",
 * khác bản chất với "tài khoản đang chết".
 */
function danhGiaThanhToan(
  acc: any, b: Billing | null, chiMoiNgay: number
): VanDe | null {
  if (!b) return null
  const id = acc.id || `act_${acc.account_id}`
  const ten = b.ten_ngan || String(acc.name || id).slice(0, 40)
  const balance = Number(acc.balance || 0)
  const the = b.the_mac_dinh ? ` (thẻ ${b.the_mac_dinh})` : ""

  // --- Tài khoản quỹ (prepay): không tự đánh giá được ---
  // Với tài khoản quỹ, `balance` của API KHÔNG phải số tiền còn lại. Kiểm chứng
  // 22/09/2026: Ads342 có 2.000.000đ trong quỹ và Ads341 có 0đ — API trả balance=0
  // cho CẢ HAI. Marketing API không có trường nào đọc được số dư quỹ, nên mọi suy
  // đoán từ balance đều sai.
  //
  // Bù lại, khi quỹ cạn thì Facebook tự chặn phân phối và bơm failed_delivery_checks
  // — danhGia() đã bắt ở mức đỏ (Ads341 hôm nay: "Đã đạt giới hạn chi tiêu").
  // Nên ở đây không làm gì: thà báo chậm một nhịp còn hơn báo sai mỗi 30 phút.
  if (b.la_quy) return null

  // --- Trả sau: sắp đạt ngưỡng trừ tiền ---
  if (b.theo_nguong && b.nguong_thanh_toan && b.nguong_thanh_toan > 0) {
    const tyLe = balance / b.nguong_thanh_toan
    if (tyLe >= TY_LE_CANH_BAO) {
      const conThieu = b.nguong_thanh_toan - balance
      const soNgay = chiMoiNgay > 0 ? Math.round((conThieu / chiMoiNgay) * 10) / 10 : null
      return {
        account_id: id, ten, muc: "vang", ma: "sap_tru_tien",
        mo_ta: `Sắp bị trừ tiền: ${vnd(balance)} / ${vnd(b.nguong_thanh_toan)} (${Math.round(tyLe * 100)}%)`,
        chi_tiet: soNgay !== null
          ? `Đang chi ~${vnd(chiMoiNgay)}/ngày → dự kiến trừ trong ~${soNgay} ngày${the}`
          : `Cần mở thẻ${the}`,
      }
    }
  }

  // --- Trả sau: sắp tới ngày thanh toán định kỳ ---
  if (b.ngay_thanh_toan) {
    const conNgay = Math.ceil(
      (new Date(b.ngay_thanh_toan + "T00:00:00+07:00").getTime() - Date.now()) / 86400_000
    )
    if (conNgay >= 0 && conNgay <= NGAY_TRUOC_HAN) {
      return {
        account_id: id, ten, muc: "vang", ma: "sap_den_han",
        mo_ta: conNgay === 0
          ? `Hôm nay là ngày thanh toán — ${vnd(balance)}`
          : `Còn ${conNgay} ngày tới hạn thanh toán — ${vnd(balance)}`,
        chi_tiet: `Ngày ${b.ngay_thanh_toan}${the}`,
      }
    }
  }

  // --- Thẻ sắp hết hạn: mất thẻ là mất cả tài khoản ---
  if (b.the_het_han) {
    const conNgay = Math.ceil(
      (new Date(b.the_het_han + "T00:00:00+07:00").getTime() - Date.now()) / 86400_000
    )
    if (conNgay >= 0 && conNgay <= NGAY_TRUOC_HET_THE) {
      return {
        account_id: id, ten, muc: "vang", ma: "the_sap_het_han",
        mo_ta: `Thẻ ${b.the_mac_dinh} sắp hết hạn (còn ${conNgay} ngày)`,
        chi_tiet: `Hết hạn ${b.the_het_han} — cần đổi thẻ trước khi bị chặn`,
      }
    }
  }

  return null
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
  // status 3 (UNSETTLED) KHÔNG phải lỗi: với tài khoản trả sau, nó chỉ có nghĩa
  // "đang có số dư chưa thanh toán" — trạng thái bình thường giữa hai kỳ trừ tiền.
  // Kiểm chứng 23/09: Ads329/344/346 đều status=3 mà vẫn chạy (Ads329 chi 2,1tr
  // hôm đó, failed_delivery_checks rỗng). Báo đỏ ở đây là báo động giả, và tệ hơn
  // là làm loãng các cảnh báo thật. Phần sắp-bị-trừ-tiền đã do danhGiaThanhToan lo.
  if (status !== 1 && status !== 3) {
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

// Cảnh báo thanh toán nhắc thưa hơn: nó không "hỏng thêm" theo giờ, nhưng cần
// nhắc lại mỗi ngày cho tới khi mở thẻ — 4h thì thành 6 tin/ngày, quá nhiều.
const COOLDOWN_THANH_TOAN_MS = 20 * 3600_000

async function dangCooldown(accountId: string, ma: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT sent_at FROM fb_account_alert_log
     WHERE account_id = $1 AND ma_van_de = $2
     ORDER BY sent_at DESC LIMIT 1`,
    [accountId, ma]
  )
  if (!rows.length) return false
  const nguong = ["sap_tru_tien", "sap_den_han", "the_sap_het_han"].includes(ma)
    ? COOLDOWN_THANH_TOAN_MS
    : COOLDOWN_MS
  return Date.now() - new Date(rows[0].sent_at).getTime() < nguong
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
      const b = await docBilling(id)
      const kq = danhGia(acc, chiMoiNgay)
      const { conLai, soNgay } = kq

      // Tài khoản chết (đỏ) ưu tiên hơn cảnh báo thanh toán: nếu Facebook đã chặn
      // thì mở thẻ cũng chưa chạy lại được, phải xử lý cái chặn trước.
      const van_de = kq.van_de?.muc === "do"
        ? kq.van_de
        : (danhGiaThanhToan(acc, b, chiMoiNgay) ?? kq.van_de)

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

      const laThanhToan = ["sap_tru_tien", "sap_den_han", "the_sap_het_han"].includes(van_de.ma)
      const tieuDe = van_de.muc === "do"
        ? "🔴 <b>TÀI KHOẢN ADS BỊ CHẶN</b>"
        : laThanhToan ? "💳 <b>SẮP PHẢI THANH TOÁN</b>" : "⚠️ <b>TÀI KHOẢN ADS SẮP DỪNG</b>"

      const dong = ["", `<b>${van_de.ten}</b>`, van_de.mo_ta]
      dong.unshift(tieuDe)
      if (van_de.chi_tiet) dong.push(van_de.chi_tiet)
      if (camps > 0) {
        dong.push("", `Camp đang chạy: ${camps}` + (budget > 0 ? ` (tổng ${vnd(budget)}/ngày)` : ""))
      }
      if (mkts.length) dong.push(`Người chạy: ${mkts.join(", ")}`)
      // Giới hạn ngày do Meta đặt — không đọc được qua API, chỉ có trong bảng cấu hình.
      // Hữu ích để biết tài khoản này còn gánh thêm được bao nhiêu.
      if (b?.gioi_han_ngay && chiMoiNgay > 0) {
        dong.push(`Giới hạn ngày (Meta): ${vnd(b.gioi_han_ngay)} — đang dùng ${Math.round(chiMoiNgay / b.gioi_han_ngay * 100)}%`)
      }
      dong.push("", van_de.muc === "do"
        ? "→ Camp trên tài khoản này không phân phối được. Kiểm tra Ads Manager / nạp tiền."
        : laThanhToan
          ? "→ Mở thẻ trước khi Facebook trừ tiền, tránh bị khoá tài khoản."
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
