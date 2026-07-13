import { MedusaContainer } from "@medusajs/framework"

export default async function dohanaIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("dohanaSyncModule") as any

  if (!process.env.DOHANA_API_KEY) {
    logger?.warn?.("[DohanaJob] Skip — chưa cấu hình DOHANA_API_KEY")
    return
  }

  try {
    // Quét lại 2h gần nhất — bù trường hợp webhook video.create bị miss (Dohana tắt webhook
    // nếu server của mình lỗi liên tiếp 25 lần, hoặc timeout).
    const result = await syncService.pullRecent(2)
    logger?.info?.(
      `[DohanaJob] imported=${result.imported} updated=${result.updated} errors=${result.errors}`
    )
  } catch (err: any) {
    logger?.error?.(`[DohanaJob] failed: ${err.message}`)
  }
}

export const config = {
  name: "dohana-incremental-sync",
  schedule: "*/15 * * * *",
}
