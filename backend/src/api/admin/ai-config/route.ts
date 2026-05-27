import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const KNOWN_MODELS = [
  { id: "deepseek-v4-pro",                     label: "DeepSeek V4 Pro",            provider: "deepseek",    costPer1M: 0.87 },
  { id: "deepseek-v4-flash",                   label: "DeepSeek V4 Flash",           provider: "deepseek",    costPer1M: 0.07 },
  { id: "google/gemini-3.5-flash",             label: "Gemini 3.5 Flash",            provider: "openrouter",  costPer1M: 0.15 },
  { id: "google/gemini-2.5-pro",               label: "Gemini 2.5 Pro",              provider: "openrouter",  costPer1M: 1.25 },
  { id: "anthropic/claude-sonnet-4-6",         label: "Claude Sonnet 4.6",           provider: "openrouter",  costPer1M: 3.0  },
  { id: "qwen/qwen2.5-vl-72b-instruct",        label: "Qwen 2.5 VL 72B",            provider: "openrouter",  costPer1M: 0.40 },
  { id: "meta-llama/llama-3.3-70b-instruct",   label: "Llama 3.3 70B",              provider: "openrouter",  costPer1M: 0.59 },
]

/**
 * GET /admin/ai-config
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const sql = req.scope.resolve("cskhAnalysisModule") as any
    const features = await sql.sql(`SELECT * FROM ai_feature_config ORDER BY key`).catch(() => [])

    // Tính key env nào đang set (không lộ value)
    const envStatus = {
      DEEPSEEK_API_KEY:    !!process.env.DEEPSEEK_API_KEY,
      OPENROUTER_API_KEY:  !!process.env.OPENROUTER_API_KEY,
    }

    return res.json({ features, available_models: KNOWN_MODELS, env_status: envStatus })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * PATCH /admin/ai-config
 * Body: { key, enabled?, model?, provider?, notes? }
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { key, enabled, model, provider, notes } = (req.body as any) ?? {}
    if (!key) return res.status(400).json({ error: "key required" })

    const actor = (req as any).auth_context?.actor_id ?? "unknown"
    const sql = req.scope.resolve("cskhAnalysisModule") as any

    // Upsert — chỉ cập nhật field nào được gửi lên
    const updates: string[] = ["updated_by = $2", "updated_at = now()"]
    const vals: any[] = [key, actor]

    if (enabled !== undefined) { vals.push(enabled);  updates.push(`enabled = $${vals.length}`) }
    if (model !== undefined)   { vals.push(model);    updates.push(`model = $${vals.length}`) }
    if (provider !== undefined){ vals.push(provider); updates.push(`provider = $${vals.length}`) }
    if (notes !== undefined)   { vals.push(notes);    updates.push(`notes = $${vals.length}`) }

    const row = await sql.sql(
      `UPDATE ai_feature_config SET ${updates.join(", ")} WHERE key = $1 RETURNING *`,
      vals
    ).catch((e: any) => { throw new Error(e.message) })

    if (!row.length) return res.status(404).json({ error: `Feature '${key}' không tồn tại` })
    return res.json({ ok: true, feature: row[0] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
