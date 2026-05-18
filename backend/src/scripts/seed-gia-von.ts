/**
 * Script import dữ liệu giá vốn từ Google Sheet
 * Chạy: npx medusa exec ./src/scripts/seed-gia-von.ts
 *
 * Chỉ import sản phẩm đã có product_id trong Medusa.
 * Phụ kiện (vỏ hộp, carton...) bỏ qua.
 */

import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Map tên sản phẩm GG Sheet → product_id Medusa
const PRODUCT_MAP: Record<string, { id: string; title: string }> = {
  "bộ lau nhà tách nước":          { id: "prod_01KPAQ9HVTD38S7T36Y10Q5QAJ", title: "Bộ Lau Nhà Tách Nước" },
  "bộ lau nhà xốp":                { id: "prod_01KPAQ9GX4RJSB6V3PSKCW7KS2", title: "Bộ Lau Nhà Xốp" },
  "cây lau nhà tự vắt phun sương":  { id: "prod_01KPAQ9BBMAMWER62WC086972W", title: "Cây Lau Tự Vắt Mini" },
  "cây lau mini kèm gạt nước":     { id: "prod_01KPAQ9BBMAMWER62WC086972W", title: "Cây Lau Tự Vắt Mini" },
  "cây lau nhà phun sương":        { id: "prod_01KPAQ9BBMAMWER62WC086972W", title: "Cây Lau Tự Vắt Mini" },
  "bộ cây lau nhà xanh":           { id: "prod_01KPAQ9755QRQASVKT2RRWNXSE", title: "Bộ Cây Lau Nhà Xanh" },
  "chảo nấu ăn kèm khay hấp":     { id: "prod_01KPAQ9EVNFSATRZMBJH532391", title: "Chảo Nấu Kèm Xửng Hấp" },
  "chảo nướng vân đá":             { id: "prod_01KPAQ9C9B7J7N5FM5Q2AWTC8F", title: "Bộ Chảo Nướng Đá" },
  "hộp nhựa nhiều ngăn (lớn)":    { id: "prod_01KPAQ9D5SXC4Z7DJHE369ZX2M", title: "Hộp Nhựa Nhiều Ngăn" },
  "hộp nhựa nhiều ngăn (nhỏ)":    { id: "prod_01KPAQ9D5SXC4Z7DJHE369ZX2M", title: "Hộp Nhựa Nhiều Ngăn" },
  "tay vịn cạnh giường":           { id: "prod_01KPAQ9FHDG4E11PEJHAHE31H6", title: "Thanh Chắn Giường" },
  "dụng cụ bào đa năng":           { id: "prod_01KPAQ9KD6DTJ63B297CCT804E", title: "Máy Bào Đa Năng" },
  "rổ nạo rau củ đa năng":         { id: "prod_01KPAQ9G6Z38SP67XPMSQTTQGE", title: "Rổ Nạo Đa Năng" },
  "tấm dẫn nhiệt bếp gas":         { id: "prod_01KPAQ9JHNRZBKCFR2HSTVS206", title: "Tấm Dẫn Nhiệt Bếp Gas" },
  "hộp cơm giữ nhiệt":             { id: "prod_01KPAQ9AFJ66Z2TCXX616Y433X", title: "Hộp Đựng Cơm Giữ Nhiệt" },
  "giỏ đựng quần áo đa năng":      { id: "prod_01KPAQ9E01DKRB6GG63VWMYHWX", title: "Giỏ Quần Áo" },
  "balo chạy bộ":                  { id: "prod_01KPAQ98P1EX5EC8Z0TE4P3V9G", title: "Balo Chạy Bộ" },
  "gậy chống cho người già":        { id: "prod_01KPAQ93W084V4TG6NRXQAM3JW", title: "Gậy Chống Cho Người Già" },
  "kệ để đồ":                      { id: "prod_01KPAQ94RSKY1ZZ8KTDZF36FN6", title: "Kệ Để Đồ Hai Tầng" },
  "nồi áp suất":                   { id: "prod_01KPAQ97TKNZVQG173P18TH40S", title: "Nồi Áp Suất" },
  "nồi áp suất đa năng":           { id: "prod_01KPAQ96A4NJC5YCEM0HKF0KR0", title: "Nồi Áp Suất Đa Năng" },
  "nồi áp suất đen":               { id: "prod_01KPAQ97TKNZVQG173P18TH40S", title: "Nồi Áp Suất" },
  "nồi áp suất trắng":             { id: "prod_01KPAQ97TKNZVQG173P18TH40S", title: "Nồi Áp Suất" },
  "nồi áp suất cam":               { id: "prod_01KPAQ97TKNZVQG173P18TH40S", title: "Nồi Áp Suất" },
  "nồi chiên inox 304":            { id: "prod_01KPAQ92Z5M14GY2E8WXXMC5QP", title: "Nồi Chiên Inox 304" },
  "nồi chống dính tráng men sứ":   { id: "prod_01KPAQ95MCTC02JMWWMR5EDE7X", title: "Nồi Chống Dính Tráng Men Sứ" },
  "nồi áp suất đa năng (đen)":     { id: "prod_01KPAQ96A4NJC5YCEM0HKF0KR0", title: "Nồi Áp Suất Đa Năng" },
  "mút xốp cây lau nhà bọt xốp":  { id: "prod_01KPAQ9GX4RJSB6V3PSKCW7KS2", title: "Bộ Lau Nhà Xốp" },
  "bộ lau nhà tự vắt bọt xốp":    { id: "prod_01KPAQ9GX4RJSB6V3PSKCW7KS2", title: "Bộ Lau Nhà Xốp" },
  "chảo gang đúc nguyên khối":     { id: "prod_01KPAQ9EVNFSATRZMBJH532391", title: "Chảo Nấu Kèm Xửng Hấp" },
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[đ]/g, "d")
}

function lookupProduct(rawTitle: string): { id: string; title: string } | null {
  const norm = rawTitle.toLowerCase().trim()
  // exact match
  for (const [key, val] of Object.entries(PRODUCT_MAP)) {
    if (norm === key) return val
  }
  // partial match
  for (const [key, val] of Object.entries(PRODUCT_MAP)) {
    if (norm.includes(key) || key.includes(norm)) return val
  }
  return null
}

function parseDate(s: string): string | null {
  if (!s || s.trim() === "" || s.startsWith("-")) return null
  // format dd/mm/yyyy hoặc dd/mm/yy
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const d = m[1].padStart(2, "0")
    const mo = m[2].padStart(2, "0")
    let yr = m[3]
    if (yr.length === 2) yr = "20" + yr
    return `${yr}-${mo}-${d}`
  }
  // format yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim()
  return null
}

function parseNum(s: string | number | undefined): number {
  if (s === undefined || s === null || s === "") return 0
  return parseFloat(String(s).replace(/[^0-9.-]/g, "")) || 0
}

// ---- DATA từ Google Sheet ----
// Columns: product_title, qty, price_unit, local_fee_tq, amount_vnd, ship_fee_ovs, local_fee_vn, vat_fee, final_price, lot_date, received_date, source, note, status

interface RawRow {
  title: string
  qty: number
  price_unit: number
  local_fee_tq: number
  ship_fee_ovs: number
  local_fee_vn: number
  vat_fee: number
  other_fee: number
  final_price: number
  lot_date: string
  received_date: string
  source: string
  status: string
  note: string
}

const RAW_DATA: RawRow[] = [
  // Bộ lau nhà tách nước - row 14
  { title: "Bộ lau nhà tách nước", qty: 304, price_unit: 115700, local_fee_tq: 0, ship_fee_ovs: 10901343, local_fee_vn: 500000, vat_fee: 2431343, other_fee: 40494252, final_price: 169064, lot_date: "10/03/2025", received_date: "26/03/2025", source: "TQ", status: "received", note: "Xuất VAT về cá nhân anh Hoàn: 95k/pcs" },
  // Bộ lau nhà tách nước - row 17
  { title: "Bộ lau nhà tách nước", qty: 120, price_unit: 160000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 1600000, final_price: 173333, lot_date: "15/03/2025", received_date: "16/03/2025", source: "Việt Nam", status: "received", note: "" },
  // Bộ lau nhà tách nước - row 19
  { title: "Bộ lau nhà tách nước", qty: 120, price_unit: 160000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 850000, final_price: 167083, lot_date: "19/03/2025", received_date: "20/03/2025", source: "Việt Nam", status: "received", note: "" },
  // Bộ lau nhà tách nước - row 27 (TQ lớn)
  { title: "Bộ lau nhà tách nước", qty: 504, price_unit: 0, local_fee_tq: 0, ship_fee_ovs: 25200000, local_fee_vn: 0, vat_fee: 0, other_fee: 85402403, final_price: 219449, lot_date: "28/03/2025", received_date: "15/04/2025", source: "TQ", status: "received", note: "không xuất VAT, đi tiểu ngạch" },
  // Bộ lau nhà tách nước - row 37 (TQ)
  { title: "Bộ lau nhà tách nước", qty: 504, price_unit: 0, local_fee_tq: 0, ship_fee_ovs: 21532500, local_fee_vn: 0, vat_fee: 0, other_fee: 89574565, final_price: 220451, lot_date: "19/04/2025", received_date: "07/05/2025", source: "TQ", status: "received", note: "đi tiểu ngạch" },
  // Bộ lau nhà tách nước - row 43 (TQ)
  { title: "Bộ lau nhà tách nước", qty: 504, price_unit: 0, local_fee_tq: 0, ship_fee_ovs: 20790000, local_fee_vn: 0, vat_fee: 0, other_fee: 96085116, final_price: 231895, lot_date: "06/05/2025", received_date: "21/06/2025", source: "TQ", status: "received", note: "Xuất VAT 102k, Vỏ hộp Vietmate" },
  // Bộ lau nhà tách nước - row 55
  { title: "Bộ lau nhà tách nước", qty: 96, price_unit: 259000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 445600, final_price: 263642, lot_date: "10/06/2025", received_date: "10/06/2025", source: "Việt Nam", status: "received", note: "cũ" },
  // Bộ lau nhà tách nước - row 56
  { title: "Bộ lau nhà tách nước", qty: 96, price_unit: 259000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 429344, final_price: 263472, lot_date: "11/06/2025", received_date: "11/06/2025", source: "Việt Nam", status: "received", note: "cũ" },
  // Bộ lau nhà tách nước - row 61 (Việt Nam)
  { title: "Bộ lau nhà tách nước", qty: 150, price_unit: 259000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 509144, final_price: 262394, lot_date: "14/06/2025", received_date: "14/06/2025", source: "Việt Nam", status: "received", note: "cũ" },
  // Bộ lau nhà tách nước - row 62 (Việt Nam)
  { title: "Bộ lau nhà tách nước", qty: 96, price_unit: 264000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 397040, final_price: 268136, lot_date: "19/06/2025", received_date: "19/06/2025", source: "Việt Nam", status: "received", note: "cũ" },
  // Bộ lau nhà tách nước - row 44 (TQ lớn)
  { title: "Bộ lau nhà tách nước", qty: 504, price_unit: 0, local_fee_tq: 6019800, ship_fee_ovs: 20305600, local_fee_vn: 350000, vat_fee: 0, other_fee: 96711200, final_price: 244815, lot_date: "10/06/2025", received_date: "07/07/2025", source: "TQ", status: "received", note: "Vỏ hộp Vietmate" },
  // Bộ lau nhà tách nước - row 74 (TQ lớn)
  { title: "Bộ lau nhà tách nước", qty: 750, price_unit: 171120, local_fee_tq: 11239882, ship_fee_ovs: 47164786, local_fee_vn: 35924904, vat_fee: 0, other_fee: 14880000, final_price: 253846, lot_date: "07/08/2025", received_date: "22/09/2025", source: "TQ", status: "received", note: "1 thùng vắt, 1 chổi, 3 bông lau" },

  // BỘ LAU NHÀ TỰ VẮT BỌT XỐP
  { title: "Bộ lau nhà xốp", qty: 135, price_unit: 41500, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 0, final_price: 41500, lot_date: "16/05/2025", received_date: "16/05/2025", source: "Việt Nam", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 90, price_unit: 35500, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 140000, final_price: 37056, lot_date: "14/05/2025", received_date: "14/05/2025", source: "Việt Nam", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 612, price_unit: 76860, local_fee_tq: 3314592, ship_fee_ovs: 9466928, local_fee_vn: 0, vat_fee: 0, other_fee: 4392000, final_price: 104921, lot_date: "19/05/2025", received_date: "27/06/2025", source: "TQ", status: "received", note: "một chổi có 2 mút xốp" },
  { title: "Bộ lau nhà xốp", qty: 600, price_unit: 75212, local_fee_tq: 3249600, ship_fee_ovs: 8406400, local_fee_vn: 0, vat_fee: 0, other_fee: 4392000, final_price: 101958, lot_date: "07/07/2025", received_date: "01/08/2025", source: "TQ", status: "received", note: "một chổi có 2 mút xốp" },
  { title: "Bộ lau nhà xốp", qty: 800, price_unit: 75110, local_fee_tq: 5965680, ship_fee_ovs: 15263680, local_fee_vn: 8748000, vat_fee: 0, other_fee: 5735000, final_price: 101358, lot_date: "12/08/2025", received_date: "11/09/2025", source: "TQ", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 800, price_unit: 76125, local_fee_tq: 6016000, ship_fee_ovs: 15221000, local_fee_vn: 8705000, vat_fee: 0, other_fee: 5812500, final_price: 102417, lot_date: "20/09/2025", received_date: "09/10/2025", source: "TQ", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 800, price_unit: 76328, local_fee_tq: 5976704, ship_fee_ovs: 14426704, local_fee_vn: 7900000, vat_fee: 0, other_fee: 5828000, final_price: 101646, lot_date: "22/09/2025", received_date: "27/10/2025", source: "TQ", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 1200, price_unit: 77546, local_fee_tq: 8961504, ship_fee_ovs: 21461504, local_fee_vn: 12000000, vat_fee: 0, other_fee: 8460000, final_price: 102481, lot_date: "23/10/2025", received_date: "27/11/2025", source: "TQ", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 1500, price_unit: 79373, local_fee_tq: 11703080, ship_fee_ovs: 29157080, local_fee_vn: 17454000, vat_fee: 0, other_fee: 9775000, final_price: 105328, lot_date: "01/12/2025", received_date: "19/12/2025", source: "TQ", status: "received", note: "" },
  { title: "Bộ lau nhà xốp", qty: 1000, price_unit: 79373, local_fee_tq: 7771326, ship_fee_ovs: 19283906, local_fee_vn: 11512580, vat_fee: 0, other_fee: 6256000, final_price: 104913, lot_date: "05/02/2026", received_date: "11/03/2026", source: "TQ", status: "received", note: "" },

  // MÚT XỐP (dùng id bộ lau xốp)
  { title: "Bộ lau nhà xốp (Mút xốp)", qty: 400, price_unit: 21228, local_fee_tq: 1500000, ship_fee_ovs: 855000, local_fee_vn: 0, vat_fee: 0, other_fee: 457500, final_price: 24509, lot_date: "19/05/2025", received_date: "25/06/2025", source: "TQ", status: "received", note: "Mút xốp phụ kiện" },
  { title: "Bộ lau nhà xốp (Mút xốp)", qty: 200, price_unit: 20055, local_fee_tq: 1000000, ship_fee_ovs: 690000, local_fee_vn: 0, vat_fee: 0, other_fee: 0, final_price: 23505, lot_date: "23/10/2025", received_date: "27/11/2025", source: "TQ", status: "received", note: "" },
  { title: "Bộ lau nhà xốp (Mút xốp)", qty: 400, price_unit: 20528, local_fee_tq: 781349, ship_fee_ovs: 1564338, local_fee_vn: 773860, vat_fee: 0, other_fee: 782000, final_price: 26393, lot_date: "05/02/2026", received_date: "11/03/2026", source: "TQ", status: "received", note: "" },

  // CÂY LAU NHÀ TỰ VẮT PHUN SƯƠNG
  { title: "Cây Lau Tự Vắt Mini", qty: 120, price_unit: 92820, local_fee_tq: 2000000, ship_fee_ovs: 2460000, local_fee_vn: 200000, vat_fee: 0, other_fee: 1099560, final_price: 128416, lot_date: "11/04/2025", received_date: "26/04/2025", source: "TQ", status: "received", note: "" },
  { title: "Cây Lau Tự Vắt Mini", qty: 500, price_unit: 0, local_fee_tq: 1000000, ship_fee_ovs: 9894000, local_fee_vn: 450000, vat_fee: 3600000, other_fee: 48544200, final_price: 126227, lot_date: "07/05/2025", received_date: "22/05/2025", source: "TQ", status: "received", note: "" },
  { title: "Cây Lau Tự Vắt Mini", qty: 300, price_unit: 0, local_fee_tq: 1000000, ship_fee_ovs: 6294000, local_fee_vn: 450000, vat_fee: 0, other_fee: 29133600, final_price: 118092, lot_date: "25/05/2025", received_date: "17/06/2025", source: "TQ", status: "received", note: "chưa nhập tồn" },
  { title: "Cây Lau Tự Vắt Mini", qty: 140, price_unit: 37000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 180000, final_price: 38286, lot_date: "30/05/2025", received_date: "02/06/2025", source: "Việt Nam", status: "received", note: "" },

  // CÂY LAU MINI KÈM GẠT NƯỚC
  { title: "Cây Lau Tự Vắt Mini", qty: 100, price_unit: 39000, local_fee_tq: 0, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 0, final_price: 39000, lot_date: "14/05/2025", received_date: "14/05/2025", source: "Việt Nam", status: "received", note: "Một chổi 3 giẻ" },

  // BỘ CÂY LAU NHÀ XANH
  { title: "Bộ Cây Lau Nhà Xanh", qty: 500, price_unit: 82110, local_fee_tq: 4479998, ship_fee_ovs: 12531959, local_fee_vn: 8051961, vat_fee: 0, other_fee: 4222800, final_price: 115620, lot_date: "22/01/2026", received_date: "11/02/2026", source: "TQ", status: "received", note: "" },
  { title: "Bộ Cây Lau Nhà Xanh", qty: 500, price_unit: 84000, local_fee_tq: 4314912, ship_fee_ovs: 11987459, local_fee_vn: 7616400, vat_fee: 0, other_fee: 4320000, final_price: 116615, lot_date: "08/04/2026", received_date: "29/04/2026", source: "TQ", status: "received", note: "" },

  // CHẢO NẤU KÈM XỬNG HẤP
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 300, price_unit: 161920, local_fee_tq: 2661945, ship_fee_ovs: 13529911, local_fee_vn: 500000, vat_fee: 0, other_fee: 2870400, final_price: 216588, lot_date: "01/07/2025", received_date: "11/07/2025", source: "TQ", status: "received", note: "" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 500, price_unit: 161211, local_fee_tq: 1100000, ship_fee_ovs: 17857438, local_fee_vn: 0, vat_fee: 0, other_fee: 3855280, final_price: 206098, lot_date: "20/07/2025", received_date: "08/08/2025", source: "TQ", status: "received", note: "" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 500, price_unit: 163995, local_fee_tq: 6873464, ship_fee_ovs: 17393114, local_fee_vn: 10519650, vat_fee: 0, other_fee: 3920800, final_price: 206623, lot_date: "06/09/2025", received_date: "27/09/2025", source: "TQ", status: "received", note: "" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 157920, local_fee_tq: 14560000, ship_fee_ovs: 30440000, local_fee_vn: 15880000, vat_fee: 0, other_fee: 7520000, final_price: 195880, lot_date: "29/09/2025", received_date: "20/10/2025", source: "TQ", status: "received", note: "" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 160440, local_fee_tq: 15082078, ship_fee_ovs: 33356852, local_fee_vn: 18274774, vat_fee: 0, other_fee: 7640000, final_price: 201437, lot_date: "27/10/2025", received_date: "18/11/2025", source: "TQ", status: "received", note: "" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 164220, local_fee_tq: 16418796, ship_fee_ovs: 47658746, local_fee_vn: 31239950, vat_fee: 0, other_fee: 9775000, final_price: 221654, lot_date: "01/12/2025", received_date: "23/12/2025", source: "TQ", status: "received", note: "Chảo sắt" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 200, price_unit: 297160, local_fee_tq: 5432070, ship_fee_ovs: 11945940, local_fee_vn: 6513870, vat_fee: 0, other_fee: 1955000, final_price: 366665, lot_date: "04/12/2025", received_date: "23/12/2025", source: "TQ", status: "received", note: "Chảo nhôm" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 301852, local_fee_tq: 27407054, ship_fee_ovs: 57977234, local_fee_vn: 30570180, vat_fee: 0, other_fee: 10166000, final_price: 369995, lot_date: "25/12/2025", received_date: "19/01/2026", source: "TQ", status: "received", note: "Chảo nhôm" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 171258, local_fee_tq: 17019880, ship_fee_ovs: 49329715, local_fee_vn: 31715495, vat_fee: 0, other_fee: 9775000, final_price: 230363, lot_date: "12/01/2026", received_date: "27/01/2026", source: "TQ", status: "received", note: "Chảo sắt" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 500, price_unit: 297160, local_fee_tq: 13579825, ship_fee_ovs: 29273635, local_fee_vn: 15693810, vat_fee: 0, other_fee: 5474000, final_price: 366655, lot_date: "23/01/2026", received_date: "08/02/2026", source: "TQ", status: "received", note: "Chảo nhôm" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 301852, local_fee_tq: 27200016, ship_fee_ovs: 58537633, local_fee_vn: 31337617, vat_fee: 0, other_fee: 11026200, final_price: 371416, lot_date: "29/01/2026", received_date: "07/03/2026", source: "TQ", status: "received", note: "Chảo nhôm, thiếu 6 cái" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 1000, price_unit: 172134, local_fee_tq: 17158678, ship_fee_ovs: 48504148, local_fee_vn: 31345470, vat_fee: 0, other_fee: 11004000, final_price: 231642, lot_date: "02/03/2026", received_date: "28/03/2026", source: "TQ", status: "received", note: "Chảo sắt" },
  { title: "Chảo Nấu Kèm Xửng Hấp", qty: 2000, price_unit: 310344, local_fee_tq: 56059233, ship_fee_ovs: 111692554, local_fee_vn: 57379608, vat_fee: 0, other_fee: 22672800, final_price: 377527, lot_date: "11/03/2026", received_date: "14/04/2026", source: "TQ", status: "received", note: "Chảo nhôm" },

  // HỘP NHỰA NHIỀU NGĂN
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 200, price_unit: 197212, local_fee_tq: 3155392, ship_fee_ovs: 5438133, local_fee_vn: 0, vat_fee: 0, other_fee: 0, final_price: 240180, lot_date: "20/07/2025", received_date: "26/08/2025", source: "TQ", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 500, price_unit: 189720, local_fee_tq: 8580800, ship_fee_ovs: 20980800, local_fee_vn: 12400000, vat_fee: 0, other_fee: 0, final_price: 231682, lot_date: "04/09/2025", received_date: "20/09/2025", source: "TQ", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 200, price_unit: 236111, local_fee_tq: 3777776, ship_fee_ovs: 0, local_fee_vn: 0, vat_fee: 0, other_fee: 0, final_price: 255000, lot_date: "09/09/2025", received_date: "09/09/2025", source: "Việt Nam", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 504, price_unit: 171900, local_fee_tq: 6640232, ship_fee_ovs: 24137232, local_fee_vn: 17497000, vat_fee: 0, other_fee: 0, final_price: 219791, lot_date: "28/10/2025", received_date: "26/11/2025", source: "TQ", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 504, price_unit: 168750, local_fee_tq: 8668800, ship_fee_ovs: 23438800, local_fee_vn: 14770000, vat_fee: 0, other_fee: 0, final_price: 215256, lot_date: "24/09/2025", received_date: "13/10/2025", source: "TQ", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 46, price_unit: 175950, local_fee_tq: 605752, ship_fee_ovs: 4448252, local_fee_vn: 3842500, vat_fee: 0, other_fee: 0, final_price: 272651, lot_date: "02/12/2025", received_date: "10/01/2026", source: "TQ", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 500, price_unit: 168750, local_fee_tq: 8580800, ship_fee_ovs: 20980800, local_fee_vn: 12400000, vat_fee: 0, other_fee: 0, final_price: 231682, lot_date: "04/09/2025", received_date: "20/09/2025", source: "TQ", status: "received", note: "row 83" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 504, price_unit: 180900, local_fee_tq: 6881600, ship_fee_ovs: 25579200, local_fee_vn: 18697600, vat_fee: 0, other_fee: 0, final_price: 231652, lot_date: "13/03/2026", received_date: "04/04/2026", source: "TQ", status: "received", note: "" },
  { title: "Hộp Nhựa Nhiều Ngăn (lớn)", qty: 504, price_unit: 180000, local_fee_tq: 6881600, ship_fee_ovs: 25579200, local_fee_vn: 18697600, vat_fee: 0, other_fee: 0, final_price: 230752, lot_date: "15/05/2026", received_date: "", source: "TQ", status: "pending", note: "NCC chuẩn bị hàng" },

  // THÁNH CHẮN GIƯỜNG (tay vịn)
  { title: "Thanh Chắn Giường", qty: 300, price_unit: 164700, local_fee_tq: 2571678, ship_fee_ovs: 12061170, local_fee_vn: 0, vat_fee: 0, other_fee: 1098000, final_price: 208564, lot_date: "19/06/2025", received_date: "09/07/2025", source: "TQ", status: "received", note: "" },
  { title: "Thanh Chắn Giường", qty: 600, price_unit: 166815, local_fee_tq: 8056282, ship_fee_ovs: 23596050, local_fee_vn: 15539768, vat_fee: 0, other_fee: 0, final_price: 206142, lot_date: "20/07/2025", received_date: "09/08/2025", source: "TQ", status: "received", note: "" },
  { title: "Thanh Chắn Giường", qty: 500, price_unit: 171450, local_fee_tq: 7440000, ship_fee_ovs: 18670000, local_fee_vn: 7680000, vat_fee: 0, other_fee: 0, final_price: 208790, lot_date: "11/10/2025", received_date: "06/11/2025", source: "TQ", status: "received", note: "" },

  // DỤng CỤ BÀO ĐA NĂNG
  { title: "Máy Bào Đa Năng", qty: 96, price_unit: 157380, local_fee_tq: 837120, ship_fee_ovs: 2100285, local_fee_vn: 0, vat_fee: 21215, other_fee: 0, final_price: 187978, lot_date: "01/06/2025", received_date: "27/06/2025", source: "TQ", status: "received", note: "" },
  { title: "Máy Bào Đa Năng", qty: 608, price_unit: 149511, local_fee_tq: 8970535, ship_fee_ovs: 10227000, local_fee_vn: 0, vat_fee: 1100000, other_fee: 0, final_price: 166332, lot_date: "04/07/2025", received_date: "24/07/2025", source: "TQ", status: "received", note: "" },

  // RỔ NẠO ĐA NĂNG
  { title: "Rổ Nạo Đa Năng", qty: 96, price_unit: 164700, local_fee_tq: 835200, ship_fee_ovs: 3415615, local_fee_vn: 0, vat_fee: 21215, other_fee: 0, final_price: 208979, lot_date: "01/06/2025", received_date: "27/06/2025", source: "TQ", status: "received", note: "" },
  { title: "Rổ Nạo Đa Năng", qty: 400, price_unit: 156465, local_fee_tq: 6175489, ship_fee_ovs: 11107000, local_fee_vn: 0, vat_fee: 1100000, other_fee: 0, final_price: 184233, lot_date: "04/07/2025", received_date: "24/07/2025", source: "TQ", status: "received", note: "" },

  // TẤM DẪN NHIỆT BẾP GAS
  { title: "Tấm Dẫn Nhiệt Bếp Gas", qty: 400, price_unit: 87822, local_fee_tq: 0, ship_fee_ovs: 6054310, local_fee_vn: 250000, vat_fee: 32726, other_fee: 811800, final_price: 105612, lot_date: "01/07/2025", received_date: "13/07/2025", source: "TQ", status: "received", note: "" },

  // HỘP CƠM GIỮ NHIỆT
  { title: "Hộp Đựng Cơm Giữ Nhiệt", qty: 200, price_unit: 255940, local_fee_tq: 4736000, ship_fee_ovs: 6486000, local_fee_vn: 1500000, vat_fee: 0, other_fee: 1168920, final_price: 294215, lot_date: "31/10/2025", received_date: "24/11/2025", source: "TQ", status: "received", note: "" },

  // GIỎ QUẦN ÁO
  { title: "Giỏ Quần Áo", qty: 504, price_unit: 107880, local_fee_tq: 5141722, ship_fee_ovs: 15591722, local_fee_vn: 9900000, vat_fee: 0, other_fee: 0, final_price: 138816, lot_date: "04/09/2025", received_date: "25/09/2025", source: "TQ", status: "received", note: "" },
  { title: "Giỏ Quần Áo", qty: 301, price_unit: 113390, local_fee_tq: 3257040, ship_fee_ovs: 9839648, local_fee_vn: 6582608, vat_fee: 0, other_fee: 0, final_price: 146080, lot_date: "13/12/2025", received_date: "08/01/2026", source: "TQ", status: "received", note: "" },

  // BALO CHẠY BỘ
  { title: "Balo Chạy Bộ", qty: 200, price_unit: 89930, local_fee_tq: 1488058, ship_fee_ovs: 2158989, local_fee_vn: 670931, vat_fee: 8000, other_fee: 234600, final_price: 101898, lot_date: "13/12/2025", received_date: "27/12/2025", source: "TQ", status: "received", note: "" },
  { title: "Balo Chạy Bộ", qty: 300, price_unit: 89930, local_fee_tq: 2258683, ship_fee_ovs: 3240906, local_fee_vn: 910462, vat_fee: 8000, other_fee: 344080, final_price: 101880, lot_date: "05/01/2026", received_date: "19/01/2026", source: "TQ", status: "received", note: "" },
  { title: "Balo Chạy Bộ", qty: 200, price_unit: 92460, local_fee_tq: 1557654, ship_fee_ovs: 2280541, local_fee_vn: 624915, vat_fee: 8000, other_fee: 353760, final_price: 105632, lot_date: "20/03/2026", received_date: "20/04/2026", source: "TQ", status: "received", note: "" },

  // GẬY CHỐNG CHO NGƯỜI GIÀ
  { title: "Gậy Chống Cho Người Già", qty: 300, price_unit: 170955, local_fee_tq: 4605391, ship_fee_ovs: 8528281, local_fee_vn: 3922890, vat_fee: 0, other_fee: 2358000, final_price: 207243, lot_date: "10/03/2026", received_date: "01/04/2026", source: "TQ", status: "received", note: "" },

  // KỆ ĐỂ ĐỒ
  { title: "Kệ Để Đồ Hai Tầng", qty: 500, price_unit: 143445, local_fee_tq: 6770156, ship_fee_ovs: 19674606, local_fee_vn: 12904450, vat_fee: 0, other_fee: 0, final_price: 182794, lot_date: "04/03/2026", received_date: "31/03/2026", source: "TQ", status: "received", note: "" },

  // NỒI ÁP SUẤT
  { title: "Nồi Áp Suất", qty: 304, price_unit: 113390, local_fee_tq: 3530052, ship_fee_ovs: 10365850, local_fee_vn: 6835798, vat_fee: 0, other_fee: 2971600, final_price: 157263, lot_date: "12/01/2026", received_date: "26/01/2026", source: "TQ", status: "received", note: "" },
  { title: "Nồi Áp Suất", qty: 400, price_unit: 116000, local_fee_tq: 4687328, ship_fee_ovs: 12698928, local_fee_vn: 8011600, vat_fee: 0, other_fee: 4180000, final_price: 158197, lot_date: "07/04/2026", received_date: "22/04/2026", source: "TQ", status: "received", note: "đen" },
  { title: "Nồi Áp Suất", qty: 200, price_unit: 116000, local_fee_tq: 2343664, ship_fee_ovs: 6349464, local_fee_vn: 4005800, vat_fee: 0, other_fee: 2090000, final_price: 158197, lot_date: "07/04/2026", received_date: "22/04/2026", source: "TQ", status: "received", note: "trắng" },
  { title: "Nồi Áp Suất", qty: 200, price_unit: 116000, local_fee_tq: 2343664, ship_fee_ovs: 6349464, local_fee_vn: 4005800, vat_fee: 0, other_fee: 2090000, final_price: 158197, lot_date: "07/04/2026", received_date: "22/04/2026", source: "TQ", status: "received", note: "cam" },
  { title: "Nồi Áp Suất", qty: 200, price_unit: 113970, local_fee_tq: 2301463, ship_fee_ovs: 6259665, local_fee_vn: 3958202, vat_fee: 0, other_fee: 2016090, final_price: 155349, lot_date: "11/03/2026", received_date: "24/03/2026", source: "TQ", status: "received", note: "đen" },
  { title: "Nồi Áp Suất", qty: 352, price_unit: 113970, local_fee_tq: 4053564, ship_fee_ovs: 11056889, local_fee_vn: 7003325, vat_fee: 0, other_fee: 3548790, final_price: 155463, lot_date: "11/03/2026", received_date: "24/03/2026", source: "TQ", status: "received", note: "trắng" },
  { title: "Nồi Áp Suất", qty: 56, price_unit: 113970, local_fee_tq: 646016, ship_fee_ovs: 1772981, local_fee_vn: 1126965, vat_fee: 0, other_fee: 565920, final_price: 155736, lot_date: "11/03/2026", received_date: "24/03/2026", source: "TQ", status: "received", note: "cam" },

  // NỒI ÁP SUẤT ĐA NĂNG
  { title: "Nồi Áp Suất Đa Năng", qty: 300, price_unit: 93840, local_fee_tq: 2673488, ship_fee_ovs: 8269810, local_fee_vn: 5488600, vat_fee: 0, other_fee: 2541500, final_price: 129878, lot_date: "28/02/2026", received_date: "17/03/2026", source: "TQ", status: "received", note: "" },

  // NỒI CHIÊN INOX 304
  { title: "Nồi Chiên Inox 304", qty: 300, price_unit: 146730, local_fee_tq: 3995170, ship_fee_ovs: 7503790, local_fee_vn: 3508620, vat_fee: 0, other_fee: 2412000, final_price: 179783, lot_date: "16/03/2026", received_date: "07/04/2026", source: "TQ", status: "received", note: "" },
  { title: "Nồi Chiên Inox 304", qty: 600, price_unit: 146000, local_fee_tq: 7853088, ship_fee_ovs: 14420028, local_fee_vn: 6483600, vat_fee: 0, other_fee: 4080000, final_price: 176833, lot_date: "08/04/2026", received_date: "25/04/2026", source: "TQ", status: "received", note: "" },

  // NỒI CHỐNG DÍNH TRÁNG MEN SỨ
  { title: "Nồi Chống Dính Tráng Men Sứ", qty: 304, price_unit: 86020, local_fee_tq: 2973633, ship_fee_ovs: 11452465, local_fee_vn: 8478832, vat_fee: 0, other_fee: 2541500, final_price: 132053, lot_date: "28/02/2026", received_date: "21/03/2026", source: "TQ", status: "received", note: "" },
]

function toISODate(d: string): string | null {
  if (!d) return null
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const day = m[1].padStart(2, "0")
    const mo = m[2].padStart(2, "0")
    let yr = m[3]
    if (yr.length === 2) yr = "20" + yr
    return `${yr}-${mo}-${day}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  return null
}

export default async function seedGiaVon() {
  console.log(`[seed-gia-von] Bắt đầu import ${RAW_DATA.length} lô hàng...`)

  let inserted = 0
  let skipped = 0

  for (const row of RAW_DATA) {
    const normTitle = row.title.toLowerCase().trim()
    let prod = lookupProduct(normTitle)

    // Fallback: match "hộp nhựa nhiều ngăn" chung
    if (!prod && normTitle.includes("hộp nhựa")) {
      prod = { id: "prod_01KPAQ9D5SXC4Z7DJHE369ZX2M", title: "Hộp Nhựa Nhiều Ngăn" }
    }

    if (!prod) {
      console.log(`  [skip] Không tìm thấy product: "${row.title}"`)
      skipped++
      continue
    }

    const lotDate = toISODate(row.lot_date)
    if (!lotDate) {
      console.log(`  [skip] Ngày GP không hợp lệ: "${row.lot_date}" (${row.title})`)
      skipped++
      continue
    }

    const receivedDate = toISODate(row.received_date) ?? null
    const qty = row.qty
    const amount = qty * row.price_unit
    const total = amount + row.local_fee_tq + row.ship_fee_ovs + row.local_fee_vn + row.vat_fee + row.other_fee
    const finalPrice = row.final_price > 0 ? row.final_price : (qty > 0 ? total / qty : 0)

    try {
      // Insert lot
      await pool.query(`
        INSERT INTO import_lot
          (id, product_id, product_title, lot_date, received_date, qty, price_unit, amount,
           local_fee_tq, ship_fee_ovs, local_fee_vn, vat_fee, other_fee, final_price,
           source, status, note, created_by, created_at, updated_at)
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())
      `, [
        prod.id, prod.title, lotDate, receivedDate,
        qty, row.price_unit, amount,
        row.local_fee_tq, row.ship_fee_ovs, row.local_fee_vn, row.vat_fee, row.other_fee,
        Math.round(finalPrice * 100) / 100,
        row.source, row.status, row.note, "seed-gia-von",
      ])

      // Upsert product_cost (bình quân gia quyền)
      await pool.query(`
        INSERT INTO product_cost (id, product_id, product_title, avg_cost, stock_qty, total_lots, last_imported_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, $5, now())
        ON CONFLICT (product_id) DO UPDATE SET
          product_title    = EXCLUDED.product_title,
          avg_cost         = ROUND(
            (product_cost.stock_qty * product_cost.avg_cost + $4 * $3) /
            NULLIF(product_cost.stock_qty + $4, 0)
          , 2),
          stock_qty        = product_cost.stock_qty + $4,
          total_lots       = product_cost.total_lots + 1,
          last_imported_at = GREATEST(COALESCE(product_cost.last_imported_at, $5), $5),
          updated_at       = now()
      `, [prod.id, prod.title, Math.round(finalPrice), qty, lotDate])

      console.log(`  [ok] ${prod.title} | ${lotDate} | qty=${qty} | final=${Math.round(finalPrice).toLocaleString()}đ`)
      inserted++
    } catch (err: any) {
      console.error(`  [error] ${row.title}: ${err.message}`)
      skipped++
    }
  }

  await pool.end()
  console.log(`\n[seed-gia-von] Xong: ${inserted} lô đã import, ${skipped} bỏ qua.`)
}
