import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Parse "dd/mm/yyyy" hoặc "d/m/yyyy" -> "yyyy-mm-dd" (NULL nếu rỗng/không hợp lệ).
function d(s: string | null): string | null {
  if (!s) return null
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`
}

type Row = {
  ma_nv: string; ho_ten: string; gioi_tinh: string | null; team: string | null; chuc_vu: string | null
  ngay_bat_dau: string | null; ngay_chinh_thuc: string | null
  email_cong_ty: string | null; email_ca_nhan: string | null
  ngay_sinh: string | null; sdt: string | null; cccd: string | null; ngay_cap: string | null; noi_cap: string | null
  noi_o_hien_tai: string | null; dia_chi_thuong_tru: string | null
  trinh_do: string | null; hon_nhan: string | null; ho_so_du: boolean
  hdtv: string | null; hdld: string | null; ngay_het_han_hdld: string | null; ghi_chu: string | null
  trang_thai: string
}

// Data từ file Excel "Nhập hàng Công ty Phan Việt - TT_VN.csv" (tab nhân sự), 22 dòng.
// Cột "mới" (nơi ở hiện tại mới/địa chỉ thường trú mới) ưu tiên khi có giá trị.
const ROWS: Row[] = [
  { ma_nv: "NV0010", ho_ten: "Phan Đăng Hoàn", gioi_tinh: "Nam", team: null, chuc_vu: "Giám đốc",
    ngay_bat_dau: d("10/04/2023"), ngay_chinh_thuc: null,
    email_cong_ty: null, email_ca_nhan: null,
    ngay_sinh: d("10/7/1986"), sdt: "0337511389", cccd: "040086000959", ngay_cap: null, noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "P1102 Nhà NC2 ĐTTH-NC Nhân Chính, Thanh Xuân, Hà Nội", dia_chi_thuong_tru: "P1102 Nhà NC2 ĐTTH-NC Nhân Chính, Thanh Xuân, Hà Nội",
    trinh_do: null, hon_nhan: "Kết hôn", ho_so_du: false,
    hdtv: null, hdld: null, ngay_het_han_hdld: null, ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0106", ho_ten: "Nguyễn Anh Dũng", gioi_tinh: "Nam", team: "HCTH", chuc_vu: "NV Kế toán",
    ngay_bat_dau: d("15/7/2025"), ngay_chinh_thuc: d("15/08/2025"),
    email_cong_ty: "dungna@phanviet.vn", email_ca_nhan: "nguyenanhdung8991@gmail.com",
    ngay_sinh: d("8/9/1991"), sdt: "0934540734", cccd: "001091038769", ngay_cap: d("25/04/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "Số 3 ngách 46/12 ngõ 46 phố Văn Hội, phường Đông Ngạc, Từ Liêm, Hà Nội", dia_chi_thuong_tru: "Số 3 ngách 46/12 ngõ 46 phố Văn Hội, phường Đông Ngạc, Hà Nội",
    trinh_do: "ThS", hon_nhan: "Kết hôn", ho_so_du: false,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("14/08/2026"), ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0103", ho_ten: "Nguyễn Quỳnh Hương", gioi_tinh: "Nữ", team: "Kho vận", chuc_vu: "NV Mua hàng",
    ngay_bat_dau: d("09/06/2025"), ngay_chinh_thuc: d("16/07/2025"),
    email_cong_ty: "huongnq.phv@gmail.com", email_ca_nhan: "huongnguyena13@gmail.com",
    ngay_sinh: d("13/09/2003"), sdt: "0377879363", cccd: "017303002537", ngay_cap: null, noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "Thôn Liên Hồng 1, Xã Lạc Thuỷ, Tỉnh Phú Thọ", dia_chi_thuong_tru: "Ngõ 138, Mễ Trì Thượng, Phường Mễ Trì, Quận Nam Từ Liêm, Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("08/01/2028"), ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0104", ho_ten: "Hà Thị Hương Giang", gioi_tinh: "Nữ", team: "Kho vận", chuc_vu: "NV Mua hàng",
    ngay_bat_dau: d("09/06/2025"), ngay_chinh_thuc: d("16/07/2025"),
    email_cong_ty: "gianghth.phv@gmail.com", email_ca_nhan: "hahuonggiang19071996@gmail.com",
    ngay_sinh: d("19/07/1996"), sdt: "0961519503", cccd: "034196010511", ngay_cap: d("28/9/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "Số 58 Chùa Láng, Phường Láng Thượng, Hà Nội", dia_chi_thuong_tru: null,
    trinh_do: null, hon_nhan: "Kết hôn", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("08/01/2028"), ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0089", ho_ten: "Nguyễn Kiều Ly", gioi_tinh: "Nữ", team: "Sale", chuc_vu: "NV Vận đơn",
    ngay_bat_dau: d("03/03/2025"), ngay_chinh_thuc: d("03/04/2025"),
    email_cong_ty: "lyntk.phv@gmail.com", email_ca_nhan: "kieuly1404@gmail.com",
    ngay_sinh: d("14/04/1996"), sdt: "0379441420", cccd: "001196037972", ngay_cap: d("10/5/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "15D1A phường Hoàng Mai, TP Hà Nội", dia_chi_thuong_tru: "15D1A phường Hoàng Mai, TP Hà Nội",
    trinh_do: "CĐ", hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("02/10/2025"), ghi_chu: "6 THÁNG", trang_thai: "active" },
  { ma_nv: "NV0008", ho_ten: "Trương Đức Anh", gioi_tinh: "Nam", team: "Marketing", chuc_vu: "Phó Giám đốc",
    ngay_bat_dau: d("10/04/2023"), ngay_chinh_thuc: d("10/04/2023"),
    email_cong_ty: null, email_ca_nhan: null,
    ngay_sinh: d("17/10/1996"), sdt: "0964423288", cccd: "001096001128", ngay_cap: d("22/09/2022"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "410 B1, Phường Nghĩa Đô, thành phố Hà Nội", dia_chi_thuong_tru: "410 B1, Phường Nghĩa Đô, thành phố Hà Nội",
    trinh_do: "ĐH", hon_nhan: "Kết hôn", ho_so_du: false,
    hdtv: "20250504/HĐLĐ", hdld: null, ngay_het_han_hdld: d("03/05/2026"), ghi_chu: "thời hạn 2 năm", trang_thai: "active" },
  { ma_nv: "NV0053", ho_ten: "Nguyễn Tuấn Anh", gioi_tinh: "Nam", team: "Marketing", chuc_vu: "NV FB Ads",
    ngay_bat_dau: d("13/03/2024"), ngay_chinh_thuc: d("14/06/2024"),
    email_cong_ty: "anhnt.phv@gmail.com", email_ca_nhan: null,
    ngay_sinh: d("11/08/2001"), sdt: "0888650605", cccd: "025201011845", ngay_cap: d("12/07/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "NO4-14 - khu tái định cư Triều Khúc, phường Thanh Liệt, Hà Nội", dia_chi_thuong_tru: "TDP Nậm Sắt 2, Thị trấn Bắc Hà, Bắc Hà, Lào Cai",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("30/06/2026"), ghi_chu: "1 năm", trang_thai: "active" },
  { ma_nv: "NV0065", ho_ten: "Lê Bá Kiên", gioi_tinh: "Nam", team: "Marketing", chuc_vu: "NV FB Ads",
    ngay_bat_dau: d("03/06/2024"), ngay_chinh_thuc: d("03/07/2024"),
    email_cong_ty: "kienlb.phv@gmail.com", email_ca_nhan: null,
    ngay_sinh: d("08/10/2000"), sdt: "0916503719", cccd: "038200010417", ngay_cap: d("14/08/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "55 phố Nhân Hòa, Phường Thanh Xuân, Thành phố Hà Nội", dia_chi_thuong_tru: "Thôn Đông Nam, Xã Hoằng Giang, Tỉnh Thanh Hóa",
    trinh_do: "ĐH", hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("02/01/2027"), ghi_chu: "1 năm", trang_thai: "active" },
  { ma_nv: "NV0091", ho_ten: "Đào Ngọc Tú Linh", gioi_tinh: "Nữ", team: "Sale", chuc_vu: "NV Sale",
    ngay_bat_dau: d("18/03/2025"), ngay_chinh_thuc: d("18/04/2025"),
    email_cong_ty: "linhdnt.phv@gmail.com", email_ca_nhan: "tlinhhh777@gmail.com",
    ngay_sinh: d("17/04/1996"), sdt: "0869839896", cccd: "017196006842", ngay_cap: d("20/08/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "Xóm 3, xã Tân Lạc, Phú Thọ", dia_chi_thuong_tru: "Chung cư Iris Garden, tổ 17, phường Cầu Diễn, Quận nam Từ Liêm, thành phố Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("17/10/2025"), ghi_chu: "6 THÁNG", trang_thai: "active" },
  { ma_nv: "NV0101", ho_ten: "Mẫn Thị Thu Chà", gioi_tinh: "Nữ", team: "Sale", chuc_vu: "NV Sale",
    ngay_bat_dau: d("02/05/2025"), ngay_chinh_thuc: d("02/06/2025"),
    email_cong_ty: "chamtt.phv@gmail.com", email_ca_nhan: null,
    ngay_sinh: d("07/11/2000"), sdt: "0972552439", cccd: "001300017516", ngay_cap: d("17/06/2022"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "Đông Hạ, Xã Trung Giã, Thành Phố Hà Nội", dia_chi_thuong_tru: "số 28 ngõ 79 Cầu Giấy, phường Cầu Giấy, Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("01/01/2027"), ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0094", ho_ten: "Nguyễn Thuỳ Dung", gioi_tinh: "Nữ", team: null, chuc_vu: "TTS",
    ngay_bat_dau: d("22/04/2025"), ngay_chinh_thuc: null,
    email_cong_ty: null, email_ca_nhan: "ntd02102006@gmail.com",
    ngay_sinh: d("02/10/2006"), sdt: null, cccd: null, ngay_cap: null, noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: null, dia_chi_thuong_tru: null,
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: null, hdld: null, ngay_het_han_hdld: null, ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0109", ho_ten: "Đào Văn Nam", gioi_tinh: "Nam", team: "Marketing", chuc_vu: "NV FB Ads",
    ngay_bat_dau: d("04/09/2025"), ngay_chinh_thuc: d("01/12/2025"),
    email_cong_ty: null, email_ca_nhan: "nambe86665@gmail.com",
    ngay_sinh: d("30/01/2000"), sdt: "0342272373", cccd: "001200018194", ngay_cap: d("10/01/2025"), noi_cap: "Bộ Công an",
    noi_o_hien_tai: "Bình An, Trung Giã, Sóc Sơn, Hà Nội", dia_chi_thuong_tru: "số 102 ngõ 230 Định Công Thượng, phường Định Công, Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: null, hdld: "20260405-01/HĐLĐ", ngay_het_han_hdld: d("04/04/2027"), ghi_chu: "ký hđlđ xđ thời hạn lần 2, 1 năm", trang_thai: "active" },
  { ma_nv: "NV0056", ho_ten: "Nguyễn Phương Thảo", gioi_tinh: "Nữ", team: "Vận hành sàn", chuc_vu: "NV Marketing Tiktok",
    ngay_bat_dau: d("08/04/2024"), ngay_chinh_thuc: d("09/05/2024"),
    email_cong_ty: "thaonp.phv@gmail.com", email_ca_nhan: "thao43710@gmail.com",
    ngay_sinh: d("10/09/2000"), sdt: "0335754949", cccd: "027300009395", ngay_cap: d("10/05/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "63 Lê Đức Thọ, phường Từ Liêm, Hà Nội", dia_chi_thuong_tru: "Thôn Vạn Ty, xã Nhân Thắng, Bắc Ninh",
    trinh_do: "ĐH", hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("31/12/2026"), ghi_chu: "ký hđlđ xđ thời hạn lần 2, 1 năm", trang_thai: "active" },
  { ma_nv: "NV0055", ho_ten: "Nguyễn Thị Trang", gioi_tinh: "Nữ", team: "Vận hành sàn", chuc_vu: "NV Marketing Tiktok",
    ngay_bat_dau: d("08/04/2024"), ngay_chinh_thuc: d("09/05/2024"),
    email_cong_ty: null, email_ca_nhan: "nguyenthitrangkbn@gmail.com",
    ngay_sinh: d("13/09/2000"), sdt: "0967012084", cccd: "027300009767", ngay_cap: d("10/05/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "63 Lê Đức Thọ, phường Từ Liêm, Hà Nội", dia_chi_thuong_tru: "Thôn Vạn Ty, xã Nhân Thắng, Bắc Ninh",
    trinh_do: "12/12", hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("31/12/2026"), ghi_chu: "ký hđlđ xđ thời hạn lần 2, 1 năm", trang_thai: "active" },
  { ma_nv: "NV0090", ho_ten: "Lê Thị Hoài Thu", gioi_tinh: "Nữ", team: "Vận hành sàn", chuc_vu: "NV Marketing Tiktok",
    ngay_bat_dau: d("03/03/2025"), ngay_chinh_thuc: d("03/04/2025"),
    email_cong_ty: "thulth.phv@gmail.com", email_ca_nhan: "hoaithu82202@gmail.com",
    ngay_sinh: d("08/02/2002"), sdt: "0929480915", cccd: "001302036762", ngay_cap: d("29/06/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "A6A Nam Trung Yên, Phường Yên Hòa, Hà Nội", dia_chi_thuong_tru: "Thôn 3, xã Hoà Lạc, Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: null, hdld: null, ngay_het_han_hdld: d("02/10/2026"), ghi_chu: "ký hđlđ xđ thời hạn lần 2, 1 năm", trang_thai: "active" },
  { ma_nv: "NV0098", ho_ten: "Nguyễn Thanh Tùng", gioi_tinh: "Nam", team: "Kho vận", chuc_vu: "NV Kho",
    ngay_bat_dau: d("22/04/2025"), ngay_chinh_thuc: d("22/05/2025"),
    email_cong_ty: "tungnt.phv@gmail.com", email_ca_nhan: "tung21042000@gmail.com",
    ngay_sinh: d("21/04/2000"), sdt: "0363435389", cccd: "001200037692", ngay_cap: d("18/02/2025"), noi_cap: null,
    noi_o_hien_tai: "25 ngách 9/19 Minh Khai, Trương Định, Hai Bà Trưng, Hà Nội", dia_chi_thuong_tru: "25 ngách 9/19 Minh Khai, Trương Định, Hai Bà Trưng, Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: true,
    hdtv: "20251201-01/HĐLĐ", hdld: null, ngay_het_han_hdld: d("30/11/2026"), ghi_chu: "ký hđlđ xđ thời hạn lần 2, 1 năm", trang_thai: "active" },
  { ma_nv: "NV0108", ho_ten: "Vi Văn Nghĩa", gioi_tinh: "Nam", team: "Kho vận", chuc_vu: "Quản Lý kho",
    ngay_bat_dau: d("17/08/2025"), ngay_chinh_thuc: null,
    email_cong_ty: "nghiavv.phv@gmail.com", email_ca_nhan: "vivannghia11@gmail.com",
    ngay_sinh: d("27/12/1999"), sdt: "0814850233", cccd: "040099016325", ngay_cap: d("21/01/2025"), noi_cap: null,
    noi_o_hien_tai: "29 hoàng an phường trung phụng quận đống đa hà nội", dia_chi_thuong_tru: "Bản chàng piu xã châu thuận huyện quỳ châu tỉnh nghệ an",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: "20260401-01/HĐLĐ", hdld: null, ngay_het_han_hdld: d("31/03/2027"), ghi_chu: "ký hđlđ xđ thời hạn lần 2, 1 năm", trang_thai: "active" },
  { ma_nv: "NV0113", ho_ten: "Phạm Thị Hậu", gioi_tinh: "Nữ", team: "HCTH", chuc_vu: "NV HCNS",
    ngay_bat_dau: d("03/04/2026"), ngay_chinh_thuc: d("03/05/2026"),
    email_cong_ty: "haupt@phanviet.vn", email_ca_nhan: "eminpham@gmail.com",
    ngay_sinh: d("02/02/1996"), sdt: "0397740027", cccd: "022196002806", ngay_cap: d("01/09/2021"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "603 Lạc Long Quân, HN", dia_chi_thuong_tru: "Yên Thanh, Uông Bí, Quảng Ninh",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: "20260403/HĐTV", hdld: "20260503-01/HĐLĐ", ngay_het_han_hdld: d("02/11/2026"), ghi_chu: "ký hđlđ xđ thời hạn lần 1, 6 tháng", trang_thai: "active" },
  { ma_nv: "NV0122", ho_ten: "Nguyễn Đức Hậu", gioi_tinh: "Nam", team: "Vận hành sàn", chuc_vu: "Leader Tiktok Ads",
    ngay_bat_dau: d("22/05/2026"), ngay_chinh_thuc: d("22/06/2026"),
    email_cong_ty: "haund.phv@gmail.com", email_ca_nhan: "duchaunguyen252@gmail.com",
    ngay_sinh: d("25/2/1999"), sdt: "0868825299", cccd: "025099000657", ngay_cap: d("19/11/2024"), noi_cap: "Bộ công an",
    noi_o_hien_tai: "Khu 14 Vĩnh Chân, Hạ Hòa, Phú Thọ", dia_chi_thuong_tru: "53 Tân Triều, Thanh Trì, Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: "2205-01/2026/HĐTV", hdld: null, ngay_het_han_hdld: null, ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0121", ho_ten: "Trần Đình Khải", gioi_tinh: "Nam", team: "Vận hành sàn", chuc_vu: "NV Tiktok Ads",
    ngay_bat_dau: d("22/05/2026"), ngay_chinh_thuc: d("22/06/2026"),
    email_cong_ty: "khaitd1.phv@gmail.com", email_ca_nhan: null,
    ngay_sinh: d("06/02/2001"), sdt: "0388720310", cccd: "001201000431", ngay_cap: d("09/02/2026"), noi_cap: "Bộ công an",
    noi_o_hien_tai: "Thôn Huỳnh Cung - xã Đại Thanh - Thành phố Hà Nội", dia_chi_thuong_tru: "Thôn Huỳnh Cung - xã Đại Thanh - Thành phố Hà Nội",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: "2205-02/2026/HĐTV", hdld: null, ngay_het_han_hdld: null, ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0120", ho_ten: "Hà Ngọc Anh Quân", gioi_tinh: "Nam", team: "Vận hành sàn", chuc_vu: "NV Tiktok Ads",
    ngay_bat_dau: d("22/05/2026"), ngay_chinh_thuc: d("22/06/2026"),
    email_cong_ty: null, email_ca_nhan: "quan21153@gmail.com",
    ngay_sinh: d("23/11/2003"), sdt: "0969968268", cccd: "040203002434", ngay_cap: d("25/05/2022"), noi_cap: "Cục cảnh sát quản lý hành chính trật tự xã hội",
    noi_o_hien_tai: "Thanh Trì, Hà Nội", dia_chi_thuong_tru: "Khối 6 Trường Thi, thành phố Vinh, Nghệ An",
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: "2205-03/2026/HĐTV", hdld: null, ngay_het_han_hdld: null, ghi_chu: null, trang_thai: "active" },
  { ma_nv: "NV0124", ho_ten: "Đỗ Thị Diễm Quỳnh", gioi_tinh: "Nữ", team: "Sale", chuc_vu: "Vận đơn",
    ngay_bat_dau: d("01/07/2026"), ngay_chinh_thuc: null,
    email_cong_ty: null, email_ca_nhan: null,
    ngay_sinh: null, sdt: null, cccd: null, ngay_cap: null, noi_cap: null,
    noi_o_hien_tai: null, dia_chi_thuong_tru: null,
    trinh_do: null, hon_nhan: "Độc thân", ho_so_du: false,
    hdtv: null, hdld: null, ngay_het_han_hdld: null, ghi_chu: null, trang_thai: "active" },
]

export class Migration20260718010000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS employee_profile (
        id TEXT NOT NULL,
        ma_nv TEXT NOT NULL,
        ho_ten TEXT NOT NULL,
        gioi_tinh TEXT NULL,
        team TEXT NULL,
        chuc_vu TEXT NULL,
        ngay_bat_dau TIMESTAMPTZ NULL,
        ngay_chinh_thuc TIMESTAMPTZ NULL,
        email_cong_ty TEXT NULL,
        email_ca_nhan TEXT NULL,
        ngay_sinh TIMESTAMPTZ NULL,
        sdt TEXT NULL,
        cccd TEXT NULL,
        ngay_cap TIMESTAMPTZ NULL,
        noi_cap TEXT NULL,
        noi_o_hien_tai TEXT NULL,
        dia_chi_thuong_tru TEXT NULL,
        trinh_do TEXT NULL,
        hon_nhan TEXT NULL,
        ho_so_du BOOLEAN NOT NULL DEFAULT false,
        hdtv TEXT NULL,
        hdld TEXT NULL,
        ngay_het_han_hdld TIMESTAMPTZ NULL,
        ghi_chu TEXT NULL,
        trang_thai TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT employee_profile_pkey PRIMARY KEY (id)
      )
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS employee_profile_ma_nv_idx ON employee_profile (ma_nv)`)

    for (const r of ROWS) {
      const id = `emp_${r.ma_nv.toLowerCase()}`
      this.addSql(
        `INSERT INTO employee_profile (
          id, ma_nv, ho_ten, gioi_tinh, team, chuc_vu, ngay_bat_dau, ngay_chinh_thuc,
          email_cong_ty, email_ca_nhan, ngay_sinh, sdt, cccd, ngay_cap, noi_cap,
          noi_o_hien_tai, dia_chi_thuong_tru, trinh_do, hon_nhan, ho_so_du,
          hdtv, hdld, ngay_het_han_hdld, ghi_chu, trang_thai
        ) VALUES (
          '${id}', '${esc(r.ma_nv)}', '${esc(r.ho_ten)}', ${lit(r.gioi_tinh)}, ${lit(r.team)}, ${lit(r.chuc_vu)},
          ${lit(r.ngay_bat_dau)}, ${lit(r.ngay_chinh_thuc)}, ${lit(r.email_cong_ty)}, ${lit(r.email_ca_nhan)},
          ${lit(r.ngay_sinh)}, ${lit(r.sdt)}, ${lit(r.cccd)}, ${lit(r.ngay_cap)}, ${lit(r.noi_cap)},
          ${lit(r.noi_o_hien_tai)}, ${lit(r.dia_chi_thuong_tru)}, ${lit(r.trinh_do)}, ${lit(r.hon_nhan)}, ${r.ho_so_du},
          ${lit(r.hdtv)}, ${lit(r.hdld)}, ${lit(r.ngay_het_han_hdld)}, ${lit(r.ghi_chu)}, '${esc(r.trang_thai)}'
        ) ON CONFLICT (ma_nv) DO NOTHING`
      )
    }
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS employee_profile`)
  }
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
}
function lit(s: string | null): string {
  return s === null ? "NULL" : `'${esc(s)}'`
}
