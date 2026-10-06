import { getPool } from "./db"

// Rút gọn email về "tên người": thulth@phanviet.vn, thulth.phv@gmail.com, khaitd1.phv@… → thulth / khaitd.
// Tài khoản đăng nhập đã chuyển sang @phanviet.vn nhưng hồ sơ nhân sự còn ghi email .phv@gmail.com
// cũ, nên phải khớp theo phần này — khớp email trần thì gần như ai cũng không ra hồ sơ.
const emailStem = (e: string) => e.toLowerCase().split("@")[0].replace(/\.phv$/, "").replace(/\d+$/, "")

/** Hồ sơ nhân sự (employee_profile) của một tài khoản đăng nhập. */
export function findEmployeeProfile(profiles: any[], email: string): any | null {
  const e = email.toLowerCase()
  const emailsOf = (p: any) => [p.email_cong_ty, p.email_ca_nhan].filter(Boolean).map((x: string) => x.toLowerCase())
  return profiles.find((p) => emailsOf(p).includes(e))
    ?? profiles.find((p) => p.email_cong_ty && emailStem(p.email_cong_ty) === emailStem(e))
    ?? null
}

/** Đã nghỉ việc = có hồ sơ và trạng thái khác "active". Không có hồ sơ thì coi như còn làm. */
export function isResigned(profiles: any[], email: string): boolean {
  const p = findEmployeeProfile(profiles, email)
  return !!p && p.trang_thai !== "active"
}

/** Đọc thẳng bảng employee_profile — dùng ở nơi không có container (lib/notify). */
export async function loadEmployeeProfiles(): Promise<any[]> {
  try {
    const r = await getPool().query(
      `SELECT email_cong_ty, email_ca_nhan, trang_thai FROM employee_profile WHERE deleted_at IS NULL`)
    return r.rows
  } catch {
    return []
  }
}
