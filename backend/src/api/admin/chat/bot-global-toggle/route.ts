import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureChatTables, getChatAuthInfo, getChatPool, isBotGloballyDisabled, setBotGloballyDisabled } from "../_lib"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth) return res.status(401).json({ error: "Unauthenticated" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const disabled = await isBotGloballyDisabled(pool)
    return res.json({ disabled })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const auth = await getChatAuthInfo(req)
    if (!auth?.isAdmin) return res.status(403).json({ error: "Admin only" })
    const pool = getChatPool()
    await ensureChatTables(pool)
    const disabled = !!(req.body as any)?.disabled
    await setBotGloballyDisabled(disabled, pool)
    return res.json({ ok: true, disabled })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
