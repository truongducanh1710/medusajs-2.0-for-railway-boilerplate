import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ---- Helpers ----
function fmtVND(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—"
  return s.slice(0, 10)
}

function calcLivePreview(form: LotForm) {
  const amount = (form.qty || 0) * (form.price_unit || 0)
  const total = amount + (form.local_fee_tq || 0) + (form.ship_fee_ovs || 0) + (form.local_fee_vn || 0) + (form.vat_fee || 0) + (form.other_fee || 0)
  const final_price = form.qty > 0 ? total / form.qty : 0
  return { amount, total, final_price }
}

interface LotForm {
  product_id: string
  product_title: string
  lot_date: string
  received_date: string
  qty: number
  price_unit: number
  local_fee_tq: number
  ship_fee_ovs: number
  local_fee_vn: number
  vat_fee: number
  other_fee: number
  source: string
  status: string
  note: string
}

const EMPTY_FORM: LotForm = {
  product_id: "", product_title: "", lot_date: "", received_date: "",
  qty: 0, price_unit: 0, local_fee_tq: 0, ship_fee_ovs: 0,
  local_fee_vn: 0, vat_fee: 0, other_fee: 0,
  source: "TQ", status: "received", note: "",
}

// ---- Product search dropdown ----
function ProductSearch({ value, onSelect }: { value: string; onSelect: (id: string, title: string) => void }) {
  const [q, setQ] = useState(value)
  const [results, setResults] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const debounce = useRef<any>(null)

  function search(text: string) {
    setQ(text)
    clearTimeout(debounce.current)
    if (text.length < 2) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`/admin/products?q=${encodeURIComponent(text)}&limit=10`, "GET")
        setResults(data.products ?? [])
        setOpen(true)
      } catch { setResults([]) }
    }, 300)
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={q}
        placeholder="Tìm sản phẩm..."
        onChange={e => search(e.target.value)}
        onFocus={() => q.length >= 2 && setOpen(true)}
        style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}
      />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,.12)", zIndex: 100, maxHeight: 220, overflowY: "auto" }}>
          {results.map((p: any) => (
            <div key={p.id}
              onClick={() => { onSelect(p.id, p.title); setQ(p.title); setOpen(false) }}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f3f4f6" }}
              onMouseOver={e => (e.currentTarget.style.background = "#f9fafb")}
              onMouseOut={e => (e.currentTarget.style.background = "#fff")}
            >
              <div style={{ fontWeight: 500 }}>{p.title}</div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>{p.id}</div>
            </div>
          ))}
        </div>
      )}
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
      <div style={{ background: "#fff", borderRadius: 10, width: "min(900px, 95vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Lịch sử lô nhập — {productTitle}</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#6b7280" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 20 }}>
          {loading ? <div style={{ color: "#6b7280", padding: 16 }}>Đang tải...</div> : lots.length === 0 ? <div style={{ color: "#6b7280" }}>Chưa có lô nhập</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Ngày GP","Ngày về VN","SL","Giá/unit","Amount","Phí TQ","Phí ship","Phí VN","Phí VAT","Giá vốn/unit","Nguồn","Ghi chú"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "#374151", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((l: any, i: number) => (
                  <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{fmtDate(l.lot_date)}</td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{fmtDate(l.received_date)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{l.qty}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.price_unit)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.amount)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.local_fee_tq)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.ship_fee_ovs)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.local_fee_vn)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.vat_fee)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#7c3aed" }}>{fmtVND(l.final_price)}</td>
                    <td style={{ padding: "7px 10px" }}>{l.source}</td>
                    <td style={{ padding: "7px 10px", color: "#6b7280", maxWidth: 160 }}>{l.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <input
          type="text" placeholder="Tìm sản phẩm..."
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load(search)}
          style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
        />
        <button onClick={() => load(search)}
          style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>
          Tìm
        </button>
        <button onClick={() => load(search)}
          style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13 }}>
          ↻ Làm mới
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#6b7280", padding: 24, textAlign: "center" }}>Đang tải...</div>
      ) : products.length === 0 ? (
        <div style={{ color: "#6b7280", padding: 24, textAlign: "center" }}>Chưa có dữ liệu giá vốn nào</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Sản phẩm","Giá vốn TB","Tồn kho (lô)","Số lô","Nhập gần nhất",""].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: h === "Giá vốn TB" || h === "Tồn kho (lô)" || h === "Số lô" ? "right" : "left", fontWeight: 600, fontSize: 12, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p: any, i: number) => (
                <tr key={p.product_id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 600 }}>{p.product_title}</div>
                    <div style={{ color: "#9ca3af", fontSize: 11 }}>{p.product_id}</div>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#7c3aed", fontSize: 15 }}>{fmtVND(p.avg_cost)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{p.stock_qty}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{p.total_lots}</td>
                  <td style={{ padding: "10px 12px" }}>{fmtDate(p.last_imported_at)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => setModal({ id: p.product_id, title: p.product_title })}
                      style={{ background: "#ede9fe", color: "#7c3aed", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
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

// ---- Import Tab ----
function ImportTab() {
  const [form, setForm] = useState<LotForm>({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [recentLots, setRecentLots] = useState<any[]>([])

  const { amount, total, final_price } = calcLivePreview(form)

  function field(k: keyof LotForm, label: string, type = "number", placeholder = "") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{label}</label>
        <input
          type={type} placeholder={placeholder}
          value={(form as any)[k]}
          onChange={e => setForm(f => ({ ...f, [k]: type === "number" ? Number(e.target.value) : e.target.value }))}
          style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
        />
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.product_id) { setError("Chưa chọn sản phẩm"); return }
    if (!form.lot_date) { setError("Chưa nhập ngày GP"); return }
    if (!form.qty || !form.price_unit) { setError("Chưa nhập SL / giá/unit"); return }
    setError(""); setSuccess(""); setSubmitting(true)
    try {
      await apiFetch("/admin/gia-von", "POST", form)
      setSuccess("Đã lưu lô thành công!")
      setForm({ ...EMPTY_FORM })
      loadRecent()
    } catch (err: any) {
      setError(err?.message ?? "Lỗi không xác định")
    } finally {
      setSubmitting(false)
    }
  }

  function loadRecent() {
    apiFetch("/admin/gia-von?limit=20", "GET").then(d => setRecentLots(d.lots ?? []))
  }

  useEffect(() => { loadRecent() }, [])

  return (
    <div>
      <form onSubmit={submit} style={{ background: "#f9fafb", borderRadius: 10, padding: 20, marginBottom: 24, border: "1px solid #e5e7eb" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: "#111827" }}>Nhập lô hàng mới</div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Sản phẩm *</label>
          <ProductSearch value={form.product_title} onSelect={(id, title) => setForm(f => ({ ...f, product_id: id, product_title: title }))} />
          {form.product_id && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>ID: {form.product_id}</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          {field("lot_date", "Ngày GP *", "date")}
          {field("received_date", "Ngày về VN", "date")}
          {field("qty", "SL (QLY) *")}
          {field("price_unit", "Giá/unit (VND) *")}
          {field("local_fee_tq", "Phí TQ (VND)")}
          {field("ship_fee_ovs", "Phí ship OVS (VND)")}
          {field("local_fee_vn", "Phí VN (VND)")}
          {field("vat_fee", "Phí VAT (VND)")}
          {field("other_fee", "Phí khác (VND)")}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Nguồn</label>
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}>
              {["TQ","SHOPEE","Nội địa","Khác"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Trạng thái</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}>
              <option value="received">Đã nhận hàng</option>
              <option value="pending">Đang về</option>
              <option value="cancelled">Hủy</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Ghi chú</label>
          <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            placeholder="Ghi chú thêm..."
            style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 13 }} />
        </div>

        {/* Live preview */}
        <div style={{ background: "#ede9fe", borderRadius: 8, padding: 14, marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div><span style={{ fontSize: 11, color: "#6d28d9" }}>Amount</span><div style={{ fontWeight: 700, color: "#4c1d95" }}>{fmtVND(amount)}</div></div>
          <div><span style={{ fontSize: 11, color: "#6d28d9" }}>Tổng chi phí</span><div style={{ fontWeight: 700, color: "#4c1d95" }}>{fmtVND(total)}</div></div>
          <div><span style={{ fontSize: 11, color: "#6d28d9" }}>Giá vốn/unit (FINAL PRICE)</span><div style={{ fontWeight: 800, color: "#7c3aed", fontSize: 18 }}>{fmtVND(final_price)}</div></div>
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>⚠ {error}</div>}
        {success && <div style={{ color: "#16a34a", fontSize: 13, marginBottom: 10 }}>✓ {success}</div>}

        <button type="submit" disabled={submitting}
          style={{ background: submitting ? "#a78bfa" : "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14 }}>
          {submitting ? "Đang lưu..." : "Lưu lô nhập"}
        </button>
      </form>

      {/* Recent lots */}
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Lô nhập gần đây</div>
      {recentLots.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: 13 }}>Chưa có lô nào</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Sản phẩm","Ngày GP","Ngày về VN","SL","Giá/unit","Giá vốn/unit","Nguồn","Trạng thái","Ghi chú"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentLots.map((l: any, i: number) => (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "7px 10px", fontWeight: 500 }}>{l.product_title}</td>
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{fmtDate(l.lot_date)}</td>
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{fmtDate(l.received_date)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{l.qty}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtVND(l.price_unit)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#7c3aed" }}>{fmtVND(l.final_price)}</td>
                  <td style={{ padding: "7px 10px" }}>{l.source}</td>
                  <td style={{ padding: "7px 10px" }}>
                    <span style={{ background: l.status === "received" ? "#dcfce7" : l.status === "pending" ? "#fef9c3" : "#fee2e2", color: l.status === "received" ? "#16a34a" : l.status === "pending" ? "#ca8a04" : "#dc2626", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
                      {l.status === "received" ? "Đã nhận" : l.status === "pending" ? "Đang về" : "Hủy"}
                    </span>
                  </td>
                  <td style={{ padding: "7px 10px", color: "#6b7280" }}>{l.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Main Page ----
export default function GiaVonPage() {
  const { has } = useCurrentPermissions()
  const canManage = has("page.gia-von.manage")
  const [tab, setTab] = useState<"overview" | "import">("overview")

  const tabStyle = (active: boolean) => ({
    padding: "8px 20px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
    background: active ? "#7c3aed" : "transparent",
    color: active ? "#fff" : "#6b7280",
  })

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#111827" }}>Giá vốn sản phẩm</h1>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>Theo dõi lịch sử lô nhập & giá vốn trung bình (bình quân gia quyền)</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 10, padding: 4, width: "fit-content", marginBottom: 24 }}>
        <button style={tabStyle(tab === "overview")} onClick={() => setTab("overview")}>📊 Tổng quan</button>
        {canManage && <button style={tabStyle(tab === "import")} onClick={() => setTab("import")}>➕ Nhập lô hàng</button>}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "import" && canManage && <ImportTab />}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giá vốn",
  icon: "currency-dollar",
})
