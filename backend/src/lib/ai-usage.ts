import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

const MODEL_COSTS: Record<string, number> = {
  // OpenRouter / text models
  "deepseek-v4-pro":                    0.87,
  "deepseek-v4-flash":                  0.07,
  "google/gemini-3.5-flash":            0.15,
  "google/gemini-2.5-pro":              1.25,
  "anthropic/claude-sonnet-4-6":        3.0,
  "qwen/qwen2.5-vl-72b-instruct":       0.40,
  "meta-llama/llama-3.3-70b-instruct":  0.59,
  // Gemini direct API (video analysis) — input price/1M (video tokens dominate)
  "gemini-3.1-pro-preview":             2.0,
  "gemini-3-pro-preview":               2.0,
  "gemini-2.5-pro":                     1.25,
  "gemini-3.5-flash":                   0.10,
  "gemini-3.1-flash-lite":              0.10,
  "gemini-3-flash-preview":             0.10,
  "gemini-2.5-flash":                   0.10,
  // MiniMax
  "minimax-m3":                         0.07,
  "MiniMax-M3":                         0.07,
}

export async function logAiUsage(params: {
  feature: string
  run_id?: string | null
  model: string
  provider: string
  usage: { prompt_tokens: number; completion_tokens: number }
  context?: Record<string, any>
}): Promise<void> {
  try {
    const { feature, run_id, model, provider, usage, context } = params
    const total = (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
    const costPer1M = MODEL_COSTS[model] ?? 0.5  // fallback $0.5 nếu model chưa có trong bảng
    const cost_usd = (total / 1_000_000) * costPer1M

    const client = await getPool().connect()
    try {
      await client.query(
        `INSERT INTO ai_usage_log
          (feature, run_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, context)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          feature,
          run_id ?? null,
          model,
          provider,
          usage.prompt_tokens ?? 0,
          usage.completion_tokens ?? 0,
          total,
          cost_usd,
          context ? JSON.stringify(context) : null,
        ]
      )
    } finally {
      client.release()
    }
  } catch {
    // Không để lỗi log làm crash agent
  }
}
