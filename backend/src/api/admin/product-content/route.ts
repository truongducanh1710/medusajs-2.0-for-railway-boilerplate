import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

const ALLOWED_METADATA_KEYS = new Set([
  "page_content",
  "page_content_draft",
  "page_content_versions",
  "page_content_backup",
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { productId, metadata } = req.body as any

    if (typeof productId !== "string" || !productId.trim()) {
      return res.status(400).json({ error: "productId must be a non-empty string" })
    }

    if (!isPlainObject(metadata)) {
      return res.status(400).json({ error: "metadata must be an object" })
    }

    const invalidKeys = Object.keys(metadata).filter(
      (key) => !ALLOWED_METADATA_KEYS.has(key)
    )
    if (invalidKeys.length) {
      return res.status(400).json({
        error: "metadata contains unsupported keys",
        keys: invalidKeys,
      })
    }

    const productModule = req.scope.resolve(Modules.PRODUCT)
    const [updated] = await productModule.updateProducts([{ id: productId, metadata }])

    res.json({ ok: true, product: { id: updated.id } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
