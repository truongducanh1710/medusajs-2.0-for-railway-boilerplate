import { model } from "@medusajs/framework/utils"

const EmployeeProfile = model.define("employee_profile", {
  id: model.id().primaryKey(),
  ma_nv: model.text(),
  ho_ten: model.text(),
  gioi_tinh: model.text().nullable(),
  team: model.text().nullable(),
  chuc_vu: model.text().nullable(),
  ngay_bat_dau: model.dateTime().nullable(),
  ngay_chinh_thuc: model.dateTime().nullable(),
  email_cong_ty: model.text().nullable(),
  email_ca_nhan: model.text().nullable(),
  ngay_sinh: model.dateTime().nullable(),
  sdt: model.text().nullable(),
  cccd: model.text().nullable(),
  ngay_cap: model.dateTime().nullable(),
  noi_cap: model.text().nullable(),
  noi_o_hien_tai: model.text().nullable(),
  dia_chi_thuong_tru: model.text().nullable(),
  trinh_do: model.text().nullable(),
  hon_nhan: model.text().nullable(),
  ho_so_du: model.boolean().default(false),
  hdtv: model.text().nullable(),
  hdld: model.text().nullable(),
  ngay_het_han_hdld: model.dateTime().nullable(),
  ghi_chu: model.text().nullable(),
  trang_thai: model.text().default("active"), // active | nghi_viec
})

export default EmployeeProfile
