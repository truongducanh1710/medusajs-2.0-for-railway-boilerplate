import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useCallback } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ---- Helpers ----
function fmtVND(n: number | string) {
  const num = typeof n === "string" ? parseFloat(n) : n
  if (!num || isNaN(num)) return "—"
  return new Intl.NumberFormat("vi-VN").format(Math.round(num)) + "đ"
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—"
  return s.slice(0, 10)
}
function num(v: any): number {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""))
  return isNaN(n) ? 0 : n
}
function calcRow(r: RowDraft) {
  const qty = num(r.qty)
  const price_unit = num(r.price_unit)
  const amount = qty * price_unit
  const total = amount + num(r.local_fee_tq) + num(r.ship_fee_ovs) + num(r.local_fee_vn) + num(r.vat_fee) + num(r.other_fee)
  const final_price = qty > 0 ? total / qty : 0
  return { amount, total, final_price }
}

// ---- Types ----
interface RowDraft {
  _id: string            // client-only key
  product_id: string
  product_title: string
  row_type: "main" | "accessory"   // chính | phụ kiện cho SP chính
  lot_date: string
  received_date: string
  qty: string
  price_unit: string
  local_fee_tq: string
  ship_fee_ovs: string
  local_fee_vn: string
  vat_fee: string
  other_fee: string
  source: string
  status: string
  note: string
  _saving?: boolean
  _saved?: boolean
  _error?: string
}

let _uid = 0
function newRow(): RowDraft {
  return {
    _id: String(++_uid),
    product_id: "", product_title: "",
    row_type: "main",
    lot_date: "", received_date: "",
    qty: "", price_unit: "",
    local_fee_tq: "0", ship_fee_ovs: "0", local_fee_vn: "0",
    vat_fee: "0", other_fee: "0",
    source: "TQ", status: "received", note: "",
  }
}

// ---- Product autocomplete cell ----
function ProdCell({ value, productId, isAccessory, onChange }: {
  value: string
  productId: string
  isAccessory?: boolean
  onChange: (id: string, title: string) => void
}) {
  const [q, setQ] = useState(value)
  const [hits, setHits] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const timer = useRef<any>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  // sync if parent changes
  useEffect(() => { if (value !== q) setQ(value) }, [value])

  function search(text: string) {
    setQ(text)
    clearTimeout(timer.current)
    if (text.length < 2) { setHits([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      try {
        const d = await apiJson(`/admin/products?q=${encodeURIComponent(text)}&limit=8`, "GET")
        setHits(d.products ?? [])
        if (d.products?.length > 0 && inputRef.current) {
          const rect = inputRef.current.getBoundingClientRect()
          setDropPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: Math.max(rect.width, 260) })
          setOpen(true)
        }
      } catch { setHits([]) }
    }, 250)
  }

  // Reset về tên đã chọn nếu blur mà không pick từ dropdown
  function handleBlur() {
    setTimeout(() => {
      if (!open) setQ(value)
    }, 200)
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 200 }}>
      <input
        ref={inputRef}
        value={q}
        onChange={e => search(e.target.value)}
        onFocus={() => { if (q.length >= 2) search(q) }}
        onBlur={handleBlur}
        placeholder={isAccessory ? "🔩 Chọn SP chính để gắn phụ kiện..." : "🔍 Tìm & chọn sản phẩm POS..."}
        style={{
          ...cellInput(),
          borderColor: productId ? (isAccessory ? "#f59e0b" : "#a78bfa") : "#e5e7eb",
          background: productId ? (isAccessory ? "#fffbeb" : "#faf5ff") : "#fff",
        }}
      />
      {productId && (
        <div style={{ fontSize: 9, color: isAccessory ? "#d97706" : "#7c3aed", lineHeight: 1, marginTop: 1, paddingLeft: 2 }}>
          {isAccessory ? "🔩" : "✓"} {productId.slice(-8)}
        </div>
      )}
      {open && hits.length > 0 && dropPos && (
        <div style={{
          position: "fixed", top: dropPos.top, left: dropPos.left, minWidth: dropPos.width,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.15)", zIndex: 9999, maxHeight: 300, overflowY: "auto",
          padding: "8px",
        }}>
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6, paddingLeft: 2 }}>Chọn sản phẩm</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {hits.map((p: any, i: number) => {
              const COLORS = [
                { bg: "#fde68a", text: "#92400e" }, // vàng
                { bg: "#bfdbfe", text: "#1e3a8a" }, // xanh dương
                { bg: "#bbf7d0", text: "#14532d" }, // xanh lá
                { bg: "#fecaca", text: "#7f1d1d" }, // đỏ
                { bg: "#e9d5ff", text: "#4c1d95" }, // tím
                { bg: "#fed7aa", text: "#7c2d12" }, // cam
                { bg: "#cffafe", text: "#164e63" }, // cyan
                { bg: "#fce7f3", text: "#831843" }, // hồng
              ]
              const c = COLORS[i % COLORS.length]
              return (
                <div key={p.id}
                  onMouseDown={() => { onChange(p.id, p.title); setQ(p.title); setOpen(false) }}
                  style={{
                    background: c.bg, color: c.text,
                    borderRadius: 20, padding: "5px 12px",
                    fontSize: 11, fontWeight: 700, cursor: "pointer",
                    letterSpacing: "0.03em", textTransform: "uppercase",
                    border: `1.5px solid ${c.bg}`,
                    transition: "filter 0.1s",
                  }}
                  onMouseOver={e => (e.currentTarget.style.filter = "brightness(0.92)")}
                  onMouseOut={e => (e.currentTarget.style.filter = "none")}
                >
                  {p.title}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Shared cell styles ----
function cellInput(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: "100%", border: "none", background: "transparent",
    fontSize: 12, padding: "3px 4px", outline: "none",
    fontFamily: "inherit", color: "#111827",
    ...extra,
  }
}
function tdStyle(w?: number, align?: "right" | "left", bg?: string): React.CSSProperties {
  return {
    padding: "0 2px", borderRight: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb",
    background: bg ?? "#fff", verticalAlign: "middle",
    width: w ? w : undefined, minWidth: w ? w : 60,
    textAlign: align ?? "left",
  }
}
function thStyle(w?: number, align?: "right" | "left"): React.CSSProperties {
  return {
    padding: "6px 6px", borderRight: "1px solid #d1d5db", borderBottom: "2px solid #d1d5db",
    background: "#f3f4f6", fontSize: 11, fontWeight: 700, color: "#374151",
    whiteSpace: "nowrap", textAlign: align ?? "left",
    width: w, minWidth: w ?? 50, position: "sticky", top: 0, zIndex: 10,
  }
}

// Column definitions
const COLS = [
  { key: "product_title", label: "SẢN PHẨM", w: 200 },
  { key: "lot_date",      label: "G.P DATE", w: 110, type: "date" },
  { key: "received_date", label: "VỀ KHO VN", w: 110, type: "date" },
  { key: "qty",           label: "QLY", w: 60, align: "right" as const },
  { key: "price_unit",    label: "PRICE/UNIT", w: 100, align: "right" as const },
  { key: "amount",        label: "AMOUNT", w: 110, align: "right" as const, computed: true },
  { key: "local_fee_tq",  label: "LOCAL FEE TQ", w: 105, align: "right" as const },
  { key: "ship_fee_ovs",  label: "SHIP FEE OVS", w: 105, align: "right" as const },
  { key: "local_fee_vn",  label: "LOCAL FEE VN", w: 105, align: "right" as const },
  { key: "vat_fee",       label: "PHÍ VAT", w: 90, align: "right" as const },
  { key: "other_fee",     label: "PHÍ KHÁC", w: 90, align: "right" as const },
  { key: "final_price",   label: "FINAL PRICE/unit", w: 130, align: "right" as const, computed: true, highlight: true },
  { key: "row_type",      label: "LOẠI", w: 110, type: "select", opts: ["main","accessory"] },
  { key: "source",        label: "NGUỒN", w: 90, type: "select", opts: ["TQ","SHOPEE","Nội địa","Khác"] },
  { key: "status",        label: "TRẠNG THÁI", w: 120, type: "select", opts: ["received","pending","cancelled"] },
  { key: "note",          label: "GHI CHÚ", w: 180 },
]

// ---- Single editable row ----
function SheetRow({
  row, idx, onChange, onDelete, onSave,
}: {
  row: RowDraft
  idx: number
  onChange: (id: string, field: string, val: string) => void
  onDelete: (id: string) => void
  onSave: (id: string) => void
}) {
  const { amount, final_price } = calcRow(row)
  const rowBg = row._saved ? "#f0fdf4" : row._error ? "#fef2f2" : idx % 2 === 0 ? "#fff" : "#fafafa"

  function cell(key: string) {
    const col = COLS.find(c => c.key === key)!
    if (col.computed) return null
    if (key === "product_title") {
      return (
        <td key={key} style={tdStyle(col.w, col.align, rowBg)}>
          <ProdCell
            value={row.product_title}
            productId={row.product_id}
            isAccessory={row.row_type === "accessory"}
            onChange={(id, title) => { onChange(row._id, "product_id", id); onChange(row._id, "product_title", title) }}
          />
        </td>
      )
    }
    if (col.type === "select") {
      const isType = key === "row_type"
      const val = (row as any)[key]
      const selectBg = isType
        ? (val === "accessory" ? "#fef3c7" : "#f0fdf4")
        : rowBg
      function labelOf(o: string) {
        if (o === "received") return "Đã nhận"
        if (o === "pending") return "Đang về"
        if (o === "cancelled") return "Hủy"
        if (o === "main") return "🏷 Sản phẩm chính"
        if (o === "accessory") return "🔩 Phụ kiện SP chính"
        return o
      }
      return (
        <td key={key} style={tdStyle(col.w, col.align, selectBg)}>
          <select value={val}
            onChange={e => onChange(row._id, key, e.target.value)}
            style={{ ...cellInput(), cursor: "pointer", background: selectBg, fontWeight: isType ? 600 : 400 }}>
            {col.opts!.map(o => <option key={o} value={o}>{labelOf(o)}</option>)}
          </select>
        </td>
      )
    }
    return (
      <td key={key} style={tdStyle(col.w, col.align, rowBg)}>
        <input
          type={col.type === "date" ? "date" : "text"}
          value={(row as any)[key]}
          onChange={e => onChange(row._id, key, e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSave(row._id)}
          style={cellInput(col.align === "right" ? { textAlign: "right" } : undefined)}
          placeholder={col.type === "date" ? "yyyy-mm-dd" : ""}
        />
      </td>
    )
  }

  return (
    <tr>
      {/* Row number */}
      <td style={{ ...tdStyle(32), textAlign: "center", color: "#9ca3af", fontSize: 11, background: rowBg, paddingLeft: 4 }}>
        {row._saving ? "⏳" : row._saved ? "✓" : row._error ? "✗" : idx + 1}
      </td>

      {COLS.map(col => {
        if (col.computed) {
          const val = col.key === "amount" ? amount : final_price
          return (
            <td key={col.key} style={{ ...tdStyle(col.w, col.align, col.highlight ? (row._saved ? "#d1fae5" : "#ede9fe") : rowBg) }}>
              <span style={{ fontSize: 12, fontWeight: col.highlight ? 700 : 400, color: col.highlight ? "#7c3aed" : "#374151", padding: "3px 4px", display: "block" }}>
                {val > 0 ? new Intl.NumberFormat("vi-VN").format(Math.round(val)) : "—"}
              </span>
            </td>
          )
        }
        return cell(col.key)
      })}

      {/* Actions */}
      <td style={{ ...tdStyle(72), textAlign: "center", background: rowBg }}>
        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
          <button onClick={() => onSave(row._id)} disabled={row._saving}
            title="Lưu dòng này"
            style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 4, padding: "3px 8px", cursor: row._saving ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600 }}>
            {row._saving ? "…" : "Lưu"}
          </button>
          <button onClick={() => onDelete(row._id)}
            title="Xóa dòng"
            style={{ background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 4, padding: "3px 6px", cursor: "pointer", fontSize: 11 }}>
            ✕
          </button>
        </div>
        {row._error && <div style={{ fontSize: 9, color: "#dc2626", marginTop: 2 }}>{row._error}</div>}
      </td>
    </tr>
  )
}

// ---- Import Tab (spreadsheet style) ----
function ImportTab({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<RowDraft[]>([newRow(), newRow(), newRow()])
  const [savingAll, setSavingAll] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)
  const csvFileRef = useRef<HTMLInputElement>(null)

  function handleCsvImport(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const allRows = parseCsvText(text)
      if (!allRows.length) return
      const hdrs = allRows[0]
      const dataRows = allRows.slice(1).filter(r => r.some(c => c))
      const m = autoDetectMapping(hdrs)
      const colOf = (key: string) => m[key] ?? -1

      const newRows: RowDraft[] = dataRows.map(r => {
        const name        = r[colOf("SẢN PHẨM")]?.trim() ?? ""
        const qty         = r[colOf("QLY")]?.trim() ?? ""
        const priceUnit   = r[colOf("PRICE/UNIT")]?.trim() ?? ""
        const finalPrice  = r[colOf("FINAL PRICE")]?.trim() ?? ""
        const localFtq    = r[colOf("LOCAL FEE TQ")]?.trim() ?? "0"
        const shipOvs     = r[colOf("SHIP FEE OVS")]?.trim() ?? "0"
        const localFvn    = r[colOf("LOCAL FEE VN")]?.trim() ?? "0"
        const vatFee      = r[colOf("PHÍ VAT")]?.trim() ?? "0"
        const otherFee    = r[colOf("PHÍ KHÁC")]?.trim() ?? "0"
        const lotDate     = r[colOf("G.P DATE")]?.trim() ?? ""
        const recDate     = r[colOf("VỀ KHO")]?.trim() ?? ""
        const note        = r[colOf("GHI CHÚ")]?.trim() ?? ""
        // Dùng FINAL PRICE làm price_unit nếu không có PRICE/UNIT
        const effectivePrice = finalPrice || priceUnit
        return {
          ...newRow(),
          product_title: name,
          qty,
          price_unit: effectivePrice,
          local_fee_tq: localFtq || "0",
          ship_fee_ovs: shipOvs || "0",
          local_fee_vn: localFvn || "0",
          vat_fee: vatFee || "0",
          other_fee: otherFee || "0",
          lot_date: lotDate,
          received_date: recDate,
          note,
        }
      }).filter(r => r.product_title && r.qty)

      if (!newRows.length) return
      // Replace blank rows, append non-blank ones
      setRows(rs => {
        const blanks = rs.filter(r => !r.product_title && !r.qty)
        const filled = rs.filter(r => r.product_title || r.qty)
        return [...filled, ...newRows, ...(blanks.length > 0 && filled.length + newRows.length === rs.length ? [] : [])]
      })
      setTimeout(() => tableRef.current?.scrollTo(0, 0), 50)
    }
    reader.readAsText(file, "utf-8")
  }

  function updateRow(id: string, field: string, val: string) {
    setRows(rs => rs.map(r => r._id === id ? { ...r, [field]: val, _saved: false, _error: undefined } : r))
  }

  function deleteRow(id: string) {
    setRows(rs => rs.length === 1 ? [newRow()] : rs.filter(r => r._id !== id))
  }

  function addRow() {
    setRows(rs => [...rs, newRow()])
    setTimeout(() => tableRef.current?.scrollTo(0, tableRef.current.scrollHeight), 50)
  }

  async function saveRow(id: string) {
    const row = rows.find(r => r._id === id)
    if (!row) return
    if (!row.product_id) { setRows(rs => rs.map(r => r._id === id ? { ...r, _error: "Chưa chọn SP" } : r)); return }
    if (!row.lot_date) { setRows(rs => rs.map(r => r._id === id ? { ...r, _error: "Thiếu ngày GP" } : r)); return }
    if (!num(row.qty) || !num(row.price_unit)) { setRows(rs => rs.map(r => r._id === id ? { ...r, _error: "Thiếu SL/giá" } : r)); return }

    setRows(rs => rs.map(r => r._id === id ? { ...r, _saving: true, _error: undefined } : r))
    try {
      await apiJson("/admin/gia-von", "POST", {
        product_id: row.product_id, product_title: row.product_title,
        lot_date: row.lot_date, received_date: row.received_date || undefined,
        qty: num(row.qty), price_unit: num(row.price_unit),
        local_fee_tq: num(row.local_fee_tq), ship_fee_ovs: num(row.ship_fee_ovs),
        local_fee_vn: num(row.local_fee_vn), vat_fee: num(row.vat_fee),
        other_fee: num(row.other_fee),
        source: row.source, status: row.status,
        note: row.row_type === "accessory"
          ? (row.note ? `[Phụ kiện] ${row.note}` : "[Phụ kiện]")
          : row.note,
      })
      setRows(rs => rs.map(r => r._id === id ? { ...r, _saving: false, _saved: true } : r))
      onSaved()
    } catch (err: any) {
      setRows(rs => rs.map(r => r._id === id ? { ...r, _saving: false, _error: err?.message ?? "Lỗi" } : r))
    }
  }

  async function saveAll() {
    const pending = rows.filter(r => !r._saved && r.product_id && r.lot_date && num(r.qty) && num(r.price_unit))
    if (!pending.length) return
    setSavingAll(true)
    for (const r of pending) await saveRow(r._id)
    setSavingAll(false)
  }

  const savedCount = rows.filter(r => r._saved).length
  const totalAmount = rows.reduce((s, r) => {
    const { amount } = calcRow(r)
    return s + (r._saved ? 0 : amount)  // chỉ tính dòng chưa lưu
  }, 0)

  return (
    <div>
      {/* Hidden CSV file input */}
      <input ref={csvFileRef} type="file" accept=".csv" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvImport(f); e.target.value = "" }} />

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={addRow}
          style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          + Thêm dòng
        </button>
        <button onClick={() => csvFileRef.current?.click()}
          style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 7, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#92400e" }}>
          📂 Import từ CSV
        </button>
        <button onClick={saveAll} disabled={savingAll}
          style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, padding: "7px 18px", cursor: savingAll ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>
          {savingAll ? "Đang lưu tất cả…" : "💾 Lưu tất cả"}
        </button>
        <button onClick={() => setRows([newRow(), newRow(), newRow()])}
          style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 13, color: "#6b7280" }}>
          Xóa sạch
        </button>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
          {savedCount > 0 && <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ {savedCount} dòng đã lưu &nbsp;</span>}
          {rows.length - savedCount} dòng chưa lưu
        </div>
      </div>

      {/* Spreadsheet table */}
      <div ref={tableRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: 1400 }}>
          <thead>
            <tr>
              <th style={thStyle(32, "left")}>#</th>
              {COLS.map(c => (
                <th key={c.key} style={thStyle(c.w, c.align)}>
                  {c.label}
                </th>
              ))}
              <th style={thStyle(72, "left")}>TÁC VỤ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <SheetRow
                key={r._id}
                row={r}
                idx={i}
                onChange={updateRow}
                onDelete={deleteRow}
                onSave={saveRow}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer hint */}
      <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
        Nhấn <kbd style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 3, border: "1px solid #d1d5db" }}>Enter</kbd> trong ô bất kỳ để lưu dòng đó. Cột <strong>AMOUNT</strong> và <strong>FINAL PRICE/unit</strong> tự tính.
      </div>
    </div>
  )
}

// ---- Lot History Modal ----
function LotHistoryModal({ productId, productTitle, onClose }: { productId: string; productTitle: string; onClose: () => void }) {
  const [lots, setLots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiJson(`/admin/gia-von?product_id=${productId}&limit=50`, "GET")
      .then(d => { setLots(d.lots ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [productId])

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 10, width: "min(1000px, 96vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Lịch sử lô — {productTitle}</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 16 }}>
          {loading ? <div style={{ color: "#6b7280", padding: 24 }}>Đang tải…</div> : lots.length === 0 ? <div style={{ color: "#6b7280" }}>Chưa có lô</div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["G.P DATE","VỀ KHO VN","QLY","PRICE/UNIT","AMOUNT","LOCAL FEE TQ","SHIP FEE OVS","LOCAL FEE VN","PHÍ VAT","FINAL PRICE/unit","NGUỒN","TRẠNG THÁI","GHI CHÚ"].map(h => (
                      <th key={h} style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, fontSize: 11, color: "#374151", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l: any, i: number) => (
                    <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap", textAlign: "left" }}>{fmtDate(l.lot_date)}</td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap", textAlign: "left" }}>{fmtDate(l.received_date)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{l.qty}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtVND(l.price_unit)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtVND(l.amount)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtVND(l.local_fee_tq)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtVND(l.ship_fee_ovs)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtVND(l.local_fee_vn)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtVND(l.vat_fee)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#7c3aed" }}>{fmtVND(l.final_price)}</td>
                      <td style={{ padding: "6px 8px" }}>{l.source}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{ background: l.status === "received" ? "#dcfce7" : l.status === "pending" ? "#fef9c3" : "#fee2e2", color: l.status === "received" ? "#16a34a" : "#ca8a04", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>
                          {l.status === "received" ? "Đã nhận" : l.status === "pending" ? "Đang về" : "Hủy"}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", color: "#6b7280" }}>{l.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Overview Tab ----
function OverviewTab() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [modal, setModal] = useState<{ id: string; title: string } | null>(null)

  function load(s = search) {
    setLoading(true)
    apiJson(`/admin/gia-von/summary?search=${encodeURIComponent(s)}`, "GET")
      .then(d => { setProducts(d.products ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input type="text" placeholder="Tìm sản phẩm…" value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load(search)}
          style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: 7, padding: "8px 12px", fontSize: 13 }} />
        <button onClick={() => load(search)}
          style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, padding: "8px 18px", cursor: "pointer", fontSize: 13 }}>Tìm</button>
        <button onClick={() => load(search)}
          style={{ background: "#f3f4f6", border: "none", borderRadius: 7, padding: "8px 14px", cursor: "pointer", fontSize: 13 }}>↻</button>
      </div>

      {loading ? (
        <div style={{ color: "#6b7280", textAlign: "center", padding: 32 }}>Đang tải…</div>
      ) : products.length === 0 ? (
        <div style={{ color: "#6b7280", textAlign: "center", padding: 32 }}>Chưa có dữ liệu giá vốn</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Sản phẩm","Giá vốn TB","Tồn kho (lô)","Số lô","Nhập gần nhất",""].map((h, i) => (
                  <th key={i} style={{ padding: "10px 12px", textAlign: i > 0 && i < 4 ? "right" : "left", fontWeight: 700, fontSize: 12, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p: any, i: number) => (
                <tr key={p.product_id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 600 }}>{p.product_title}</div>
                    <div style={{ color: "#9ca3af", fontSize: 10 }}>{p.product_id}</div>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: "#7c3aed", fontSize: 15 }}>{fmtVND(p.avg_cost)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{p.stock_qty}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{p.total_lots}</td>
                  <td style={{ padding: "10px 12px" }}>{fmtDate(p.last_imported_at)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => setModal({ id: p.product_id, title: p.product_title })}
                      style={{ background: "#ede9fe", color: "#7c3aed", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                      Xem lịch sử
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <LotHistoryModal productId={modal.id} productTitle={modal.title} onClose={() => setModal(null)} />}
    </div>
  )
}

// ---- CSV Import Tab ----
function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = "", inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1]
    if (ch === '"') { if (inQ && nx === '"') { cell += '"'; i++ } else inQ = !inQ }
    else if (ch === ',' && !inQ) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' && !inQ) { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else if (ch === '\r') { /* skip */ }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows
}

function parseViNum(s: string): number {
  if (!s) return 0
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

// Cột CSV mong muốn → index trong file upload
const CSV_COL_OPTIONS = ["(bỏ qua)", "SẢN PHẨM", "QLY", "PRICE/UNIT", "LOCAL FEE TQ", "AMOUNT", "SHIP FEE OVS", "LOCAL FEE VN", "PHÍ VAT", "PHÍ KHÁC", "FINAL PRICE", "G.P DATE", "VỀ KHO", "TÌNH TRẠNG", "GHI CHÚ"]

// Auto-detect cột dựa trên tên header trong CSV
function autoDetectMapping(headers: string[]): Record<string, number> {
  const MAP: Record<string, string[]> = {
    "SẢN PHẨM":     ["sản phẩm", "product", "tên sp", "tên hàng", "sp"],
    "QLY":           ["qly", "qty", "sl", "số lượng", "quantity"],
    "PRICE/UNIT":    ["price/unit", "price unit", "đơn giá", "giá/unit"],
    "LOCAL FEE TQ":  ["local fee tq", "phí nội địa tq", "local_fee_tq"],
    "AMOUNT":        ["amount", "thành tiền", "amount (vnd)"],
    "SHIP FEE OVS":  ["ship fee ovs", "oversea", "ship ovs", "total ship fee ovs"],
    "LOCAL FEE VN":  ["local fee vn", "phí nội địa vn", "local_fee_vn", "local fee\nvn"],
    "PHÍ VAT":       ["phí vat", "vat", "phí xuất vat", "vat fee"],
    "PHÍ KHÁC":      ["phí khác", "other", "other fee"],
    "FINAL PRICE":   ["final price", "final price (vnd)", "giá vốn", "final_price"],
    "G.P DATE":      ["g.p date", "gp date", "ngày gp", "đề xuất", "lot_date"],
    "VỀ KHO":        ["wareh in vn", "ngày về", "về kho vn", "received_date"],
    "TÌNH TRẠNG":    ["trang thai", "tình trạng", "trạng thái", "trang thái"],
    "GHI CHÚ":       ["ghi chú", "note", "trouble", "ghi chu"],
  }
  const result: Record<string, number> = {}
  headers.forEach((h, i) => {
    const norm = h.toLowerCase().replace(/\s+/g, ' ').replace(/[\n\r]/g, ' ').trim()
    for (const [key, aliases] of Object.entries(MAP)) {
      if (aliases.some(a => norm.includes(a)) && result[key] === undefined) {
        result[key] = i
      }
    }
  })
  return result
}

function CsvImportTab({ onSaved }: { onSaved: () => void }) {
  const [csvRows, setCsvRows] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, number>>({})  // fieldKey → colIndex
  const [preview, setPreview] = useState<any[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok?: number; error?: string } | null>(null)
  const [step, setStep] = useState<"upload" | "map" | "preview">("upload")
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const rows = parseCsvText(text)
      if (!rows.length) return
      const hdrs = rows[0]
      const dataRows = rows.slice(1).filter(r => r.some(c => c))
      setHeaders(hdrs)
      setCsvRows(dataRows)
      const auto = autoDetectMapping(hdrs)
      setMapping(auto)
      setStep("map")
      setResult(null)
    }
    reader.readAsText(file, "utf-8")
  }

  function buildPreview() {
    const colOf = (key: string) => mapping[key] ?? -1
    const rows = csvRows
      .map(r => {
        const name = r[colOf("SẢN PHẨM")]?.trim()
        if (!name) return null
        const qty        = parseViNum(r[colOf("QLY")] ?? "")
        const finalPrice = parseViNum(r[colOf("FINAL PRICE")] ?? "")
        const priceUnit  = parseViNum(r[colOf("PRICE/UNIT")] ?? "")
        const localFtq   = parseViNum(r[colOf("LOCAL FEE TQ")] ?? "")
        const shipOvs    = parseViNum(r[colOf("SHIP FEE OVS")] ?? "")
        const localFvn   = parseViNum(r[colOf("LOCAL FEE VN")] ?? "")
        const vatFee     = parseViNum(r[colOf("PHÍ VAT")] ?? "")
        const otherFee   = parseViNum(r[colOf("PHÍ KHÁC")] ?? "")
        const lotDate    = r[colOf("G.P DATE")]?.trim() || ""
        const recDate    = r[colOf("VỀ KHO")]?.trim() || ""
        const note       = r[colOf("GHI CHÚ")]?.trim() || ""
        if (!qty || (!finalPrice && !priceUnit)) return null
        // Tính final price nếu không có sẵn
        const cost = finalPrice > 0 ? finalPrice
          : qty > 0 ? (qty * priceUnit + localFtq + shipOvs + localFvn + vatFee + otherFee) / qty
          : priceUnit
        return { product_title: name, qty, cost: Math.round(cost), lot_date: lotDate, received_date: recDate, note }
      })
      .filter(Boolean) as any[]

    // Merge by product name (weighted avg)
    const merged = new Map<string, { totalCost: number; qty: number; lots: number; lot_date: string; note: string }>()
    for (const r of rows) {
      if (!merged.has(r.product_title)) merged.set(r.product_title, { totalCost: 0, qty: 0, lots: 0, lot_date: r.lot_date, note: r.note })
      const m = merged.get(r.product_title)!
      m.totalCost += r.qty * r.cost
      m.qty += r.qty
      m.lots++
      if (r.lot_date) m.lot_date = r.lot_date
    }
    setPreview([...merged.entries()].map(([name, m]) => ({
      product_title: name,
      avg_cost: Math.round(m.totalCost / m.qty),
      stock_qty: m.qty,
      total_lots: m.lots,
      lot_date: m.lot_date,
    })))
    setStep("preview")
  }

  async function doImport() {
    if (!preview.length) return
    setImporting(true)
    setResult(null)
    try {
      const data = await apiJson("/admin/gia-von/bulk-cost", "POST", { rows: preview.map(r => ({
        product_id: "cost_" + r.product_title.toLowerCase()
          .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g,"a").replace(/[èéẹẻẽêềếệểễ]/g,"e")
          .replace(/[ìíịỉĩ]/g,"i").replace(/[òóọỏõôồốộổỗơờớợởỡ]/g,"o")
          .replace(/[ùúụủũưừứựửữ]/g,"u").replace(/[ỳýỵỷỹ]/g,"y").replace(/đ/g,"d")
          .replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""),
        product_title: r.product_title,
        avg_cost: r.avg_cost,
        stock_qty: r.stock_qty,
        total_lots: r.total_lots,
      })) })
      setResult({ ok: data.upserted })
      onSaved()
    } catch (err: any) {
      setResult({ error: err?.message ?? "Lỗi" })
    }
    setImporting(false)
  }

  const thS: React.CSSProperties = { padding: "7px 10px", background: "#f3f4f6", fontWeight: 700, fontSize: 11, color: "#374151", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap", textAlign: "left" }
  const tdS: React.CSSProperties = { padding: "6px 10px", fontSize: 12, borderBottom: "1px solid #f3f4f6" }

  return (
    <div>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
        {(["upload","map","preview"] as const).map((s, i) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: step === s ? "#7c3aed" : (["upload","map","preview"].indexOf(step) > i ? "#d1fae5" : "#e5e7eb"), color: step === s ? "#fff" : (["upload","map","preview"].indexOf(step) > i ? "#16a34a" : "#6b7280") }}>{i+1}</span>
            <span style={{ fontSize: 12, color: step === s ? "#7c3aed" : "#9ca3af", fontWeight: step === s ? 700 : 400 }}>{s === "upload" ? "Tải CSV" : s === "map" ? "Khớp cột" : "Xem trước & Import"}</span>
            {i < 2 && <span style={{ color: "#d1d5db" }}>›</span>}
          </span>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onClick={() => fileRef.current?.click()}
          style={{ border: "2px dashed #c4b5fd", borderRadius: 12, padding: "48px 24px", textAlign: "center", cursor: "pointer", background: "#faf5ff", transition: "background 0.2s" }}
          onMouseOver={e => (e.currentTarget.style.background = "#ede9fe")}
          onMouseOut={e => (e.currentTarget.style.background = "#faf5ff")}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>Kéo thả hoặc click để chọn file CSV</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>File CSV từ Google Sheets / Excel — UTF-8. Dòng đầu là header.</div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === "map" && (
        <div>
          <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Khớp cột — {csvRows.length} dòng dữ liệu</div>
            <button onClick={() => setStep("upload")} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>← Đổi file</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginBottom: 20 }}>
            {CSV_COL_OPTIONS.filter(f => f !== "(bỏ qua)").map(field => (
              <label key={field} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, background: mapping[field] !== undefined ? "#faf5ff" : "#fff" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", minWidth: 120 }}>{field}</span>
                <select
                  value={mapping[field] ?? ""}
                  onChange={e => {
                    const v = e.target.value
                    setMapping(m => ({ ...m, [field]: v === "" ? undefined as any : Number(v) }))
                  }}
                  style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: 5, padding: "4px 6px", fontSize: 11 }}
                >
                  <option value="">(bỏ qua)</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>[{i+1}] {h.replace(/\n/g," ").slice(0,40)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {/* Preview raw CSV (first 5 rows) */}
          <details style={{ marginBottom: 16 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Xem 5 dòng đầu CSV gốc</summary>
            <div style={{ overflowX: "auto", fontSize: 11 }}>
              <table style={{ borderCollapse: "collapse" }}>
                <thead><tr>{headers.map((h,i) => <th key={i} style={{ ...thS, minWidth: 80 }}>[{i+1}] {h.replace(/\n/g," ").slice(0,20)}</th>)}</tr></thead>
                <tbody>{csvRows.slice(0,5).map((r,ri) => <tr key={ri}>{r.map((c,ci) => <td key={ci} style={{ ...tdS, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
          <button onClick={buildPreview}
            style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
            Xem trước →
          </button>
        </div>
      )}

      {/* Step 3: Preview & import */}
      {step === "preview" && (
        <div>
          <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Xem trước — {preview.length} sản phẩm (đã gộp bình quân gia quyền)</div>
            <button onClick={() => setStep("map")} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>← Sửa mapping</button>
            <button onClick={doImport} disabled={importing}
              style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 22px", cursor: importing ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, marginLeft: "auto" }}>
              {importing ? "Đang import…" : `✓ Import ${preview.length} sản phẩm`}
            </button>
          </div>
          {result && (
            <div style={{ marginBottom: 12, padding: "10px 16px", borderRadius: 8, background: result.ok ? "#dcfce7" : "#fee2e2", color: result.ok ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
              {result.ok ? `✓ Đã import ${result.ok} sản phẩm vào product_cost` : `✗ Lỗi: ${result.error}`}
            </div>
          )}
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["#","Sản phẩm","Giá vốn TB","Tổng qty","Số lô","G.P DATE"].map((h, i) => (
                    <th key={i} style={{ ...thS, textAlign: i > 1 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ ...tdS, color: "#9ca3af", width: 32 }}>{i+1}</td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{r.product_title}</td>
                    <td style={{ ...tdS, textAlign: "right", fontWeight: 800, color: "#7c3aed" }}>{new Intl.NumberFormat("vi-VN").format(r.avg_cost)}đ</td>
                    <td style={{ ...tdS, textAlign: "right" }}>{r.stock_qty}</td>
                    <td style={{ ...tdS, textAlign: "right" }}>{r.total_lots}</td>
                    <td style={{ ...tdS }}>{r.lot_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
            Sản phẩm chưa có trong Medusa sẽ dùng tên làm ID tạm. Có thể khớp tay sau trong tab Tổng quan.
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main Page ----
export default function GiaVonPage() {
  const { has } = useCurrentPermissions()
  const canManage = has("page.gia-von.manage")
  const [tab, setTab] = useState<"overview" | "import" | "csv">("overview")
  const [refreshKey, setRefreshKey] = useState(0)

  const tabBtn = (active: boolean) => ({
    padding: "8px 20px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
    background: active ? "#7c3aed" : "transparent", color: active ? "#fff" : "#6b7280",
  })

  return (
    <div style={{ padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#111827" }}>Giá vốn sản phẩm</h1>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>Lịch sử lô nhập & giá vốn bình quân gia quyền</p>
      </div>

      <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 10, padding: 4, width: "fit-content", marginBottom: 24 }}>
        <button style={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>📊 Tổng quan</button>
        {canManage && <button style={tabBtn(tab === "import")} onClick={() => setTab("import")}>📋 Nhập lô hàng</button>}
        {canManage && <button style={tabBtn(tab === "csv")} onClick={() => setTab("csv")}>📂 Import CSV</button>}
      </div>

      {tab === "overview" && <OverviewTab key={refreshKey} />}
      {tab === "import" && canManage && (
        <ImportTab onSaved={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === "csv" && canManage && (
        <CsvImportTab onSaved={() => { setRefreshKey(k => k + 1) }} />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giá vốn",
  icon: "currency-dollar",
})
