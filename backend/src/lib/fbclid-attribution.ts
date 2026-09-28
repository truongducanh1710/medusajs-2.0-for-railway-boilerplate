import { getPool } from "./db"

// Recover campaign attribution from the fbclid when the UTM cookie is lost.
//
// Web orders from FB in-app browser sometimes arrive with fbc (fbclid) but no
// utm_* (cookie cleared / IAB session reset). 27–28/09: 3 of 6 orders from the
// Ads327 web camp lost UTM → Pancake could not match them to the campaign.
//
// New-format fbclid embeds an "adid": base64url after the 2-char prefix holds
// "adid" + 8-byte big-endian id. It is NOT the Marketing API ad id (Graph returns
// "does not exist"), but it is stable per ad — every click on the same ad yields
// the same value. So we learn the mapping from earlier orders of the same ad that
// did keep their UTM.

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const

export function adIdFromFbc(fbc: string | undefined | null): string | undefined {
  if (!fbc) return undefined
  try {
    // fbc = fb.1.<timestamp>.<fbclid>
    const fbclid = fbc.split(".").slice(3).join(".")
    const s = fbclid.split("_aem_")[0].slice(2)
    const buf = Buffer.from(s, "base64url")
    const i = buf.indexOf("adid")
    if (i < 0 || buf.length < i + 12) return undefined
    const str = buf.readBigUInt64BE(i + 4).toString()
    return /^12\d{16}$/.test(str) ? str : undefined
  } catch {
    return undefined
  }
}

/**
 * Returns UTM fields to merge into metadata when the order has fbc but no
 * utm_campaign and an earlier order from the same ad carried UTM.
 */
export async function recoverUtmFromFbclid(metadata: Record<string, any> | null | undefined) {
  if (!metadata || metadata.utm_campaign) return undefined
  const adId = adIdFromFbc(metadata.fbc)
  if (!adId) return undefined
  try {
    const { rows } = await getPool().query(
      `SELECT metadata FROM "order"
        WHERE metadata->>'fbc' IS NOT NULL AND COALESCE(metadata->>'utm_campaign','') <> ''
          AND COALESCE(metadata->>'utm_recovered_from','') = ''
          AND created_at > now() - interval '90 days'
        ORDER BY created_at DESC LIMIT 1000`
    )
    const match = rows.find((r: any) => adIdFromFbc(r.metadata?.fbc) === adId)
    if (!match) return undefined
    const utm: Record<string, string> = {}
    for (const k of UTM_KEYS) if (match.metadata[k]) utm[k] = match.metadata[k]
    return { ...utm, utm_recovered_from: "fbclid", fb_click_adid: adId } as Record<string, string>
  } catch {
    return undefined
  }
}
