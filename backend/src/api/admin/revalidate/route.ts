import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || "https://www.phanviet.vn"
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET || "phanviet-revalidate"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { tags = ["products"] } = req.body as any
    const result = await fetch(`${STOREFRONT_URL}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": REVALIDATE_SECRET,
      },
      body: JSON.stringify({ tags }),
    })
    const data = await result.json().catch(() => ({}))
    res.json({ ok: result.ok, ...data })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
