import { Pool } from "pg"

/**
 * Đẩy 1 lô nhập vừa tạo thành một dòng trong bảng dữ liệu giá vốn (cost_sheet_row).
 *
 * Lý do tồn tại: lô tạo từ task "Mua hàng" (Giao Việc) chỉ ghi vào `import_lot`,
 * còn tab "Bảng dữ liệu" + "Tổng kết giá TB" đọc `cost_sheet_row` — hai kho tách rời
 * nên mua hàng không thấy lô mới và phải gõ tay lại.
 *
 * Cách map cột giữ ĐÚNG quy ước của computeAvgCost() và SummaryTab: ưu tiên tên cột
 * ở dòng header (dòng position nhỏ nhất), fallback về vị trí cột A..K.
 *
 *   B(1) Sản phẩm   C(2) Tính chất   D(3) Số lượng   E(4) Đơn giá   F(5) Phí (gộp)
 *   G(6) VAT 8%     H(7) Phí khác    I(8) Tổng tiền  J(9) Giá TB/sp  K(10) Mã SP
 *
 * Không bao giờ ném lỗi ra ngoài: lô đã nằm trong import_lot rồi, việc thêm dòng
 * sheet chỉ là tiện ích — hỏng thì trả lý do để caller báo mềm, không rollback lô.
 */
// Một shape duy nhất thay vì discriminated union: tsconfig của backend không bật
// `strict` nên TS không narrow union theo `ok`, dùng union sẽ báo lỗi ở chỗ đọc `.reason`.
export type SheetAppendResult = {
  ok: boolean
  row_id?: string
  position?: number
  reason?: string
}

export async function appendLotToSheet(pool: Pool, lot: any): Promise<SheetAppendResult> {
  try {
    const { rows: columns } = await pool.query(
      `SELECT id, position FROM cost_sheet_column ORDER BY position ASC`
    )
    if (columns.length === 0) return { ok: false, reason: "Bảng dữ liệu chưa khởi tạo cột" }

    const posToId: Record<number, string> = {}
    for (const c of columns) posToId[c.position] = c.id

    // Dòng header = dòng đầu tiên theo position, giống computeAvgCost.
    const { rows: headerRows } = await pool.query(
      `SELECT data FROM cost_sheet_row ORDER BY position ASC LIMIT 1`
    )
    const headerToId: Record<string, string> = {}
    if (headerRows.length > 0) {
      for (const [colId, val] of Object.entries(headerRows[0].data ?? {})) {
        if (val) headerToId[String(val).trim()] = colId
      }
    }

    const col = (header: string, pos: number): string | undefined =>
      headerToId[header] ?? posToId[pos]

    const colSanPham = col("Sản phẩm", 1)
    const colTinhChat = col("Tính chất", 2)
    const colSoLuong = col("Số lượng", 3)
    const colDonGia = col("Đơn giá", 4)
    const colPhi = col("Phí", 5)
    const colVat = col("VAT", 6)
    const colPhiKhac = col("Phí khác", 7)
    const colTongTien = col("Tổng tiền", 8)
    const colGiaTb = col("Giá TB/sp", 9)
    const colMaSP = posToId[10]

    // 4 cột này là đầu vào bắt buộc của báo cáo giá TB — thiếu thì dòng vô nghĩa.
    if (!colSanPham || !colTinhChat || !colSoLuong || !colTongTien) {
      return { ok: false, reason: "Bảng dữ liệu thiếu cột bắt buộc (Sản phẩm/Tính chất/Số lượng/Tổng tiền)" }
    }

    const qty = Number(lot.qty ?? 0)
    const priceUnit = Number(lot.price_unit ?? 0)
    // F gộp phí nội địa TQ + ship quốc tế + nội địa VN; G là VAT; H là phí khác.
    // Cách gộp này khớp công thức sheet I = E*D + F + G + H.
    const phiGop =
      Number(lot.local_fee_tq ?? 0) + Number(lot.ship_fee_ovs ?? 0) + Number(lot.local_fee_vn ?? 0)
    const vat = Number(lot.vat_fee ?? 0)
    const phiKhac = Number(lot.other_fee ?? 0)
    const tongTien = Math.round(qty * priceUnit + phiGop + vat + phiKhac)
    const giaTb = qty > 0 ? Math.round(tongTien / qty) : 0

    const num = (n: number) => (n > 0 ? String(n) : "")
    const data: Record<string, string> = {
      [colSanPham]: String(lot.product_title ?? ""),
      // Lô nhập từ task luôn là hàng chính; phụ kiện mua hàng tự sửa lại trên sheet.
      [colTinhChat]: "Sản phẩm chính",
      [colSoLuong]: num(qty),
      [colTongTien]: num(tongTien),
    }
    if (colDonGia) data[colDonGia] = num(priceUnit)
    if (colPhi) data[colPhi] = num(phiGop)
    if (colVat) data[colVat] = num(vat)
    if (colPhiKhac) data[colPhiKhac] = num(phiKhac)
    if (colGiaTb) data[colGiaTb] = num(giaTb)
    // K giữ MÃ SP (mkt_product.code, vd PHVVN037_HDTP) — KHÔNG phải product_id (uuid).
    // Cột K là key gom nhóm của tab "Tổng kết giá TB" và là mã khớp sang báo cáo LNG:
    // ghi uuid vào đây làm mỗi lô nhập thành 1 nhóm riêng → cùng 1 SP hiện nhiều dòng,
    // và costs[code] bị ghi đè nên giá vốn = giá lô MỚI NHẤT thay vì bình quân gia quyền.
    // Tra theo id trước; id không khớp (SP xoá/chưa sync) thì fallback theo TÊN lô.
    // Bỏ trống cột K là tái diễn đúng bug: dòng đó thành nhóm riêng theo tên, tách khỏi
    // các lô cùng SP đã có mã → lại hiện 2 dòng trùng mã và giá vốn sai.
    if (colMaSP) {
      const { rows: [prod] } = await pool.query(
        `SELECT code FROM mkt_product
          WHERE (id = $1 OR upper(trim(name)) = upper(trim($2))) AND code <> ''
          ORDER BY (id = $1) DESC LIMIT 1`,
        [lot.product_id ?? null, String(lot.product_title ?? "")]
      )
      if (prod?.code) data[colMaSP] = String(prod.code).trim().toUpperCase()
      else console.warn(
        `[gia-von] Lô "${lot.product_title}" (product_id=${lot.product_id}) không tra được mã SP — cột K để trống, tab Tổng kết giá TB sẽ tách nhóm riêng.`
      )
    }

    const { rows: [{ maxpos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) as maxpos FROM cost_sheet_row`
    )
    const position = Number(maxpos) + 1

    const { rows: [row] } = await pool.query(
      `INSERT INTO cost_sheet_row (id, position, data, updated_at)
       VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id, position`,
      [position, JSON.stringify(data)]
    )
    return { ok: true, row_id: row.id, position: row.position }
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) }
  }
}
