import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /admin/dohana-sync/hang-hoan — đánh dấu hàng hoàn đã về kho theo MÃ VẬN ĐƠN.
 *
 * Dùng cho đơn tồn đọng: webhook chỉ bắt được video quay TỪ NAY, còn ~2.500 đơn đang kẹt
 * ở status 4 thì phải xử lý bằng danh sách mã lấy từ trang Dohana (Nhập hàng hoàn → Danh
 * sách video), hoặc từ đối soát với sàn.
 *
 * Body: { codes: string[], dry_run?: boolean }
 *
 * MẶC ĐỊNH DRY RUN — phải truyền dry_run:false mới thật sự ghi lên POS. Đây là thao tác
 * khó rút lại trên hệ thống thật nên không để lỡ tay.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as any
    const dryRun = body.dry_run !== false
    const codes: string[] = Array.isArray(body.codes)
      ? body.codes.map((c: any) => String(c ?? "").trim()).filter(Boolean).slice(0, 300)
      : []

    if (!codes.length) {
      return res.status(400).json({ error: "Thiếu danh sách codes (mã vận đơn)" })
    }

    const syncService = req.scope.resolve("dohanaSyncModule") as any
    const ketQua: any[] = []

    for (const ma of codes) {
      if (dryRun) {
        // Xem trước: chỉ tra đơn, không gọi PUT. Cho biết mã nào sẽ đổi, mã nào không.
        const r = await syncService.xemTruocHangHoan(ma)
        ketQua.push({ ma, ...r })
      } else {
        const r = await syncService.markReturnedByOrderCode(ma)
        ketQua.push({ ma, ...r })
      }
    }

    return res.json({
      dry_run: dryRun,
      tong: ketQua.length,
      se_doi: ketQua.filter(r => r.updated || r.se_doi).length,
      bo_qua: ketQua.filter(r => !r.updated && !r.se_doi).length,
      ket_qua: ketQua,
    })
  } catch (err: any) {
    console.error("[Dohana hang-hoan] Error:", err.message)
    return res.status(500).json({ error: err.message })
  }
}
