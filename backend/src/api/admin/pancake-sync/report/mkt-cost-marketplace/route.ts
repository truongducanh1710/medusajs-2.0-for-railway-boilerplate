import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { resolveUserPerms } from "../../../../middlewares"

/**
 * Chi phí quảng cáo sàn TMĐT (TikTok Shop / Shopee) — điền tay theo ngày.
 *
 * Sàn không có API spend như Facebook, cũng không có sheet sync như Google Ads:
 * nhân sự đang ghi tay ra Google Sheet ngoài hệ thống nên báo cáo LNG sàn không trừ
 * được chi phí ads. Route này để nhập thẳng trong app.
 *
 * Grain (date, platform, market, shop) — tách tới từng shop vì MY có nhiều shop chạy
 * song song (Skincare, Gardening-Tool, DIY, Car...).
 *
 * ĐƠN VỊ TIỀN: cột cost LUÔN là VNĐ. Đơn MY trong pancake_order lưu bằng RM
 * (~797 RM/đơn), nhưng chi phí ở đây do người nhập quy đổi sẵn về VNĐ trước khi điền —
 * nếu không, tổng chi phí sẽ cộng lẫn 2 đơn vị tiền.
 */

type AuthInfo = { email: string; isAdmin: boolean }

/** Admin = super admin hoặc có users.manage — giống mkt-cost-gg-manual để nhất quán. */
async function getAuth(req: MedusaRequest): Promise<AuthInfo | null> {
  const auth = (req as any).auth_context
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null
  const userModule = req.scope.resolve(Modules.USER)
  const user = await userModule.retrieveUser(auth.actor_id, { select: ["id", "email", "metadata"] })
  const isSuper = !!(user.email && user.email === process.env.SUPER_ADMIN_EMAIL)
  const perms = resolveUserPerms(user.metadata)
  return { email: user.email || "", isAdmin: isSuper || perms.includes("users.manage") }
}

const PLATFORMS = ["tiktok", "shopee"] as const
const MARKETS = ["VN", "MY"] as const
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

async function ensureTable(svc: any) {
  await svc.sql(`
    CREATE TABLE IF NOT EXISTS mkt_ads_cost_marketplace (
      id         uuid NOT NULL DEFAULT gen_random_uuid(),
      date       date NOT NULL,
      platform   varchar(16) NOT NULL,
      market     varchar(8)  NOT NULL DEFAULT 'VN',
      shop       varchar(64) NOT NULL DEFAULT '',
      cost       bigint NOT NULL DEFAULT 0,
      note       text,
      created_by varchar(255),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz NULL,
      PRIMARY KEY (id)
    )
  `)
  // Nâng cấp tại chỗ nếu bảng đã tồn tại từ bản trước (chỉ có date+platform).
  await svc.sql(`ALTER TABLE mkt_ads_cost_marketplace ADD COLUMN IF NOT EXISTS market varchar(8) NOT NULL DEFAULT 'VN'`)
  await svc.sql(`ALTER TABLE mkt_ads_cost_marketplace ADD COLUMN IF NOT EXISTS shop varchar(64) NOT NULL DEFAULT ''`)
  await svc.sql(`ALTER TABLE mkt_ads_cost_marketplace DROP CONSTRAINT IF EXISTS mkt_ads_cost_marketplace_date_platform_unique`)
  // Chiều SẢN PHẨM (thêm 8/2026). Chia đều ads cho mọi đơn trong ngày là sai: đơn 28.000đ
  // và đơn 55.000đ gánh ads bằng nhau nên đơn nhỏ luôn hiện lỗ giả. Điền theo SP thì phân
  // bổ đúng vào SP đó.
  // '' = dòng điền ở MỨC SHOP (cách cũ) — vẫn hợp lệ, chia đều cho các đơn không thuộc SP
  // nào đã điền riêng. Nhờ vậy dữ liệu cũ chạy nguyên, không phải nhập lại.
  await svc.sql(`ALTER TABLE mkt_ads_cost_marketplace ADD COLUMN IF NOT EXISTS product_code varchar(64) NOT NULL DEFAULT ''`)
  // Unique cũ (không có product_code) phải bỏ, nếu không mỗi (ngày,sàn,shop) chỉ điền
  // được 1 SP duy nhất.
  await svc.sql(`ALTER TABLE mkt_ads_cost_marketplace DROP CONSTRAINT IF EXISTS mkt_ads_cost_marketplace_uniq`)
  await svc.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mkt_ads_cost_mp_uniq2') THEN
        ALTER TABLE mkt_ads_cost_marketplace
          ADD CONSTRAINT mkt_ads_cost_mp_uniq2 UNIQUE (date, platform, market, shop, product_code);
      END IF;
    END $$;
  `)
  await svc.sql(`CREATE INDEX IF NOT EXISTS idx_mkt_ads_cost_mp_date ON mkt_ads_cost_marketplace (date, platform, market)`)
}

/**
 * GET /admin/pancake-sync/report/mkt-cost-marketplace?from=&to=&market=&platform=
 *
 * Trả:
 *  - rows      : các dòng đã điền (lọc theo market/platform nếu truyền)
 *  - totals    : tổng theo (sàn × thị trường)
 *  - by_day    : tổng theo ngày — để quản lý soi ngày nào thiếu số
 *  - shops     : danh sách shop có đơn 90 ngày gần nhất, cho dropdown
 *  - missing   : ngày × kênh CÓ đơn nhưng CHƯA điền chi phí (theo dõi bỏ sót)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const {
      from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      market,
      platform,
    } = req.query as Record<string, string>

    const me = await getAuth(req)
    if (!me) return res.status(401).json({ error: "Unauthenticated" })

    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await ensureTable(svc)

    const filters: string[] = []
    const params: any[] = [from, to]
    if (market && MARKETS.includes(market as any)) {
      params.push(market); filters.push(`market = $${params.length}`)
    }
    if (platform && PLATFORMS.includes(platform as any)) {
      params.push(platform); filters.push(`platform = $${params.length}`)
    }
    // Nhân sự chỉ thấy chi phí do CHÍNH MÌNH điền; admin/manager thấy toàn bộ.
    // Lọc ở SQL chứ không ở client — ẩn trên giao diện không phải là kiểm soát truy cập.
    if (!me.isAdmin) {
      params.push(me.email); filters.push(`created_by = $${params.length}`)
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : ""

    const rows = await svc.sql(`
      SELECT date::text AS date, platform, market, shop, product_code, cost::bigint AS cost,
             note, created_by, updated_at
        FROM mkt_ads_cost_marketplace
       WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date ${where}
       ORDER BY date DESC, market, platform, shop, product_code
    `, params)

    const totals = await svc.sql(`
      SELECT platform, market, SUM(cost)::bigint AS cost,
             COUNT(DISTINCT date)::int AS days, COUNT(*)::int AS entries
        FROM mkt_ads_cost_marketplace
       WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date ${where}
       GROUP BY platform, market
       ORDER BY market, platform
    `, params)

    const byDay = await svc.sql(`
      SELECT date::text AS date, SUM(cost)::bigint AS cost, COUNT(*)::int AS entries
        FROM mkt_ads_cost_marketplace
       WHERE deleted_at IS NULL AND date >= $1::date AND date <= $2::date ${where}
       GROUP BY date ORDER BY date DESC
    `, params)

    // Shop đang hoạt động — lấy từ đơn thật để dropdown không phải gõ tay, tránh sai chính tả
    // làm vỡ grain (mỗi cách viết khác nhau thành 1 dòng chi phí riêng).
    const shops = await svc.sql(`
      SELECT source AS platform, market,
             COALESCE(NULLIF(TRIM(shop_name), ''), '') AS shop,
             COUNT(*)::int AS orders
        FROM pancake_order
       WHERE deleted_at IS NULL AND source IN ('shopee','tiktok')
         AND pancake_created_at >= (now() - interval '90 days')
       GROUP BY 1, 2, 3
       HAVING COUNT(*) >= 5
       ORDER BY market, source, COUNT(*) DESC
    `)

    // SP thực sự bán trên từng (sàn × thị trường × shop) trong 90 ngày — cho dropdown khi
    // điền chi phí theo SP. Lấy từ ĐƠN THẬT chứ không liệt kê cả danh mục: nhân sự chỉ cần
    // thấy vài SP shop mình đang chạy, không phải cuộn qua 51 mã.
    // Gộp theo mã đã chuẩn hoá; SP chưa có mã (display_id trống) bỏ qua vì không phân bổ
    // được — phần đó cứ để dòng chi phí mức shop gánh.
    const products = await svc.sql(`
      SELECT platform, market, shop, product_code,
             MAX(product_name) AS product_name,
             SUM(orders)::int  AS orders,
             -- Các mã biến thể đã gộp vào dòng này (chỉ để hiện tooltip khi cần đối chiếu).
             array_agg(DISTINCT full_code) AS variant_codes
        FROM (
          SELECT po.source AS platform, po.market,
                 COALESCE(NULLIF(TRIM(po.shop_name), ''), '') AS shop,
                 upper(trim(mi->'variation_info'->>'display_id')) AS full_code,
                 -- GỘP BIẾN THỂ: POS sinh mã riêng cho từng biến thể/combo của cùng một SP
                 -- (PHVVN043_CCX01/_CCX02/_CCX03 đều là chổi cọ xoong) nên lưới hiện 3 dòng
                 -- trùng tên, nhân sự không biết điền dòng nào. Phần PHVVN### là danh tính
                 -- thật của SP; gom theo đó để mỗi SP đúng 1 dòng, chi phí dùng chung.
                 COALESCE(
                   (regexp_match(upper(trim(mi->'variation_info'->>'display_id')), '^(PHVVN[0-9]{2,3})'))[1],
                   upper(trim(mi->'variation_info'->>'display_id'))
                 ) AS product_code,
                 COALESCE(mi->'variation_info'->>'name', mi->>'name', '') AS product_name,
                 COUNT(DISTINCT po.id)::int AS orders
            FROM pancake_order po
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.raw->'items','[]'::jsonb)) AS mi
           WHERE po.deleted_at IS NULL AND po.source IN ('shopee','tiktok')
             AND po.pancake_created_at >= (now() - interval '90 days')
             AND COALESCE(mi->'variation_info'->>'display_id', '') <> ''
           GROUP BY 1,2,3,4,5,6
        ) v
       GROUP BY platform, market, shop, product_code
      HAVING SUM(orders) >= 3
       ORDER BY market, platform, shop, SUM(orders) DESC
    `)

    // Kênh CÓ đơn trong kỳ nhưng CHƯA điền chi phí ngày đó — dấu hiệu bỏ sót.
    const missing = await svc.sql(`
      WITH có_đơn AS (
        SELECT pancake_created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS ts,
               source AS platform, market,
               COALESCE(NULLIF(TRIM(shop_name), ''), '') AS shop
          FROM pancake_order
         WHERE deleted_at IS NULL AND source IN ('shopee','tiktok')
           AND pancake_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
           AND pancake_created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ),
      ngày_kênh AS (
        SELECT ts::date AS date, platform, market, shop, COUNT(*)::int AS orders
          FROM có_đơn GROUP BY 1,2,3,4 HAVING COUNT(*) >= 3
      )
      SELECT d.date::text AS date, d.platform, d.market, d.shop, d.orders
        FROM ngày_kênh d
        LEFT JOIN mkt_ads_cost_marketplace c
          ON c.date = d.date AND c.platform = d.platform
         AND c.market = d.market AND c.shop = d.shop AND c.deleted_at IS NULL
         ${me.isAdmin ? "" : "AND c.created_by = $3"}
       WHERE c.id IS NULL
       ORDER BY d.date DESC, d.market, d.platform
       LIMIT 200
    `, me.isAdmin ? [from, to] : [from, to, me.email])

    return res.json({
      rows, totals, by_day: byDay, shops, products, missing,
      is_admin: me.isAdmin, my_email: me.email,
      platforms: PLATFORMS, markets: MARKETS, from, to,
    })
  } catch (err: any) {
    console.error("[mkt-cost-marketplace GET]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PUT /admin/pancake-sync/report/mkt-cost-marketplace
 * body: { date, platform, market, shop?, cost, note? }
 * cost = null để xoá dòng điền nhầm (soft delete, khớp cách query lọc deleted_at).
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const me = await getAuth(req)
    if (!me) return res.status(401).json({ error: "Unauthenticated" })

    const b = req.body as any
    const date = String(b?.date ?? "")
    if (!isDate(date)) return res.status(400).json({ error: "Ngày không hợp lệ (cần YYYY-MM-DD)" })

    const platform = String(b?.platform ?? "").toLowerCase()
    if (!PLATFORMS.includes(platform as any)) {
      return res.status(400).json({ error: `Sàn không hợp lệ — chỉ nhận: ${PLATFORMS.join(", ")}` })
    }

    const market = String(b?.market ?? "VN").toUpperCase()
    if (!MARKETS.includes(market as any)) {
      return res.status(400).json({ error: `Thị trường không hợp lệ — chỉ nhận: ${MARKETS.join(", ")}` })
    }

    const shop = String(b?.shop ?? "").trim().slice(0, 64)
    // Chi phí điền theo TỪNG shop, không gộp cả thị trường — gộp thì LNG từng shop sai.
    if (!shop) return res.status(400).json({ error: "Thiếu shop — chi phí phải điền theo từng shop." })

    // Mã SP (tuỳ chọn). Có mã = chi phí của riêng SP đó; để trống = chi phí chung của shop
    // trong ngày, sẽ chia cho phần đơn chưa được điền riêng.
    const productCode = String(b?.product_code ?? "").trim().toUpperCase().slice(0, 64)

    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await ensureTable(svc)

    if (b?.cost === null || b?.cost === "" || b?.cost === undefined) {
      // Người thường chỉ xoá được dòng CHÍNH MÌNH điền — chặn ở SQL, không dựa vào UI.
      const owner = me.isAdmin ? "" : "AND created_by = $6"
      const del = await svc.sql(
        `UPDATE mkt_ads_cost_marketplace SET deleted_at = now(), updated_at = now()
          WHERE date = $1::date AND platform = $2 AND market = $3 AND shop = $4
            AND product_code = $5
            AND deleted_at IS NULL ${owner}
          RETURNING id`,
        me.isAdmin
          ? [date, platform, market, shop, productCode]
          : [date, platform, market, shop, productCode, me.email]
      )
      if (!del.length) {
        return res.status(403).json({ error: "Không tìm thấy dòng của bạn để xoá (dòng này do người khác điền)." })
      }
      return res.json({ ok: true, deleted: true, date, platform, market, shop, product_code: productCode })
    }

    const cost = Math.round(Number(b.cost))
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: "Chi phí không hợp lệ" })

    // Grain (date, platform, market, shop) là duy nhất toàn hệ thống, nên nếu người khác
    // đã điền kênh-ngày này thì ON CONFLICT sẽ ghi đè số của họ. Chặn trước: người thường
    // chỉ được ghi vào ô trống hoặc ô của chính mình; admin ghi đè được để sửa hộ.
    if (!me.isAdmin) {
      const owner = await svc.sql(
        `SELECT created_by FROM mkt_ads_cost_marketplace
          WHERE date = $1::date AND platform = $2 AND market = $3 AND shop = $4
            AND product_code = $5 AND deleted_at IS NULL`,
        [date, platform, market, shop, productCode]
      )
      if (owner.length && owner[0].created_by && owner[0].created_by !== me.email) {
        return res.status(403).json({
          error: `Kênh-ngày này do ${owner[0].created_by} điền — bạn không sửa được. Nhờ admin nếu cần đổi.`,
        })
      }
    }

    await svc.sql(`
      INSERT INTO mkt_ads_cost_marketplace (date, platform, market, shop, product_code, cost, note, created_by)
      VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (date, platform, market, shop, product_code) DO UPDATE SET
        cost       = EXCLUDED.cost,
        note       = EXCLUDED.note,
        created_by = EXCLUDED.created_by,
        deleted_at = NULL,
        updated_at = now()
    `, [date, platform, market, shop, productCode, cost, b?.note ?? null, me.email])

    return res.json({ ok: true, date, platform, market, shop, cost })
  } catch (err: any) {
    console.error("[mkt-cost-marketplace PUT]", err.message)
    return res.status(500).json({ error: err.message })
  }
}

/**
 * POST /admin/pancake-sync/report/mkt-cost-marketplace
 * body: { platform, market, shop, entries: [{ date, product_code, cost }] }
 *
 * Lưu HÀNG LOẠT cho bảng nhập dạng danh sách (Ngày · SP · Chi phí) — nhân sự điền cả
 * tuần rồi bấm "Lưu tất cả" một lần, thay vì mỗi ô một request như PUT.
 *
 * cost rỗng/null = XOÁ dòng đó, để bỏ số điền nhầm ngay trong lưới.
 *
 * Quyền ghi đè giống PUT: người thường chỉ ghi được ô trống hoặc ô của chính mình;
 * admin ghi đè được. Ô bị chặn KHÔNG làm hỏng cả mẻ — trả về danh sách `skipped` để UI
 * báo đúng dòng nào không lưu được, phần còn lại vẫn lưu.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const me = await getAuth(req)
    if (!me) return res.status(401).json({ error: "Unauthenticated" })

    const b = req.body as any
    const platform = String(b?.platform ?? "").toLowerCase()
    if (!PLATFORMS.includes(platform as any)) {
      return res.status(400).json({ error: `Sàn không hợp lệ — chỉ nhận: ${PLATFORMS.join(", ")}` })
    }
    const market = String(b?.market ?? "VN").toUpperCase()
    if (!MARKETS.includes(market as any)) {
      return res.status(400).json({ error: `Thị trường không hợp lệ — chỉ nhận: ${MARKETS.join(", ")}` })
    }
    const shop = String(b?.shop ?? "").trim().slice(0, 64)
    if (!shop) return res.status(400).json({ error: "Thiếu shop — chi phí phải điền theo từng shop." })

    const entries = Array.isArray(b?.entries) ? b.entries : []
    if (entries.length === 0) return res.status(400).json({ error: "Không có dòng nào để lưu" })
    // Chặn mẻ quá lớn: 1 shop × 31 ngày × ~30 SP vẫn dưới ngưỡng này.
    if (entries.length > 1000) return res.status(400).json({ error: "Quá nhiều dòng trong một lần lưu (tối đa 1000)" })

    const svc = req.scope.resolve("cskhAnalysisModule") as any
    await ensureTable(svc)

    let saved = 0, deleted = 0
    const skipped: { date: string; product_code: string; reason: string }[] = []

    for (const e of entries) {
      const date = String(e?.date ?? "")
      if (!isDate(date)) { skipped.push({ date, product_code: "", reason: "Ngày không hợp lệ" }); continue }
      const productCode = String(e?.product_code ?? "").trim().toUpperCase().slice(0, 64)

      // Người thường không được đè số của người khác — kiểm từng ô, ô nào vướng thì bỏ
      // qua ô đó chứ không huỷ cả mẻ (nhân sự điền 30 dòng, hỏng 1 dòng vẫn lưu 29).
      if (!me.isAdmin) {
        const owner = await svc.sql(
          `SELECT created_by FROM mkt_ads_cost_marketplace
            WHERE date = $1::date AND platform = $2 AND market = $3 AND shop = $4
              AND product_code = $5 AND deleted_at IS NULL`,
          [date, platform, market, shop, productCode]
        )
        if (owner.length && owner[0].created_by && owner[0].created_by !== me.email) {
          skipped.push({ date, product_code: productCode, reason: `do ${owner[0].created_by} điền` })
          continue
        }
      }

      const raw = e?.cost
      const isEmpty = raw === null || raw === undefined || String(raw).trim() === ""
      if (isEmpty) {
        const del = await svc.sql(
          `UPDATE mkt_ads_cost_marketplace SET deleted_at = now(), updated_at = now()
            WHERE date = $1::date AND platform = $2 AND market = $3 AND shop = $4
              AND product_code = $5 AND deleted_at IS NULL
            RETURNING id`,
          [date, platform, market, shop, productCode]
        )
        if (del.length) deleted++
        continue
      }

      const cost = Math.round(Number(String(raw).replace(/[^\d]/g, "")))
      if (!Number.isFinite(cost) || cost < 0) {
        skipped.push({ date, product_code: productCode, reason: "Chi phí không hợp lệ" }); continue
      }

      await svc.sql(`
        INSERT INTO mkt_ads_cost_marketplace (date, platform, market, shop, product_code, cost, note, created_by)
        VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (date, platform, market, shop, product_code) DO UPDATE SET
          cost       = EXCLUDED.cost,
          note       = EXCLUDED.note,
          created_by = EXCLUDED.created_by,
          deleted_at = NULL,
          updated_at = now()
      `, [date, platform, market, shop, productCode, cost, e?.note ?? null, me.email])
      saved++
    }

    return res.json({ ok: true, saved, deleted, skipped })
  } catch (err: any) {
    console.error("[mkt-cost-marketplace POST]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
