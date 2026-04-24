import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// Nhận dữ liệu dạng multipart/form-data để bypass Medusa JSON body-parser limit.
// Widget gửi: FormData { productId, metadata (JSON string) }
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Medusa tự parse multipart — fields nằm trong req.body
    const body = req.body as any

    const productId = body?.productId
    let metadata: Record<string, any>

    try {
      metadata = typeof body?.metadata === "string"
        ? JSON.parse(body.metadata)
        : body?.metadata
    } catch {
      return res.status(400).json({ error: "metadata must be valid JSON string" })
    }

    if (!productId || typeof metadata !== "object") {
      return res.status(400).json({ error: "productId and metadata required" })
    }

    // Medusa v2: updateProducts nhận array
    const productModule = req.scope.resolve(Modules.PRODUCT)
    const [updated] = await productModule.updateProducts([{ id: productId, metadata }])

    res.json({ ok: true, product: { id: updated.id } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
