import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Pool } from "pg"
import OpenAI from "openai"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

function fmtVND(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} tỷ`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} triệu`
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}

/**
 * POST /admin/pancake-sync/report/ai-summary
 * Body: { from: string, to: string }
 * Tổng hợp data → gửi DeepSeek → trả markdown
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { from, to } = req.body as { from: string; to: string }
    if (!from || !to) return res.status(400).json({ error: "Thiếu from/to" })

    const pool = getPool()

    // --- Query tất cả data cần thiết song song ---
    const [
      { rows: overview },
      { rows: topSales },
      { rows: topMkts },
      { rows: topProducts },
      { rows: highReturnProducts },
      { rows: lowStock },
    ] = await Promise.all([
      // Tổng quan
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 3) as delivered,
          COUNT(*) FILTER (WHERE status IN (4,5,-2)) as returned,
          COUNT(*) FILTER (WHERE status IN (6,7,-1)) as cancelled,
          COALESCE(SUM(cod_amount) FILTER (WHERE status = 3), 0) as cod_revenue
        FROM pancake_order
        WHERE pancake_created_at BETWEEN $1 AND $2
          AND source IN ('manual','facebook','zalo','unknown','medusa')
      `, [from, to]),

      // Top sale theo tỷ lệ chốt
      pool.query(`
        SELECT
          COALESCE(NULLIF(sale_name,''), 'Chưa phân') as sale_name,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status IN (1,2,3,9)) as confirmed,
          ROUND(COUNT(*) FILTER (WHERE status IN (1,2,3,9)) * 100.0 / NULLIF(COUNT(*),0), 1) as confirm_rate
        FROM pancake_order
        WHERE pancake_created_at BETWEEN $1 AND $2
          AND source IN ('manual','facebook','zalo','unknown','medusa')
        GROUP BY sale_name
        HAVING COUNT(*) >= 3
        ORDER BY confirm_rate DESC
        LIMIT 5
      `, [from, to]),

      // MKT hiệu quả (theo COD thực thu)
      pool.query(`
        SELECT
          COALESCE(NULLIF(marketer_name,''), 'Không có') as marketer_name,
          COUNT(*) FILTER (WHERE status = 3) as delivered,
          COALESCE(SUM(cod_amount) FILTER (WHERE status = 3), 0) as cod_revenue
        FROM pancake_order
        WHERE pancake_created_at BETWEEN $1 AND $2
          AND source IN ('manual','facebook','zalo','unknown','medusa')
          AND NULLIF(marketer_name,'') IS NOT NULL
        GROUP BY marketer_name
        ORDER BY cod_revenue DESC
        LIMIT 5
      `, [from, to]),

      // Top SP bán chạy
      pool.query(`
        SELECT
          item->>'name' as name,
          SUM((item->>'quantity')::int) as qty
        FROM pancake_order,
          jsonb_array_elements(raw->'items') as item
        WHERE status = 3
          AND pancake_created_at BETWEEN $1 AND $2
          AND raw->'items' IS NOT NULL
        GROUP BY name
        ORDER BY qty DESC
        LIMIT 5
      `, [from, to]),

      // SP hoàn nhiều (trong đơn hoàn)
      pool.query(`
        SELECT
          item->>'name' as name,
          SUM((item->>'quantity')::int) as qty
        FROM pancake_order,
          jsonb_array_elements(raw->'items') as item
        WHERE status IN (4,5,-2)
          AND pancake_created_at BETWEEN $1 AND $2
          AND raw->'items' IS NOT NULL
        GROUP BY name
        ORDER BY qty DESC
        LIMIT 5
      `, [from, to]),

      // Tồn kho thấp
      pool.query(`
        SELECT product_title, stock_qty
        FROM product_cost
        WHERE stock_qty IS NOT NULL AND stock_qty < 50
          AND pancake_display_id IS NOT NULL
        ORDER BY stock_qty ASC
        LIMIT 10
      `),
    ])

    const ov = overview[0]
    const total = Number(ov.total)
    const delivered = Number(ov.delivered)
    const returned  = Number(ov.returned)
    const cancelled = Number(ov.cancelled)
    const codRevenue = Number(ov.cod_revenue)
    const successRate = total > 0 ? Math.round(delivered / total * 100) : 0
    const returnRate  = total > 0 ? Math.round(returned / total * 100) : 0

    // Build prompt
    const fromDate = from.slice(0, 10)
    const toDate   = to.slice(0, 10)

    const prompt = `Bạn là trợ lý phân tích kinh doanh cho cửa hàng đồ gia dụng Phan Viet (bán hàng qua Facebook/Zalo/Website).

Dưới đây là số liệu kỳ ${fromDate} đến ${toDate}:

**TỔNG QUAN:**
- Tổng đơn: ${total}
- Giao thành công: ${delivered} (${successRate}%)
- Doanh thu COD thu được: ${fmtVND(codRevenue)}
- Hoàn hàng: ${returned} (${returnRate}%)
- Hủy đơn: ${cancelled}

**MARKETING (top theo COD thu được):**
${topMkts.length ? topMkts.map((m: any, i: number) => `${i+1}. ${m.marketer_name}: ${m.delivered} đơn thành công, ${fmtVND(Number(m.cod_revenue))}`).join('\n') : '- Không có data MKT'}

**SALE (top theo tỷ lệ chốt):**
${topSales.length ? topSales.map((s: any, i: number) => `${i+1}. ${s.sale_name}: ${s.confirm_rate}% chốt (${s.confirmed}/${s.total} đơn)`).join('\n') : '- Không có data sale'}

**SẢN PHẨM BÁN CHẠY:**
${topProducts.length ? topProducts.map((p: any, i: number) => `${i+1}. ${p.name}: ${p.qty} cái`).join('\n') : '- Không có data'}

**SẢN PHẨM HOÀN NHIỀU:**
${highReturnProducts.length ? highReturnProducts.map((p: any, i: number) => `${i+1}. ${p.name}: ${p.qty} cái hoàn`).join('\n') : '- Không có'}

**TỒN KHO THẤP (cần nhập thêm):**
${lowStock.length ? lowStock.map((p: any) => `- ${p.product_title}: còn ${p.stock_qty} cái`).join('\n') : '- Tất cả đủ hàng'}

Hãy viết báo cáo tóm tắt khoảng 200-250 chữ bằng tiếng Việt, giọng điệu chuyên nghiệp dành cho quản lý. Sử dụng đúng format sau (giữ nguyên tiêu đề bold):

**Nhận xét chung**
[2-3 câu nhận xét tổng quan doanh thu và hiệu suất]

**Marketing**
[Nhận xét MKT nào làm tốt, MKT nào cần chú ý]

**Sale & Vận đơn**
[Nhận xét sale hiệu suất cao/thấp, tỷ lệ hoàn hủy]

**Sản phẩm**
[SP bán chạy, SP hoàn nhiều cần xem lại chất lượng/kịch bản]

**Khuyến nghị**
[2-3 hành động cụ thể cần làm ngay]`

    // Gọi DeepSeek
    const client = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    })

    const completion = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.7,
    })

    const summary = completion.choices[0]?.message?.content ?? ""

    return res.json({ summary, generated_at: new Date().toISOString(), period: { from, to } })
  } catch (err: any) {
    console.error("[AI Summary]", err.message)
    return res.status(500).json({ error: err.message })
  }
}
