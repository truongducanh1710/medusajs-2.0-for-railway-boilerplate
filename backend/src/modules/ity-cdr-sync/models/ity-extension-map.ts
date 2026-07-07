import { model } from "@medusajs/framework/utils"

// Mapping extension tổng đài ITY (207491001...) → nhân viên thật (Medusa user).
// ITY chỉ cho biết username hiển thị (vd "quynhdtd") — không định danh chính xác nhân sự,
// nên cần bảng riêng để admin tự gán/đổi khi có người mới mà không phải sửa code.
const ItyExtensionMap = model.define("ity_extension_map", {
  id: model.id().primaryKey(),
  extension: model.text().unique(),          // vd "207491001"
  user_id: model.text().nullable(),          // Medusa user.id — null nếu chưa gán
  display_name: model.text().default(""),    // tên hiển thị để show nhanh không cần join user
  note: model.text().nullable(),
})

export default ItyExtensionMap
