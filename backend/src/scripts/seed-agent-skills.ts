/**
 * Seed 20-25 skills ban đầu cho agent_insight, dựa trên data thực tế Phan Viet shop.
 * Chạy 1 lần: pnpm tsx src/scripts/seed-agent-skills.ts
 *
 * Skills có source='seed' để phân biệt với skills agent tự tạo.
 * Mọi skill bắt đầu với confidence_pct=60 (medium). Agent sẽ tự điều chỉnh.
 */
type Skill = {
  insight: string
  category: "diagnosis" | "opportunity" | "pattern" | "warning"
  condition_when: string
  action_then: string
  scope: Record<string, any>
  confidence_pct: number
}

const SKILLS: Skill[] = [
  // ─── Nhóm 1: CPM benchmarks per MKT (p75 30d làm ngưỡng) ───
  { insight: "ANHNT CPM bất thường khi > 440k (p75 30d)", category: "diagnosis",
    condition_when: "mkt_name='ANHNT' AND cpm > 440000",
    action_then: "Diagnose 'thị trường cạnh tranh / tệp bão hòa' — recommend pause hoặc set_budget giảm 30%",
    scope: { mkt: "ANHNT", metric: "cpm", threshold: 440000 }, confidence_pct: 60 },

  { insight: "KIENLB CPM bất thường khi > 567k (p75 30d)", category: "diagnosis",
    condition_when: "mkt_name='KIENLB' AND cpm > 567000",
    action_then: "Diagnose 'thị trường cạnh tranh' — recommend pause hoặc set_budget giảm 30%",
    scope: { mkt: "KIENLB", metric: "cpm", threshold: 567000 }, confidence_pct: 60 },

  { insight: "LINHMT CPM bất thường khi > 585k (p75 30d)", category: "diagnosis",
    condition_when: "mkt_name='LINHMT' AND cpm > 585000",
    action_then: "Diagnose 'thị trường cạnh tranh' — recommend pause hoặc set_budget giảm 30%",
    scope: { mkt: "LINHMT", metric: "cpm", threshold: 585000 }, confidence_pct: 60 },

  { insight: "NAMDV CPM bất thường khi > 443k (p75 30d)", category: "diagnosis",
    condition_when: "mkt_name='NAMDV' AND cpm > 443000",
    action_then: "Diagnose 'thị trường cạnh tranh' — recommend pause hoặc set_budget giảm 30%",
    scope: { mkt: "NAMDV", metric: "cpm", threshold: 443000 }, confidence_pct: 60 },

  { insight: "XUANLT CPM bất thường khi > 371k (p75 30d)", category: "diagnosis",
    condition_when: "mkt_name='XUANLT' AND cpm > 371000",
    action_then: "Diagnose 'thị trường cạnh tranh' — recommend pause hoặc set_budget giảm 30%",
    scope: { mkt: "XUANLT", metric: "cpm", threshold: 371000 }, confidence_pct: 60 },

  { insight: "DUPD CPM bất thường khi > 536k (p75 30d)", category: "diagnosis",
    condition_when: "mkt_name='DUPD' AND cpm > 536000",
    action_then: "Diagnose 'thị trường cạnh tranh' — recommend pause hoặc set_budget giảm 30%",
    scope: { mkt: "DUPD", metric: "cpm", threshold: 536000 }, confidence_pct: 60 },

  // ─── Nhóm 2: CTR benchmarks (CTR < p25 = content yếu) ───
  { insight: "ANHNT CTR < 3.49% (p25) → content/creative yếu", category: "diagnosis",
    condition_when: "mkt_name='ANHNT' AND ctr_pct < 3.49 AND impressions > 1000",
    action_then: "Diagnose 'content vấn đề' — recommend pause để marketer đổi creative, KHÔNG giảm budget",
    scope: { mkt: "ANHNT", metric: "ctr", threshold: 3.49 }, confidence_pct: 60 },

  { insight: "KIENLB CTR < 3.4% (p25) → content/creative yếu", category: "diagnosis",
    condition_when: "mkt_name='KIENLB' AND ctr_pct < 3.4 AND impressions > 1000",
    action_then: "Diagnose 'content vấn đề' — recommend pause để marketer đổi creative",
    scope: { mkt: "KIENLB", metric: "ctr", threshold: 3.4 }, confidence_pct: 60 },

  { insight: "LINHMT CTR < 3.27% (p25) → content/creative yếu", category: "diagnosis",
    condition_when: "mkt_name='LINHMT' AND ctr_pct < 3.27 AND impressions > 1000",
    action_then: "Diagnose 'content vấn đề' — recommend pause để marketer đổi creative",
    scope: { mkt: "LINHMT", metric: "ctr", threshold: 3.27 }, confidence_pct: 60 },

  { insight: "NAMDV CTR < 5.16% (p25) → content/creative yếu (NAMDV có CTR baseline cao)", category: "diagnosis",
    condition_when: "mkt_name='NAMDV' AND ctr_pct < 5.16 AND impressions > 1000",
    action_then: "Diagnose 'content vấn đề' — recommend pause để marketer đổi creative",
    scope: { mkt: "NAMDV", metric: "ctr", threshold: 5.16 }, confidence_pct: 60 },

  { insight: "XUANLT CTR < 3.66% (p25) → content/creative yếu", category: "diagnosis",
    condition_when: "mkt_name='XUANLT' AND ctr_pct < 3.66 AND impressions > 1000",
    action_then: "Diagnose 'content vấn đề' — recommend pause để marketer đổi creative",
    scope: { mkt: "XUANLT", metric: "ctr", threshold: 3.66 }, confidence_pct: 60 },

  // ─── Nhóm 3: Day-of-week patterns ───
  { insight: "Chủ Nhật care cao bất thường (avg 79.9% vs tuần ~66%)", category: "pattern",
    condition_when: "EXTRACT(DOW FROM CURRENT_DATE) = 0",
    action_then: "Threshold pause cao hơn 15% so với ngày thường — không panic cắt sớm CN. Có thể do CSKH nghỉ.",
    scope: { dow: 0, day: "Sun" }, confidence_pct: 70 },

  { insight: "Thứ 5-6 care tốt nhất tuần (~64-65%)", category: "opportunity",
    condition_when: "EXTRACT(DOW FROM CURRENT_DATE) IN (4,5)",
    action_then: "Có thể aggressive hơn: threshold pause care_3d > 32%, ưu tiên scale camp tốt",
    scope: { dow: [4, 5], day: "Thu/Fri" }, confidence_pct: 65 },

  // ─── Nhóm 4: Camp age effect ───
  { insight: "Camp ≤3 ngày là sweet spot (avg care 63% — best bucket)", category: "warning",
    condition_when: "days_running <= 3",
    action_then: "no_action — để camp ramp up. Đây là quy tắc cứng đã có nhưng skill nhắc agent ưu tiên bảo vệ camp mới.",
    scope: { age_bucket: "≤3d" }, confidence_pct: 80 },

  { insight: "Camp >14 ngày, care_7d > 100% — pattern lỗi thời (avg 175%)", category: "warning",
    condition_when: "days_running > 14 AND care_7d > 100",
    action_then: "Recommend pause hoặc giảm budget mạnh — camp đã qua peak, hiệu quả giảm rõ rệt",
    scope: { age_bucket: ">14d" }, confidence_pct: 65 },

  // ─── Nhóm 5: Product cluster (winners/losers) ───
  { insight: "CHẢO VÀNG là winner cluster (5/10 top camps tốt nhất shop)", category: "opportunity",
    condition_when: "campaign_name ILIKE '%CHẢO VÀNG%' AND care_7d < 60",
    action_then: "Bảo vệ camp — không vội cắt. Có thể recommend resume nếu PAUSED và care_7d < 50",
    scope: { product: "CHẢO VÀNG" }, confidence_pct: 75 },

  { insight: "NỒI ÁP SUẤT (NAMDV) là loser cluster (4/10 top tệ nhất)", category: "warning",
    condition_when: "mkt_name='NAMDV' AND campaign_name ILIKE '%NỒI ÁP SUẤT%' AND care_3d > 200",
    action_then: "Pause aggressive — pattern lỗ rõ ràng qua nhiều ngày",
    scope: { mkt: "NAMDV", product: "NỒI ÁP SUẤT" }, confidence_pct: 75 },

  { insight: "HỘP NHỰA (KIENLB) đang có camp lỗ nặng (care > 500%)", category: "warning",
    condition_when: "mkt_name='KIENLB' AND campaign_name ILIKE '%HỘP NHỰA%' AND care_7d > 200",
    action_then: "Pause ngay — không nên scale sản phẩm này nữa cho đến khi đổi creative/giá",
    scope: { mkt: "KIENLB", product: "HỘP NHỰA" }, confidence_pct: 70 },

  { insight: "CHỔI XỐP (ANHNT) loser cluster (2/10 top tệ)", category: "warning",
    condition_when: "mkt_name='ANHNT' AND campaign_name ILIKE '%CHỔI XỐP%' AND care_7d > 150",
    action_then: "Recommend pause hoặc giảm budget mạnh 50%",
    scope: { mkt: "ANHNT", product: "CHỔI XỐP" }, confidence_pct: 65 },

  // ─── Nhóm 6: Marketing best practices ───
  { insight: "CTR cao + clicks nhiều + COD=0 → landing page/combo vấn đề (KHÔNG phải camp)", category: "diagnosis",
    condition_when: "ctr_pct > 3 AND clicks > 50 AND cod_orders_today = 0",
    action_then: "no_action — không cắt camp. Reason ghi 'landing page/combo cần review' để marketer biết",
    scope: { type: "conversion_problem" }, confidence_pct: 70 },

  { insight: "Sáng sớm (giờ 6-10) COD thấp tự nhiên — chờ thêm trước khi action", category: "pattern",
    condition_when: "current_hour BETWEEN 6 AND 10 AND cod_orders_today < 5",
    action_then: "Wait — chỉ predict không action. COD thường tập trung 11h-22h.",
    scope: { time_range: "morning" }, confidence_pct: 75 },

  { insight: "Cuối tháng (28-31) care thường cao do flush budget marketer", category: "pattern",
    condition_when: "EXTRACT(DAY FROM CURRENT_DATE) >= 28",
    action_then: "Tăng threshold pause +5% — chấp nhận care cao tạm thời cuối tháng",
    scope: { time_range: "month_end" }, confidence_pct: 55 },

  { insight: "Camp PAUSED có care_7d < 25% và cod_7d > 0 là cơ hội resume", category: "opportunity",
    condition_when: "effective_status='PAUSED' AND care_7d < 25 AND cod_7d > 0",
    action_then: "Recommend resume với suggested_budget = spend_7d/7 * 1.0 (giữ pace cũ)",
    scope: { type: "resume_opportunity" }, confidence_pct: 70 },

  { insight: "Shop cod_today < 25tr (< 50% target 50tr) — thận trọng, không cắt mạnh", category: "warning",
    condition_when: "shop_cod_today < 25000000",
    action_then: "Threshold pause care_3d > 45% (cao hơn bình thường). Lý do: thiếu doanh số, cắt thêm sẽ càng thiếu.",
    scope: { type: "low_revenue_day" }, confidence_pct: 80 },
]

async function main() {
  const { MedusaApp } = await import("@medusajs/framework")
  const { loadEnv } = await import("@medusajs/framework/utils")
  loadEnv("production", process.cwd())

  const app = await MedusaApp({
    workerMode: "shared",
    loadedModules: [],
  } as any)

  const sql = (app as any).sharedContainer.resolve("cskhAnalysisModule")

  console.log(`[seed] Inserting ${SKILLS.length} skills...`)
  let inserted = 0
  let skipped = 0

  for (const s of SKILLS) {
    // Check duplicate by insight text
    const existing = await sql.sql(
      `SELECT id FROM agent_insight WHERE insight = $1 LIMIT 1`,
      [s.insight]
    ).catch(() => [])

    if (existing.length > 0) {
      skipped++
      continue
    }

    await sql.sql(
      `INSERT INTO agent_insight
         (insight, category, scope, evidence, agent_model, skill_type, condition_when, action_then, confidence_pct, source, active)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'skill', $6, $7, $8, 'seed', true)`,
      [
        s.insight, s.category,
        JSON.stringify(s.scope),
        JSON.stringify({ source: "seed_data_30d", percentile: "p75/p25" }),
        "seed-script",
        s.condition_when, s.action_then, s.confidence_pct,
      ]
    )
    inserted++
  }

  console.log(`[seed] Done. Inserted=${inserted}, Skipped(duplicates)=${skipped}`)
  process.exit(0)
}

main().catch(err => {
  console.error("[seed] Fatal:", err)
  process.exit(1)
})
