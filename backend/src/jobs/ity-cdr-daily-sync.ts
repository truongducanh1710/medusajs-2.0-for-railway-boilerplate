import { MedusaContainer } from "@medusajs/framework"

// Sync CDR mỗi 5 phút để theo dõi cuộc gọi Sale/CSKH gần thời gian thực.
// Chỉ pull ngày hôm nay — ITY vẫn giữ log 30 ngày nên không lo mất dữ liệu giữa các lần chạy;
// backfill lịch sử xa hơn dùng route POST /admin/ity-cdr-sync thủ công khi cần.
export default async function ityCdrDailySync(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const syncService = container.resolve("ityCdrSyncModule") as any

  // Server chạy UTC — phải cộng +7h để lấy đúng "hôm nay" theo giờ VN,
  // tránh lệch ngày vào khung UTC 17:00-23:59 (= VN 00:00-06:59 hôm sau).
  const todayVN = new Date(Date.now() + 7 * 3600 * 1000)

  try {
    const { jobId } = await syncService.pullByDateRange(todayVN, todayVN)
    logger?.info?.(`[ItyCdrJob] Started sync job ${jobId} for ${todayVN.toISOString().slice(0, 10)}`)
  } catch (err: any) {
    if (err.code === "SYNC_IN_PROGRESS") {
      // Bình thường ở tần suất 5 phút nếu job trước chưa xong — không log noise
      return
    }
    logger?.error?.(`[ItyCdrJob] Failed to start sync: ${err.message}`)
  }
}

export const config = {
  name: "ity-cdr-daily-sync",
  schedule: "*/5 * * * *",
}
