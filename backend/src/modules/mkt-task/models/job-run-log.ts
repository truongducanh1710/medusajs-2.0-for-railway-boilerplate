import { model } from "@medusajs/framework/utils"

// Ghi lại mỗi lần 1 cron job Medusa chạy — dùng để kiểm tra job có tick đúng giờ
// hay không mà không phụ thuộc log Railway (chỉ giữ ngắn hạn qua CLI).
const JobRunLog = model.define("job_run_log", {
  id: model.id().primaryKey(),
  job_name: model.text(),
  ran_at: model.dateTime(),
  status: model.text(), // ok | error
  detail: model.json().nullable(), // { spawned, missed, ... } hoặc { error }
})

export default JobRunLog
