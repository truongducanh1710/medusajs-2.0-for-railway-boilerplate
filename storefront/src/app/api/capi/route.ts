import { NextRequest, NextResponse } from "next/server"
import { getStoreMetadata } from "@lib/data/store"

export async function POST(req: NextRequest) {
  const storeMeta = await getStoreMetadata()
  const pixelId =
    storeMeta.fb_pixel_id ||
    process.env.FB_PIXEL_ID ||
    process.env.NEXT_PUBLIC_FB_PIXEL_ID
  const accessToken =
    storeMeta.fb_capi_token ||
    process.env.FB_CAPI_ACCESS_TOKEN

  if (!pixelId || !accessToken) {
    return NextResponse.json({ ok: false, reason: "capi not configured" }, { status: 200 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 })
  }

  // Forward the event payload to Meta CAPI
  const { eventName, eventId, eventSourceUrl, userData = {}, customData = {} } = body as any

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: eventSourceUrl,
        action_source: "website",
        user_data: {
          client_ip_address: clientIp,
          client_user_agent: req.headers.get("user-agent") || "",
          ...userData,
        },
        custom_data: customData,
      },
    ],
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    )
    const data = await res.json()
    return NextResponse.json({ ok: true, meta: data })
  } catch (e: any) {
    console.warn("[CAPI route] failed", e?.message)
    return NextResponse.json({ ok: false, reason: e?.message }, { status: 200 })
  }
}
