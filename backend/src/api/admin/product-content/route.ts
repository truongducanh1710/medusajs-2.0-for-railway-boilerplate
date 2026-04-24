import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// Custom route to update product page_content metadata
// with a higher body size limit than the default Medusa admin product route.
// Widget calls POST /admin/product-content with { productId, metadata }
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { productId, metadata } = req.body as any

    if (!productId || typeof metadata !== "object") {
      return res.status(400).json({ error: "productId and metadata required" })
    }

    const productModule = req.scope.resolve(Modules.PRODUCT)
    const updated = await productModule.updateProducts(productId, { metadata })

    res.json({ ok: true, product: { id: updated.id } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
