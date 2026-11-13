import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getPool } from "../api/admin/fb-content/_lib"
import { runAutoPost } from "../lib/fb-auto-post"

/**
 * Every 15 minutes: post 1 video/day for each page in fb_auto_post_rule once its post_time (VN) passes.
 * Double posting is prevented by the UNIQUE(page_id, day) claim in fb_auto_post_log.
 */
export default async function fbAutoPost(container: MedusaContainer) {
  const pool = getPool()
  let notifSvc: any = null
  try { notifSvc = container.resolve(Modules.NOTIFICATION) } catch {}
  const notify = async (title: string, description: string) => {
    try {
      await notifSvc?.createNotifications({ channel: "feed", template: "admin-ui", to: "admin", data: { title, description } })
    } catch {}
  }
  try {
    const r = await runAutoPost(pool, notify)
    if (r.posted || r.failed) console.log(`[fb-auto-post] posted=${r.posted} failed=${r.failed}`)
  } catch (e: any) {
    console.error("[fb-auto-post] error:", e?.message)
  }
}

export const config = {
  name: "fb-auto-post",
  schedule: "*/15 * * * *",
}
