export function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function sendCAPIEvent({
  pixelId,
  accessToken,
  eventName,
  eventId,
  eventSourceUrl,
  userData = {},
  customData = {},
}: {
  pixelId: string
  accessToken: string
  eventName: string
  eventId: string
  eventSourceUrl?: string
  userData?: Record<string, string>
  customData?: Record<string, unknown>
}) {
  if (!pixelId || !accessToken) return

  try {
    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          event_source_url: eventSourceUrl,
          action_source: "website",
          user_data: {
            client_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
            ...userData,
          },
          custom_data: customData,
        },
      ],
    }

    await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    )
  } catch (e) {
    // CAPI errors are non-fatal
    console.warn("[CAPI] Failed to send event", eventName, e)
  }
}
