const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export async function getStoreMetadata(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${BACKEND}/store/info`, {
      headers: { "x-publishable-api-key": PUB_KEY },
      next: { tags: ["store"], revalidate: 3600 },
    })
    if (!res.ok) return {}
    const { store } = await res.json()
    return (store?.metadata as Record<string, string>) ?? {}
  } catch {
    return {}
  }
}
