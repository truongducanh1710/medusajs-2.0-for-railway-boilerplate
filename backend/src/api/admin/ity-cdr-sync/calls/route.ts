import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/ity-cdr-sync/calls?extension=...&from=...&to=...&limit=...&offset=...
 * Xem danh sách cuộc gọi đã sync — dùng cho báo cáo hiệu suất Sale/CSKH.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { extension, from, to, disposition } = req.query as Record<string, string | undefined>
    const limit = Math.min(Number(req.query.limit ?? 50), 200)
    const offset = Number(req.query.offset ?? 0)

    const filters: Record<string, any> = {}
    if (extension) filters.extension = extension
    if (disposition) filters.disposition = disposition
    if (from || to) {
      filters.calldate = {}
      if (from) filters.calldate.$gte = new Date(from)
      if (to) filters.calldate.$lte = new Date(to)
    }

    const syncService = req.scope.resolve("ityCdrSyncModule") as any
    const [calls, count] = await syncService.listAndCountItyCdrCalls(
      filters,
      { take: limit, skip: offset, order: { calldate: "DESC" } }
    )

    // Join tên nhân viên thật qua bảng mapping extension → user
    const extensionMaps = await syncService.listItyExtensionMaps({})
    const nameByExtension: Record<string, string> = Object.fromEntries(
      extensionMaps.map((m: any) => [m.extension, m.display_name])
    )
    const enrichedCalls = calls.map((c: any) => ({
      ...c,
      agent_display_name: nameByExtension[c.extension] || c.agent_name,
    }))

    return res.json({ calls: enrichedCalls, count, limit, offset })
  } catch (err: any) {
    console.error("[ItyCdrSync Calls API] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
