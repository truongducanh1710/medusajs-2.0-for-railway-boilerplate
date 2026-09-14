import { MedusaContainer } from "@medusajs/framework"

/**
 * Quét bù video Dohana — LƯỚI AN TOÀN, không phải kênh chính.
 * Video mới về qua webhook /hooks/dohana; cron chỉ bù trường hợp webhook bị miss.
 *
 * ĐANG TẮT (14/09/2026). API key bị Dohana khoá: mọi request trả 429 "Bạn đã vượt quá
 * giới hạn API" từ 30/08/2026, kể cả request đầu tiên sau khi nghỉ dài và kể cả khi gọi
 * ở 0,25 RPS (giới hạn gói free là 2 RPS). Đã kiểm chứng trên cả API v2 lẫn legacy, cả
 * hai domain. Tài liệu Dohana ghi rõ "gọi quá nhiều lần lặp lại có thể bị khoá API" —
 * bản cũ chạy 15 phút/lần đã đốt ~16.000 request hỏng trong 16 ngày.
 *
 * Để cron chạy tiếp chỉ làm Dohana khó mở khoá hơn, nên dừng hẳn cho tới khi họ xác nhận
 * đã mở. Video mới vẫn về qua webhook.
 *
 * BẬT LẠI: đặt biến môi trường DOHANA_SYNC_CRON=on trên Railway (không cần sửa code).
 * Trước khi bật, nhớ chuyển sang API v2 cursor — /partner/video/search (legacy) đã quá
 * hạn khoá từ 17/08/2026.
 */
export default async function dohanaIncrementalSync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any

  if (String(process.env.DOHANA_SYNC_CRON ?? "").toLowerCase() !== "on") {
    logger?.info?.(
      "[DohanaJob] Skip — cron đang tắt (API key bị Dohana khoá 429). " +
      "Đặt DOHANA_SYNC_CRON=on để bật lại."
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
