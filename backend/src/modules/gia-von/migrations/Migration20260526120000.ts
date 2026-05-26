import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260526120000 extends Migration {
  async up(): Promise<void> {
    // Manual mapping product_cost → Pancake display_id
    const mappings: [string, string][] = [
      ["cost_dung_cu_xo_kim",              "PHVVN001_XKC"],
      ["cost_bo_lau_nha_tach_nuoc",        "PHVVN003_BLN"],
      ["cost_gie_lau_nha_tach_nuoc",       "PHVVN004_GBLN"],
      ["cost_cay_lau_nha_tu_vat_phun_suong","PHVVN006_TVPS"],
      ["cost_gie_lau_nha_phun_suong",      "PHVVN008_GLNTV"],
      ["cost_cay_lau_mini_kem_gat_nuoc",   "PHVVN009_CLMN"],
      ["cost_bo_lau_nha_tu_vat_bot_xop",   "PHVVN010_CLXOP"],
      ["cost_chao_gang_duc_nguyen_khoi",   "PHVVN012_CGX"],
      ["cost_ro_nao_rau_cu_da_nang",       "PHVVN013_RNDN"],
      ["cost_dung_cu_bao_da_nang",         "PHVVN014_MBDN"],
      ["cost_mut_xop_cay_lau_nha_bot_xop", "PHVVN015_MXCLN"],
      ["cost_chao_nau_an_kem_khay_hap",    "PHVVN016_CCD"],
      ["cost_tay_vin_canh_giuong",         "PHVVN017_TVDG"],
      ["cost_tam_dan_nhiet_bep_gas",       "PHVVN018_TCB"],
      ["cost_gia_phoi_giay_dep",           "PHVVN019_GDG"],
      ["cost_hop_nhua_nhieu_ngan_nho",     "PHVVN020_TDH_MEDIUM"],
      ["cost_hop_nhua_nhieu_ngan_lon",     "PHVVN020_TDH_LARGE"],
      ["cost_long_ban_gap_gon",            "PHVVN021_LB"],
      ["cost_gio_dung_quan_ao_da_nang",    "PHVVN023_GDQA"],
      ["cost_hop_com_giu_nhiet",           "PHVVN025_HCGN"],
      ["cost_moc_treo_tuong",              "PHVVN027_MTT"],
      ["cost_balo_chay_bo",               "PHVVN028_BL"],
      ["cost_khay_de_vung_nhua",           "PHVVN029_KDV"],
      ["cost_noi_ap_suat",                 "PHVVN030_NAS"],
      ["cost_noi_ap_suat_cam",             "PHVVN030_NAS_CAM"],
      ["cost_noi_ap_suat_trang",           "PHVVN030_NAS_TRANG"],
      ["cost_bo_cay_lau_nha_xanh",         "PHVVN031_BCX"],
      ["cost_noi_ap_suat_da_nang",         "PHVVN032_NASV"],
      ["cost_noi_chong_dinh_trang_men_su", "PHVVN033_NS"],
      ["cost_ke_de_do",                    "PHVVN034_KĐĐ"],
      ["cost_gay_chong_cho_nguoi_gia",     "PHVVN035_GCNG"],
      ["cost_noi_chien_inox_304",          "PHVVN036_NC"],
    ]

    for (const [product_id, display_id] of mappings) {
      this.addSql(
        `UPDATE product_cost SET pancake_display_id = '${display_id}' WHERE product_id = '${product_id}' AND (pancake_display_id IS NULL OR pancake_display_id != '${display_id}');`
      )
    }
  }

  async down(): Promise<void> {
    this.addSql(`UPDATE product_cost SET pancake_display_id = NULL WHERE product_id IN (
      'cost_dung_cu_xo_kim','cost_bo_lau_nha_tach_nuoc','cost_gie_lau_nha_tach_nuoc',
      'cost_cay_lau_nha_tu_vat_phun_suong','cost_gie_lau_nha_phun_suong',
      'cost_cay_lau_mini_kem_gat_nuoc','cost_bo_lau_nha_tu_vat_bot_xop',
      'cost_chao_gang_duc_nguyen_khoi','cost_ro_nao_rau_cu_da_nang',
      'cost_dung_cu_bao_da_nang','cost_mut_xop_cay_lau_nha_bot_xop',
      'cost_chao_nau_an_kem_khay_hap','cost_chao_nau_an_kem_khay_hap_sat',
      'cost_tay_vin_canh_giuong','cost_tam_dan_nhiet_bep_gas','cost_gia_phoi_giay_dep',
      'cost_hop_nhua_nhieu_ngan_nho','cost_hop_nhua_nhieu_ngan_lon',
      'cost_long_ban_gap_gon','cost_gio_dung_quan_ao_da_nang','cost_hop_com_giu_nhiet',
      'cost_moc_treo_tuong','cost_balo_chay_bo','cost_khay_de_vung_nhua',
      'cost_noi_ap_suat','cost_noi_ap_suat_cam','cost_noi_ap_suat_trang',
      'cost_bo_cay_lau_nha_xanh','cost_noi_ap_suat_da_nang','cost_noi_chong_dinh_trang_men_su',
      'cost_ke_de_do','cost_gay_chong_cho_nguoi_gia','cost_noi_chien_inox_304'
    );`)
  }
}
