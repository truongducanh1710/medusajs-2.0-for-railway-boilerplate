import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useCallback } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { withRouteGuard } from "../../components/route-guard"

interface AdsExpenseRow {
  id: string
  channel_id: string
  card_last4: string | null
  merchant: string | null
  amount: string | number
  currency: string
  txn_at: string | null
  raw_text: string | null
  parsed_by: string
  created_at: string
}

function fmtMoney(n: number | string): string {
  return Number(n || 0).toLocaleString("vi-VN") + "đ"
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getThisMonthRange() {
  const now = new Date(Date.now() + 7 * 3600000)
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { from: toDateInputValue(from), to: toDateInputValue(now) }
}

function ChiPhiKeToanPage() {
  const { isSuper, has } = useCurrentPermissions()
  const canEdit = isSuper || has("page.bao-cao.camp-control")

  const initialRange = getThisMonthRange()
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [rows, setRows] = useState<AdsExpenseRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<AdsExpenseRow>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [addDraft, setAddDraft] = useState({ merchant: "", amount: "", txn_at: "", card_last4: "" })

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson(`/admin/ads-expense/report?from=${from}&to=${to}`)
      setRows(data?.rows || [])
      setTotal(data?.total || 0)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { fetchData() }, [fetchData])

  async function saveEdit(id: string) {
    try {
      await apiJson(`/admin/ads-expense/report/${id}`, "PATCH", {
        merchant: editDraft.merchant,
        amount: editDraft.amount,
        card_last4: editDraft.card_last4,
        txn_at: editDraft.txn_at,
      })
      setEditingId(null)
      fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function removeRow(id: string) {
    if (!confirm("Xóa giao dịch này?")) return
    try {
      await apiJson(`/admin/ads-expense/report/${id}`, "DELETE")
      fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function addManual() {
    if (!addDraft.amount || Number.isNaN(Number(addDraft.amount))) {
      alert("Số tiền không hợp lệ")
      return
    }
    try {
      await apiJson(`/admin/ads-expense/report`, "POST", {
        merchant: addDraft.merchant || null,
        amount: Number(addDraft.amount),
        card_last4: addDraft.card_last4 || null,
        txn_at: addDraft.txn_at || new Date().toISOString(),
      })
      setAddDraft({ merchant: "", amount: "", txn_at: "", card_last4: "" })
      setShowAddForm(false)
      fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div style={{ padding: "24px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Chi phí kế toán</h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Giao dịch chi phí Ads bắt tự động từ SMS ngân hàng (kênh KẾ TOÁN - MKT - Báo Ngưỡng)</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13 }} />
          <span>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13 }} />
          <button onClick={fetchData} disabled={loading} style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
            padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1,
          }}>
            {loading ? "Đang tải..." : "↻ Refresh"}
          </button>
          {canEdit && (
            <button onClick={() => setShowAddForm(v => !v)} style={{
              background: "#059669", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: "pointer", fontSize: 13,
            }}>
              + Thêm thủ công
            </button>
          )}
        </div>
      </div>

      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "12px 20px", marginBottom: 16, display: "inline-block" }}>
        <div style={{ fontSize: 11, color: "#6b7280" }}>Tổng chi phí trong khoảng đã chọn</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#047857" }}>{fmtMoney(total)}</div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>{rows.length} giao dịch</div>
      </div>

      {showAddForm && canEdit && (
        <div style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: 16, marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Merchant</div>
            <input value={addDraft.merchant} onChange={e => setAddDraft(d => ({ ...d, merchant: e.target.value }))}
              placeholder="FACEBK *..." style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 220 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Số tiền (VND)</div>
            <input value={addDraft.amount} onChange={e => setAddDraft(d => ({ ...d, amount: e.target.value }))}
              placeholder="5500000" style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 140 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Thời gian giao dịch</div>
            <input type="datetime-local" value={addDraft.txn_at} onChange={e => setAddDraft(d => ({ ...d, txn_at: e.target.value }))}
              style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>4 số cuối thẻ</div>
            <input value={addDraft.card_last4} onChange={e => setAddDraft(d => ({ ...d, card_last4: e.target.value }))}
              placeholder="3793" maxLength={4} style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 80 }} />
          </div>
          <button onClick={addManual} style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>
            Lưu
          </button>
          <button onClick={() => setShowAddForm(false)} style={{ background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>
            Hủy
          </button>
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
        <thead>
          <tr style={{ background: "#f9fafb", textAlign: "left" }}>
            <th style={{ padding: "8px 12px" }}>Thời gian</th>
            <th style={{ padding: "8px 12px" }}>Merchant</th>
            <th style={{ padding: "8px 12px" }}>Thẻ</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Số tiền</th>
            <th style={{ padding: "8px 12px" }}>Nguồn</th>
            {canEdit && <th style={{ padding: "8px 12px" }}></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isEditing = editingId === r.id
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                {isEditing ? (
                  <>
                    <td style={{ padding: "6px 12px" }}>
                      <input type="datetime-local" defaultValue={r.txn_at ? r.txn_at.slice(0, 16) : ""}
                        onChange={e => setEditDraft(d => ({ ...d, txn_at: e.target.value }))}
                        style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                    </td>
                    <td style={{ padding: "6px 12px" }}>
                      <input defaultValue={r.merchant || ""} onChange={e => setEditDraft(d => ({ ...d, merchant: e.target.value }))}
                        style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 6px", fontSize: 12, width: "100%" }} />
                    </td>
                    <td style={{ padding: "6px 12px" }}>
                      <input defaultValue={r.card_last4 || ""} maxLength={4} onChange={e => setEditDraft(d => ({ ...d, card_last4: e.target.value }))}
                        style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 6px", fontSize: 12, width: 60 }} />
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "right" }}>
                      <input defaultValue={String(r.amount)} onChange={e => setEditDraft(d => ({ ...d, amount: e.target.value as any }))}
                        style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 6px", fontSize: 12, width: 100, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "6px 12px", color: "#6b7280" }}>{r.parsed_by}</td>
                    <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
                      <button onClick={() => saveEdit(r.id)} style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12, marginRight: 6 }}>Lưu</button>
                      <button onClick={() => setEditingId(null)} style={{ background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Hủy</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "8px 12px" }}>{fmtDateTime(r.txn_at)}</td>
                    <td style={{ padding: "8px 12px" }}>{r.merchant || "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{r.card_last4 ? `**** ${r.card_last4}` : "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#dc2626" }}>{fmtMoney(r.amount)}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280" }}>{r.parsed_by === "manual" ? "Thủ công" : r.parsed_by === "regex" ? "Tự động" : r.parsed_by}</td>
                    {canEdit && (
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        <button onClick={() => { setEditingId(r.id); setEditDraft({}) }} style={{ background: "none", border: "none", cursor: "pointer", color: "#1d4ed8", fontSize: 12, marginRight: 10 }}>Sửa</button>
                        <button onClick={() => removeRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 12 }}>Xóa</button>
                      </td>
                    )}
                  </>
                )}
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={canEdit ? 6 : 5} style={{ padding: 24, textAlign: "center", color: "#9ca3af" }}>Không có giao dịch nào trong khoảng thời gian này</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Chi phí kế toán", rank: 3,
})

export default withRouteGuard(ChiPhiKeToanPage)
