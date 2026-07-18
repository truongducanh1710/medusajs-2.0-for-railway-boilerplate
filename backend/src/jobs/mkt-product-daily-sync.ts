import { MedusaContainer } from "@medusajs/framework"
import { getPool, syncMktProductsFromPancake } from "../api/admin/marketing-video/_lib"

/**
 * Cron: sync danh mục SP từ Pancake POS → bảng mkt_product mỗi ngày 03:00 ICT.
 * mkt_product là nguồn cho cột SP ở bảng giá vốn (/app/gia-von) + marketing-video.
 * Chỉ upsert theo pancake_id — không set inactive, không đụng SP cũ.
 */
export default async function mktProductDailySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  try {
    const pool = getPool()
    const { synced, total } = await syncMktProductsFromPancake(pool)
    logger?.info?.(`[MktProductDaily] Xong — fetched=${total} upserted=${synced}`)
  } catch (err: any) {
    logger?.error?.(`[MktProductDaily] Lỗi sync: ${err.message}`)
  }
}

export const config = {
  name: "mkt-product-daily-sync",
  // 03:00 ICT (GMT+7) = 20:00 UTC ngày hôm trước
  schedule: "0 20 * * *",
}
