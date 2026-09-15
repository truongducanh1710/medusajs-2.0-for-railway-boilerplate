import { MedusaContainer } from "@medusajs/framework"

/**
 * Quét bù video Dohana — LƯỚI AN TOÀN, không phải kênh chính.
 * Video mới về qua webhook /hooks/dohana; cron chỉ bù trường hợp webhook bị miss.
 *
 * Lịch sử: từ 30/08/2026 mọi request trả 429 "vượt quá giới hạn API" — Dohana xác nhận
 * lỗi phía họ và fix ngày 15/09/2026. Trong lúc đó cron được tắt hẳn để không đốt thêm
 * request hỏng. Nay đã bật lại, và sync cũng chuyển sang API v2 cursor vì endpoint legacy
 * /partner/video/search bị khoá từ 17/08/2026 (gọi vào trả 404).
 *
 * TẮT KHẨN CẤP: đặt DOHANA_SYNC_CRON=off trên Railway (không cần sửa code).
 */
export default async function dohanaIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any

  // Dohana đã fix lỗi 429 ngày 15/09/2026 và sync đã chuyển sang API v2 cursor, nên
  // cron bật mặc định trở lại. Đặt DOHANA_SYNC_CRON=off để tắt khẩn cấp nếu cần.
  if (String(process.env.DOHANA_SYNC_CRON ?? "on").toLowerCase() === "off") {
    logger?.info?.(
      "[DohanaJob] Skip — cron đã tắt thủ công (DOHANA_SYNC_CRON=off)."
    )
    return
  }

  if (!process.env.DOHANA_API_KEY) {
    logger?.warn?.("[DohanaJob] Skip — chưa cấu hình DOHANA_API_KEY")
    return
  }

  const syncService = container.resolve("dohanaSyncModule") as any
  try {
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
  // 2 lần/ngày (03:20 và 15:20 giờ VN) — chỉ có tác dụng khi DOHANA_SYNC_CRON=on.
  // Lệch 20 phút để không trùng giờ chẵn với các cron khác.
  schedule: "20 20,8 * * *",
}
