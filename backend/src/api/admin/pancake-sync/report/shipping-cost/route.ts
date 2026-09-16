import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

/**
 * GET /admin/pancake-sync/report/shipping-cost?from=&to=&market=&moc=gui|tao
 *
 * Theo dõi & phân tích giá vận chuyển.
 *
 * NGUỒN SỐ: đọc thẳng `raw->>'partner_fee'`, KHÔNG dùng cột `shipping_fee`.
 * Pancake trả về shipping_fee = 0 ở gần như mọi đơn còn phí thật hãng vận chuyển
 * thu thì nằm ở partner_fee. Cột shipping_fee đã được sửa map từ 16/09/2026 nhưng
 * toàn bộ đơn CŨ vẫn rỗng, nên báo cáo đọc raw để chạy được trên cả dữ liệu lịch sử.
 *
 * Đơn sàn (Shopee/TikTok) không có partner_fee vì sàn tự giao — mọi phép tính đều
 * lọc theo phi > 0 để số trung bình không bị pha loãng bởi nhóm này.
 */

const NGUON_TU_CHAY = `source IN ('manual','facebook','zalo','unknown','medusa')`
const PHI = `COALESCE((raw->>'partner_fee')::numeric, 0)`

/**
 * Hai mốc thời gian, trả lời hai câu hỏi khác nhau:
 *
 *   tao  — pancake_created_at: ngày KHÁCH ĐẶT. Dùng khi hỏi "đơn hôm nay tốn bao nhiêu cước".
 *   gui  — raw.time_send_partner: ngày HÀNG RỜI KHO. Đây là mốc Viettel Post dùng
 *          ("Tính theo ngày gửi" trên trang thống kê của họ), nên muốn đối chiếu số
 *          với VTP thì BẮT BUỘC dùng mốc này.
 *
 * Lệch nhau đáng kể: đơn tạo 06/09 thường gửi 07–08/09. Kỳ 03–16/09/2026 tính theo
 * ngày tạo ra 706 đơn / 26,2tr, theo ngày gửi ra 929 đơn / 34,2tr — VTP báo 973 đơn /
 * 34,8tr, tức mốc "gửi" khớp trong khoảng 2%.
 *
 * time_send_partner là chuỗi ISO KHÔNG kèm timezone và đã là giờ VN, nên ::timestamp
 * (không phải timestamptz) rồi so trực tiếp với ngày người dùng chọn — không cộng trừ 7h.
 */
const NGAY_GUI = `(raw->>'time_send_partner')::timestamp`

type Moc = "tao" | "gui"

/** Mệnh đề lọc theo kỳ. $1 = from, $2 = to (ISO UTC từ UI). */
function loc(moc: Moc): string {
  if (moc === "gui") {
    // So theo giờ VN: cắt phần ngày của from/to sau khi đã đổi sang giờ VN.
    return `raw->>'time_send_partner' IS NOT NULL
        AND ${NGAY_GUI} >= ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND ${NGAY_GUI} <= ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')`
  }
  return `pancake_created_at BETWEEN $1 AND $2`
}

/** Cột dùng để gom theo tháng, khớp với mốc đang chọn. */
function cotThang(moc: Moc): string {
  return moc === "gui"
    ? `to_char(${NGAY_GUI}, 'YYYY-MM')`
    : `to_char(pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM')`
}

/** Lọc 12 tháng gần nhất cho biểu đồ xu hướng (không phụ thuộc kỳ đang chọn). */
function loc12Thang(moc: Moc): string {
  return moc === "gui"
    ? `raw->>'time_send_partner' IS NOT NULL
        AND ${NGAY_GUI} > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '12 months'`
    : `pancake_created_at > now() - interval '12 months'`
}

/** Lọc N ngày gần nhất, dùng cho bảng so tháng này vs tháng trước. */
function locNgay(moc: Moc, n: number): string {
  return moc === "gui"
    ? `raw->>'time_send_partner' IS NOT NULL
        AND ${NGAY_GUI} > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '${n} days'`
    : `pancake_created_at > now() - interval '${n} days'`
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to, market, moc: mocRaw } = req.query as Record<string, string>
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    // Mặc định "gui" để số liệu đối chiếu thẳng được với bảng kê Viettel Post.
    const moc: Moc = mocRaw === "tao" ? "tao" : "gui"
    const mkt = market || "VN"
    const pool = getPool()
    const p = [from, to, mkt]

    // ---- Tổng quan kỳ đang chọn ----
    const { rows: sum } = await pool.query(`
      SELECT
        COUNT(*)                                   AS tong_don,
        COUNT(*) FILTER (WHERE ${PHI} > 0)         AS don_co_phi,
        ROUND(SUM(${PHI}))                         AS tong_phi,
        ROUND(AVG(${PHI}) FILTER (WHERE ${PHI} > 0)) AS tb_phi,
        ROUND(SUM(total))                          AS tong_doanh_thu,
        ROUND(SUM(${PHI}) FILTER (WHERE status IN (4,5))) AS phi_don_hoan,
        COUNT(*) FILTER (WHERE status IN (4,5) AND ${PHI} > 0) AS don_hoan_co_phi
      FROM pancake_order
      WHERE ${loc(moc)}
        AND ${NGUON_TU_CHAY} AND market = $3
    `, p)

    // ---- So sánh tháng: 12 tháng gần nhất, không phụ thuộc khoảng lọc ----
    // Cố ý bỏ qua from/to: mục đích là nhìn xu hướng dài hạn để phát hiện hãng vận
    // chuyển âm thầm tăng giá, thứ không thấy được nếu chỉ nhìn trong 1 tháng.
    const { rows: theoThang } = await pool.query(`
      SELECT
        ${cotThang(moc)} AS thang,
        COUNT(*) FILTER (WHERE ${PHI} > 0)          AS don,
        ROUND(AVG(${PHI}) FILTER (WHERE ${PHI} > 0)) AS tb_phi,
        ROUND(SUM(${PHI}))                          AS tong_phi,
        ROUND(SUM(${PHI}) * 100.0 / NULLIF(SUM(total), 0), 2) AS pct_doanh_thu
      FROM pancake_order
      WHERE ${loc12Thang(moc)}
        AND ${NGUON_TU_CHAY} AND market = $1
      GROUP BY 1 ORDER BY 1
    `, [mkt])

    // ---- Theo sản phẩm ----
    // CHỈ lấy đơn 1 sản phẩm. Đơn nhiều SP không thể chia phí cho từng SP một cách
    // trung thực (phí tính theo tổng khối lượng kiện, không tách được), nên thà bỏ
    // còn hơn bịa ra con số phân bổ. ~68% đơn có phí là đơn 1 SP nên mẫu vẫn đủ lớn.
    const { rows: theoSp } = await pool.query(`
      SELECT
        it->>'name'                                AS sp,
        COUNT(*)                                   AS don,
        ROUND(AVG(${PHI}))                         AS tb_phi,
        MIN(${PHI})                                AS phi_thap,
        MAX(${PHI})                                AS phi_cao,
        ROUND(SUM(${PHI}))                         AS tong_phi,
        ROUND(AVG((it->>'price')::numeric))        AS gia_ban,
        ROUND(AVG(${PHI}) * 100.0 / NULLIF(AVG((it->>'price')::numeric), 0), 1) AS pct_gia,
        ROUND(STDDEV_POP(${PHI}))                  AS do_lech
      FROM pancake_order, jsonb_array_elements(items) it
      WHERE ${loc(moc)}
        AND ${NGUON_TU_CHAY} AND market = $3
        AND ${PHI} > 0
        AND jsonb_array_length(items) = 1
      GROUP BY 1
      HAVING COUNT(*) >= 5
      ORDER BY tong_phi DESC
      LIMIT 40
    `, p)

    // ---- Tháng này vs tháng trước, theo sản phẩm ----
    // Đây là bảng "cần theo dõi": SP nào phí ship vừa nhảy lên so với tháng trước.
    const { rows: bienDongSp } = await pool.query(`
      WITH thang AS (
        SELECT
          it->>'name' AS sp,
          ${cotThang(moc)} AS m,
          AVG(${PHI}) AS tb,
          COUNT(*)    AS don
        FROM pancake_order, jsonb_array_elements(items) it
        WHERE ${locNgay(moc, 75)}
          AND ${NGUON_TU_CHAY} AND market = $1
          AND ${PHI} > 0 AND jsonb_array_length(items) = 1
        GROUP BY 1, 2
      ), xep AS (
        SELECT sp, m, tb, don,
               ROW_NUMBER() OVER (PARTITION BY sp ORDER BY m DESC) AS rn
        FROM thang
      )
      SELECT
        a.sp,
        a.m AS thang_nay,  ROUND(a.tb) AS tb_nay,  a.don AS don_nay,
        b.m AS thang_truoc, ROUND(b.tb) AS tb_truoc, b.don AS don_truoc,
        ROUND((a.tb - b.tb))                            AS chenh,
        ROUND((a.tb - b.tb) * 100.0 / NULLIF(b.tb, 0), 1) AS pct_thay_doi
      FROM xep a JOIN xep b ON a.sp = b.sp AND a.rn = 1 AND b.rn = 2
      WHERE a.don >= 5 AND b.don >= 5
      ORDER BY pct_thay_doi DESC
    `, [mkt])

    // ---- Theo tỉnh/thành ----
    const { rows: theoTinh } = await pool.query(`
      SELECT
        COALESCE(NULLIF(province, ''), 'Không rõ') AS tinh,
        COUNT(*)                                   AS don,
        ROUND(AVG(${PHI}))                         AS tb_phi,
        ROUND(SUM(${PHI}))                         AS tong_phi
      FROM pancake_order
      WHERE ${loc(moc)}
        AND ${NGUON_TU_CHAY} AND market = $3 AND ${PHI} > 0
      GROUP BY 1 HAVING COUNT(*) >= 5
      ORDER BY tb_phi DESC LIMIT 20
    `, p)

    // ---- Theo hãng vận chuyển ----
    const { rows: theoHang } = await pool.query(`
      SELECT
        COALESCE(NULLIF(raw->'partner'->>'partner_name', ''), 'Không rõ') AS hang,
        COUNT(*)                   AS don,
        ROUND(AVG(${PHI}))         AS tb_phi,
        ROUND(SUM(${PHI}))         AS tong_phi
      FROM pancake_order
      WHERE ${loc(moc)}
        AND ${NGUON_TU_CHAY} AND market = $3 AND ${PHI} > 0
      GROUP BY 1 ORDER BY tong_phi DESC
    `, p)

    const s = sum[0] ?? {}
    const tongPhi = Number(s.tong_phi ?? 0)
    const doanhThu = Number(s.tong_doanh_thu ?? 0)

    return res.json({
      market: mkt,
      moc,
      summary: {
        tong_don: Number(s.tong_don ?? 0),
        don_co_phi: Number(s.don_co_phi ?? 0),
        tong_phi: tongPhi,
        tb_phi: Number(s.tb_phi ?? 0),
        tong_doanh_thu: doanhThu,
        pct_doanh_thu: doanhThu > 0 ? Math.round(tongPhi / doanhThu * 1000) / 10 : 0,
        phi_don_hoan: Number(s.phi_don_hoan ?? 0),
        don_hoan_co_phi: Number(s.don_hoan_co_phi ?? 0),
      },
      theo_thang: theoThang,
      theo_sp: theoSp,
      bien_dong_sp: bienDongSp,
      theo_tinh: theoTinh,
      theo_hang: theoHang,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
