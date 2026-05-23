import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"

const MKT_LIST = ["KIENLB", "ANHNT", "XUANLT", "NAMDV", "DUPD", "LINHMT", "NGUYEN MAI"]

const inputStyle = {
  background: "#0f0f1a",
  border: "1px solid #374151",
  borderRadius: 6,
  padding: "6px 10px",
  color: "#f9fafb",
  fontSize: 13,
  width: "100%",
}

const btnStyle = (color = "#1d4ed8") => ({
  background: color,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap" as const,
})

export default function FbAccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form thêm mới
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")
  const [newMkt, setNewMkt] = useState("")
  const [newNote, setNewNote] = useState("")
  const [addError, setAddError] = useState("")

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/fb-accounts")
      const data = await res.json()
      setAccounts(data.accounts ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  const handleAdd = async () => {
    setAddError("")
    if (!newId.trim()) { setAddError("Nhập Account ID"); return }
    setSaving(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/fb-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: newId.trim(), account_name: newName.trim(), mkt_name: newMkt.trim(), note: newNote.trim() }),
      })
      const data = await res.json()
      if (data.error) { setAddError(data.error); return }
      setNewId(""); setNewName(""); setNewMkt(""); setNewNote("")
      await fetchAccounts()
    } catch (e: any) {
      setAddError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (acc: any) => {
    await apiFetch(`/admin/pancake-sync/fb-accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !acc.active }),
    })
    await fetchAccounts()
  }

  const handleDelete = async (acc: any) => {
    if (!confirm(`Xóa tài khoản ${acc.account_id}?`)) return
    await apiFetch(`/admin/pancake-sync/fb-accounts/${acc.id}`, { method: "DELETE" })
    await fetchAccounts()
  }

  const handleUpdateField = async (acc: any, field: string, value: string) => {
    await apiFetch(`/admin/pancake-sync/fb-accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    })
    await fetchAccounts()
  }

  return (
    <div style={{ padding: "24px 32px", background: "#0f0f1a", minHeight: "100vh", color: "#f9fafb" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Cài đặt tài khoản Facebook Ads</h1>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Quản lý danh sách ad accounts dùng để pull chi phí cho báo cáo MKT.
          Token FB cấu hình trong Railway env <code style={{ background: "#1a1a2e", padding: "1px 6px", borderRadius: 4 }}>FB_ACCESS_TOKEN</code>
        </div>
      </div>

      {/* Form thêm mới */}
      <div style={{ background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#d1d5db", marginBottom: 14 }}>+ Thêm tài khoản mới</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1.5fr 2fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Account ID *</div>
            <input
              style={inputStyle}
              placeholder="act_853668653182772 hoặc 853668653182772"
              value={newId}
              onChange={e => setNewId(e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Tên tài khoản</div>
            <input style={inputStyle} placeholder="PHV - Ads298 - ..." value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>MKT phụ trách</div>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={newMkt}
              onChange={e => setNewMkt(e.target.value)}
            >
              <option value="">-- Tự động từ camp --</option>
              {MKT_LIST.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Ghi chú</div>
            <input style={inputStyle} placeholder="FULLVIA_ANHTD..." value={newNote} onChange={e => setNewNote(e.target.value)} />
          </div>
          <button onClick={handleAdd} disabled={saving} style={btnStyle()}>
            {saving ? "..." : "Thêm"}
          </button>
        </div>
        {addError && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{addError}</div>}
      </div>

      {/* Danh sách */}
      {loading ? (
        <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Đang tải...</div>
      ) : accounts.length === 0 ? (
        <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chưa có tài khoản nào. Thêm ở trên.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #374151", color: "#9ca3af" }}>
                {["Trạng thái", "Account ID", "Tên tài khoản", "MKT phụ trách", "Ghi chú", ""].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <AccountRow key={acc.id} acc={acc} onToggle={handleToggle} onDelete={handleDelete} onUpdate={handleUpdateField} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AccountRow({ acc, onToggle, onDelete, onUpdate }: any) {
  const [editName, setEditName] = useState(acc.account_name)
  const [editMkt, setEditMkt] = useState(acc.mkt_name)
  const [editNote, setEditNote] = useState(acc.note)
  const [editing, setEditing] = useState(false)

  const handleSave = async () => {
    if (editName !== acc.account_name) await onUpdate(acc, "account_name", editName)
    if (editMkt !== acc.mkt_name) await onUpdate(acc, "mkt_name", editMkt)
    if (editNote !== acc.note) await onUpdate(acc, "note", editNote)
    setEditing(false)
  }

  const cellStyle = { padding: "10px 12px", borderBottom: "1px solid #1f2937", verticalAlign: "middle" as const }

  return (
    <tr style={{ opacity: acc.active ? 1 : 0.45 }}>
      <td style={cellStyle}>
        <button
          onClick={() => onToggle(acc)}
          style={{
            background: acc.active ? "#065f46" : "#1f2937",
            color: acc.active ? "#34d399" : "#6b7280",
            border: "none", borderRadius: 12, padding: "3px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600,
          }}
        >
          {acc.active ? "● Bật" : "○ Tắt"}
        </button>
      </td>
      <td style={{ ...cellStyle, color: "#60a5fa", fontFamily: "monospace" }}>{acc.account_id}</td>
      <td style={cellStyle}>
        {editing
          ? <input style={{ ...{ background: "#0f0f1a", border: "1px solid #374151", borderRadius: 4, padding: "4px 8px", color: "#f9fafb", fontSize: 12 }, width: 200 }} value={editName} onChange={e => setEditName(e.target.value)} />
          : <span style={{ color: "#d1d5db" }}>{acc.account_name || <span style={{ color: "#374151" }}>—</span>}</span>
        }
      </td>
      <td style={cellStyle}>
        {editing
          ? (
            <select style={{ background: "#0f0f1a", border: "1px solid #374151", borderRadius: 4, padding: "4px 8px", color: "#f9fafb", fontSize: 12 }} value={editMkt} onChange={e => setEditMkt(e.target.value)}>
              <option value="">Tự động</option>
              {["KIENLB", "ANHNT", "XUANLT", "NAMDV", "DUPD", "LINHMT"].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )
          : <span style={{ color: acc.mkt_name ? "#a78bfa" : "#374151", fontWeight: acc.mkt_name ? 600 : 400 }}>{acc.mkt_name || "Tự động"}</span>
        }
      </td>
      <td style={cellStyle}>
        {editing
          ? <input style={{ background: "#0f0f1a", border: "1px solid #374151", borderRadius: 4, padding: "4px 8px", color: "#f9fafb", fontSize: 12, width: 180 }} value={editNote} onChange={e => setEditNote(e.target.value)} />
          : <span style={{ color: "#9ca3af" }}>{acc.note || "—"}</span>
        }
      </td>
      <td style={{ ...cellStyle, display: "flex", gap: 6 }}>
        {editing ? (
          <>
            <button onClick={handleSave} style={{ ...{ background: "#065f46", color: "#34d399", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 } }}>Lưu</button>
            <button onClick={() => { setEditing(false); setEditName(acc.account_name); setEditMkt(acc.mkt_name); setEditNote(acc.note) }} style={{ background: "#1f2937", color: "#9ca3af", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Hủy</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} style={{ background: "#1e3a5f", color: "#60a5fa", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Sửa</button>
            <button onClick={() => onDelete(acc)} style={{ background: "#3b0d0d", color: "#f87171", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Xóa</button>
          </>
        )}
      </td>
    </tr>
  )
}

export const config = defineRouteConfig({
  label: "FB Ads Accounts",
})
