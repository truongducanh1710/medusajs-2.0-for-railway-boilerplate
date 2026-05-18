import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
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
    lot_date: "", received_date: "",
    qty: "", price_unit: "",
    local_fee_tq: "0", ship_fee_ovs: "0", local_fee_vn: "0",
    vat_fee: "0", other_fee: "0",
    source: "TQ", status: "received", note: "",
  }
}

// ---- Product autocomplete cell ----
function ProdCell({ value, productId, onChange }: {
  value: string
  productId: string
  onChange: (id: string, title: string) => void
}) {
  const [q, setQ] = useState(value)
  const [hits, setHits] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<any>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

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
        const d = await apiFetch(`/admin/products?q=${encodeURIComponent(text)}&limit=8`, "GET")
        setHits(d.products ?? [])
        setOpen(true)
      } catch { setHits([]) }
    }, 250)
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 180 }}>
      <input
        value={q}
        onChange={e => search(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        placeholder="Tên sản phẩm..."
        style={cellInput()}
      />
      {productId && <div style={{ fontSize: 9, color: "#9ca3af", lineHeight: 1, marginTop: 1, paddingLeft: 2 }}>{productId.slice(0, 12)}…</div>}
      {open && hits.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, minWidth: 260, background: "#fff",
          border: "1px solid #e5e7eb", borderRadius: 6, boxShadow: "0 6px 16px rgba(0,0,0,.14)",
          zIndex: 999, maxHeight: 200, overflowY: "auto",
        }}>
          {hits.map((p: any) => (
            <div key={p.id}
              onMouseDown={() => { onChange(p.id, p.title); setQ(p.title); setOpen(false) }}
              style={{ padding: "7px 12px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #f3f4f6" }}
              onMouseOver={e => (e.currentTarget.style.background = "#f5f3ff")}
              onMouseOut={e => (e.currentTarget.style.background = "#fff")}
            >
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div style={{ color: "#9ca3af", fontSize: 10 }}>{p.id}</div>
            </div>
          ))}
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
            onChange={(id, title) => { onChange(row._id, "product_id", id); onChange(row._id, "product_title", title) }}
          />
        </td>
      )
    }
    if (col.type === "select") {
      return (
        <td key={key} style={tdStyle(col.w, col.align, rowBg)}>
          <select value={(row as any)[key]}
            onChange={e => onChange(row._id, key, e.target.value)}
            style={{ ...cellInput(), cursor: "pointer" }}>
            {col.opts!.map(o => <option key={o} value={o}>{o === "received" ? "Đã nhận" : o === "pending" ? "Đang về" : o === "cancelled" ? "Hủy" : o}</option>)}
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
      await apiFetch("/admin/gia-von", "POST", {
        product_id: row.product_id, product_title: row.product_title,
        lot_date: row.lot_date, received_date: row.received_date || undefined,
        qty: num(row.qty), price_unit: num(row.price_unit),
        local_fee_tq: num(row.local_fee_tq), ship_fee_ovs: num(row.ship_fee_ovs),
        local_fee_vn: num(row.local_fee_vn), vat_fee: num(row.vat_fee),
        other_fee: num(row.other_fee),
        source: row.source, status: row.status, note: row.note,
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
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={addRow}
          style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          + Thêm dòng
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
    apiFetch(`/admin/gia-von?product_id=${productId}&limit=50`, "GET")
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
    apiFetch(`/admin/gia-von/summary?search=${encodeURIComponent(s)}`, "GET")
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

// ---- Main Page ----
export default function GiaVonPage() {
  const { has } = useCurrentPermissions()
  const canManage = has("page.gia-von.manage")
  const [tab, setTab] = useState<"overview" | "import">("overview")
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
      </div>

      {tab === "overview" && <OverviewTab key={refreshKey} />}
      {tab === "import" && canManage && (
        <ImportTab onSaved={() => setRefreshKey(k => k + 1)} />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giá vốn",
  icon: "currency-dollar",
})
