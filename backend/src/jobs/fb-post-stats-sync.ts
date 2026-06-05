import { MedusaContainer } from "@medusajs/framework"
import { Pool } from "pg"

// Chạy mỗi 6 giờ: sync likes/comments/shares/reach cho tất cả page
export default async function fbPostStatsSync(_container: MedusaContainer) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // Gọi internal API để tái dùng logic syncPageStats
    const baseUrl = process.env.BACKEND_URL || "http://localhost:9000"
    const apiKey = process.env.MEDUSA_ADMIN_API_KEY || ""
    const r = await fetch(`${baseUrl}/admin/fb-content/post-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({}),
    })
    const data = await r.json()
    console.log(`[fb-post-stats-sync] done: synced=${data.synced} pages=${data.pages}`)
  } catch (e: any) {
    console.error("[fb-post-stats-sync] error:", e.message)
  } finally {
    await pool.end()
  }
}

export const config = {
  name: "fb-post-stats-sync",
  schedule: "0 */6 * * *", // mỗi 6 giờ
}
