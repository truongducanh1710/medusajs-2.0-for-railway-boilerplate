import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QA_CRITERIA, DEPT_LABELS } from "../../../../modules/mkt-task/qa-criteria"
import { listStaff, isoWeekKey } from "../_lib"

// GET /admin/qa/meta — dữ liệu khởi tạo UI: danh sách nhân sự, bộ tiêu chí 2 dept, tuần hiện tại.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const staff = await listStaff(req)
    res.json({
      staff,
      criteria: QA_CRITERIA,
      dept_labels: DEPT_LABELS,
      current_week: isoWeekKey(new Date()),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
