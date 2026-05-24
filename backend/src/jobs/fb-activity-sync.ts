import { MedusaContainer } from "@medusajs/framework"

const FB_API_BASE = "https://graph.facebook.com/v18.0"
const KEEP_EVENTS = new Set(["update_campaign_run_status", "update_campaign_budget"])

function extractMkt(campaignName: string): string {
  const cleaned = campaignName.replace(/^(TEST[_-]|MESS[_-])+/gi, "")
  for (const sep of ["_", "-"]) {
    const parts = cleaned.split(sep)
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i].trim()
      if (/^[A-Z]{3,8}$/.test(t)) return t
    }
  }
  return "KHÁC"
}

function actorType(actorName: string): string {
  if (!actorName || actorName === "Meta") return "meta"
  if (actorName.startsWith("Quy tắc") || actorName.startsWith("Rule:")) return "rule"
  return "human"
}

async function pullActivitiesForAccount(
  actId: string,
  since: number,
  until: number,
  token: string,
  sql: any
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  let skipped = 0
  let url: string | null =
    `${FB_API_BASE}/${actId}/activities?fields=actor_name,event_time,object_id,object_name,event_type,extra_data&since=${since}&until=${until}&limit=100&access_token=${token}`

  while (url) {
    let body: any
    try {
      const res = await fetch(url)
      body = await res.json()
      if (body?.error) {
        console.error(`[fb-activity-sync] ${actId} API error:`, body.error.message)
        break
      }
    } catch (err: any) {
      console.error(`[fb-activity-sync] ${actId} fetch error:`, err.message)
      break
    }

    const events: any[] = (body.data ?? []).filter((e: any) => KEEP_EVENTS.has(e.event_type))

    for (const e of events) {
      let extra: any = {}
      try { extra = JSON.parse(e.extra_data ?? "{}") } catch {}

      const mktName = extractMkt(e.object_name ?? "")
      const aType = actorType(e.actor_name ?? "")

      try {
        await sql.sql(
          `INSERT INTO fb_camp_activity
            (ad_account_id, campaign_id, campaign_name, mkt_name, actor_name, actor_type,
             event_type, event_time, old_value, new_value, extra_data, fb_object_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)
           ON CONFLICT (ad_account_id, fb_object_id, event_time, event_type) DO NOTHING`,
          [
            actId,
            e.object_id ?? "",
            e.object_name ?? "",
            mktName,
            e.actor_name ?? "",
            aType,
            e.event_type,
            new Date(e.event_time),
            JSON.stringify({ value: extra.old_value ?? null }),
            JSON.stringify({ value: extra.new_value ?? null }),
            JSON.stringify(extra),
            e.object_id ?? "",
          ]
        )
        inserted++
      } catch (err: any) {
        if (err.message?.includes("duplicate") || err.code === "23505") {
          skipped++
        } else {
          console.error(`[fb-activity-sync] insert error:`, err.message)
          skipped++
        }
      }
    }

    url = body.paging?.next ?? null
  }

  return { inserted, skipped }
}

export async function syncFbActivities(container: MedusaContainer, date?: string) {
  const cskhService = container.resolve("cskhAnalysisModule") as any
  const token = process.env.FB_ACCESS_TOKEN ?? ""

  if (!token) {
    console.error("[fb-activity-sync] FB_ACCESS_TOKEN not set")
    return
  }

  const accounts = await cskhService.sql(
    `SELECT account_id FROM fb_ad_account WHERE deleted_at IS NULL AND active = true ORDER BY created_at ASC`
  ).catch(() => [] as any[])

  if (!accounts.length) {
    console.log("[fb-activity-sync] No active accounts")
    return
  }

  // Default: hôm qua UTC
  const targetDate = date ?? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  const since = Math.floor(new Date(targetDate + "T00:00:00Z").getTime() / 1000)
  const until = since + 86400

  console.log(`[fb-activity-sync] Syncing ${accounts.length} accounts for ${targetDate}`)

  let totalInserted = 0
  let totalSkipped = 0

  for (const { account_id } of accounts) {
    const actId = account_id.startsWith("act_") ? account_id : `act_${account_id}`
    try {
      const { inserted, skipped } = await pullActivitiesForAccount(actId, since, until, token, cskhService)
      totalInserted += inserted
      totalSkipped += skipped
      console.log(`[fb-activity-sync] ${actId}: +${inserted} inserted, ${skipped} skipped`)
    } catch (err: any) {
      console.error(`[fb-activity-sync] ${actId} failed:`, err.message)
    }
  }

  console.log(`[fb-activity-sync] Done: ${totalInserted} inserted, ${totalSkipped} skipped`)
}

export default async function execute(container: MedusaContainer) {
  await syncFbActivities(container)
}

export const config = {
  name: "fb-activity-sync",
  schedule: "30 18 * * *",
}
