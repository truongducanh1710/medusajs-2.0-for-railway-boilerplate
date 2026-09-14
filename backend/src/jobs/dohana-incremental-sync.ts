import { MedusaContainer } from "@medusajs/framework"

export default async function dohanaIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("dohanaSyncModule") as any

  if (!process.env.DOHANA_API_KEY) {
    logger?.warn?.("[DohanaJob] Skip — chưa cấu hình DOHANA_API_KEY")
    return
  }

  try {
    // Quét lại 24h gần nhất — LƯỚI AN TOÀN, không phải kênh chính. Video mới về qua
    // webhook /hooks/dohana; cron chỉ bù trường hợp webhook bị miss.
    //
    // Gói free Dohana chỉ cho 100 request/NGÀY. Mỗi lần quét phân trang ~34 trang, nên
    // chạy 2 lần/ngày đã tốn ~68 request. Bản cũ chạy mỗi 15 phút (96 lần/ngày × 34
    // trang ≈ 3.000 request) — vượt hạn mức gấp 30 lần, khiến MỌI job 429 liên tục từ
    // 30/08/2026 và không job nào lấy được dữ liệu nữa.
    const result = await syncService.pullRecent(24)
    logger?.info?.(
      `[DohanaJob] imported=${result.imported} updated=${result.updated} errors=${result.errors}`
    )
  } catch (err: any) {
    logger?.error?.(`[DohanaJob] failed: ${err.message}`)
  }
}

export const config = {
  name: "dohana-incremental-sync",
  // 2 lần/ngày (03:20 và 15:20 giờ VN) — xem ghi chú hạn mức 100 request/ngày ở trên.
  // Lệch 20 phút để không trùng giờ chẵn với các cron khác.
  schedule: "20 20,8 * * *",
}
