import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect } from "react"
import { apiFetch } from "../../lib/api-client"
import { VideoSection, type VideoRow } from "../../components/marketing-hub/video-section"
import { FbContentSection, type FbPrefill } from "../../components/marketing-hub/fb-content-section"
import { HieuQuaSection } from "../../components/marketing-hub/hieu-qua-section"
import { QuanLyPageTab } from "../../components/marketing-hub/quan-ly-page-tab"
import { AudienceTab } from "../../components/marketing-hub/audience-tab"
import { useCurrentPermissions } from "../../lib/use-permissions"

function ProductsTab() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState({ name: "", code: "" })
  const [newForm, setNewForm] = useState({ name: "", code: "" })
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    apiFetch("/admin/marketing-video/products").then(r => r.json()).then(d => setProducts(d.products ?? [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const sync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const r = await apiFetch("/admin/marketing-video/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) }).then(r => r.json())
      setMsg(r.ok ? `Đã sync ${r.synced ?? r.total ?? "?"} sản phẩm từ Pancake` : `Lỗi: ${r.error || "unknown"}`)
      load()
    } catch { setMsg("Sync thất bại") }
    finally { setSyncing(false) }
  }

  const saveEdit = async (id: number) => {
    await apiFetch(`/admin/marketing-video/products/${id}`, { method: "PATCH", body: JSON.stringify(editDraft) })
    setEditId(null); load()
  }

  const del = async (id: number) => {
    if (!confirm("Xóa sản phẩm này?")) return
    await apiFetch(`/admin/marketing-video/products/${id}`, { method: "DELETE" })
    load()
  }

  const addNew = async () => {
    if (!newForm.name.trim()) return
    await apiFetch("/admin/marketing-video/products", { method: "POST", body: JSON.stringify(newForm) })
    setNewForm({ name: "", code: "" }); load()
  }

  const inp: React.CSSProperties = { border: "1px solid #D1D5DB", borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%" }
  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "#6B7280", borderBottom: "2px solid #E5E7EB", background: "#F9FAFB", whiteSpace: "nowrap" }
  const td: React.CSSProperties = { padding: "9px 12px", fontSize: 13, borderBottom: "1px solid #F3F4F6", verticalAlign: "middle" }

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Danh mục Sản phẩm</h2>
        <button onClick={sync} disabled={syncing} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#1877F2", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: syncing ? 0.6 : 1 }}>
          {syncing ? "Đang sync..." : "↻ Sync từ Pancake"}
        </button>
        {msg && <span style={{ fontSize: 12, color: "#16A34A" }}>{msg}</span>}
        <span style={{ fontSize: 12, color: "#6B7280", marginLeft: "auto" }}>{products.length} sản phẩm</span>
      </div>

      {/* Form thêm thủ công */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end" }}>
        <div style={{ flex: 2 }}>
          <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 3 }}>Tên SP</div>
          <input style={inp} placeholder="Tên sản phẩm..." value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 3 }}>Mã SP</div>
          <input style={inp} placeholder="VD: PHVVN036NC" value={newForm.code} onChange={e => setNewForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
        </div>
        <button onClick={addNew} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#7C3AED", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>+ Thêm</button>
      </div>

      {loading ? <div style={{ color: "#6B7280", padding: 20 }}>Đang tải...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Tên sản phẩm</th>
              <th style={th}>Mã SP</th>
              <th style={th}>Pancake ID</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={p.id}>
                <td style={{ ...td, color: "#9CA3AF", width: 40 }}>{i + 1}</td>
                <td style={td}>
                  {editId === p.id
                    ? <input style={inp} value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} />
                    : p.name}
                </td>
                <td style={td}>
                  {editId === p.id
                    ? <input style={{ ...inp, width: 140, fontFamily: "monospace" }} value={editDraft.code} onChange={e => setEditDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))} />
                    : <code style={{ background: "#F3F4F6", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>{p.code || "—"}</code>}
                </td>
                <td style={{ ...td, color: "#9CA3AF", fontSize: 12 }}>{p.pancake_id || "—"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {editId === p.id ? (
                    <>
                      <button onClick={() => saveEdit(p.id)} style={{ padding: "3px 10px", borderRadius: 5, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, cursor: "pointer", marginRight: 4 }}>Lưu</button>
                      <button onClick={() => setEditId(null)} style={{ padding: "3px 10px", borderRadius: 5, border: "1px solid #D1D5DB", background: "#fff", fontSize: 12, cursor: "pointer" }}>Hủy</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditId(p.id); setEditDraft({ name: p.name, code: p.code }) }} style={{ padding: "3px 10px", borderRadius: 5, border: "1px solid #D1D5DB", background: "#fff", fontSize: 12, cursor: "pointer", marginRight: 4 }}>Sửa</button>
                      <button onClick={() => del(p.id)} style={{ padding: "3px 10px", borderRadius: 5, border: "none", background: "#FEE2E2", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>Xóa</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#9CA3AF", padding: 32 }}>Chưa có SP nào — bấm "Sync từ Pancake" để tải về</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

const MarketingHubPage = () => {
  const parseHash = () => {
    const h = window.location.hash.replace("#", "")
    const [s, t] = h.split(":")
    return { section: s || "video", innerTab: t || "" }
  }
  const [section, setSection] = useState<string>(parseHash().section)
  const [fbInitialTab, setFbInitialTab] = useState<string>(parseHash().innerTab || "dangbai")
  const [prefill, setPrefill] = useState<FbPrefill>(null)
  const { isSuper, mktCode, has } = useCurrentPermissions()

  const changeSection = (s: string, innerTab?: string) => {
    const hash = innerTab ? `${s}:${innerTab}` : s
    history.replaceState(null, "", `#${hash}`)
    setSection(s)
    if (innerTab) setFbInitialTab(innerTab)
  }
  const canAudience = isSuper || has("page.fb-content.post")

  const onDangFB = (row: VideoRow) => {
    setPrefill({ videoId: row.id, driveUrl: row.link || "", sp: row.sp, vd: row.vdCode })
    changeSection("fb", "dangbai")
  }

  const tabs = [
    { id: "video",    label: "Nguyên liệu Video" },
    { id: "fb",       label: "Đăng Facebook" },
    { id: "hieuqua",  label: "Hiệu quả Video" },
    { id: "quanly",   label: "🗂 Quản lý Page" },
    ...(canAudience ? [{ id: "audience", label: "🎯 Tệp đối tượng" }] : []),
    ...(isSuper ? [{ id: "products", label: "📦 Danh mục SP" }] : []),
  ] as const

  return (
    <div style={{ background: "#F4F5F9", margin: -24, minHeight: "calc(100vh - 56px)" }}>
      {/* Tab cấp 1 */}
      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", background: "#FFFFFF", paddingLeft: 20, gap: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => changeSection(t.id)}
            style={{
              padding: "13px 20px", background: "none", border: "none", cursor: "pointer",
              fontSize: 14, fontWeight: section === t.id ? 700 : 500,
              color: section === t.id ? "#1877F2" : "#4B5563",
              borderBottom: section === t.id ? "2px solid #1877F2" : "2px solid transparent",
              marginBottom: -1, whiteSpace: "nowrap",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {section === "video"   && <VideoSection onDangFB={onDangFB} />}
      {section === "fb"      && <FbContentSection prefill={prefill} initialTab={fbInitialTab} />}
      {section === "hieuqua" && <HieuQuaSection />}
      {section === "quanly"  && <div style={{ padding: 20 }}><QuanLyPageTab /></div>}
      {section === "audience" && <div style={{ padding: 20 }}><AudienceTab isAdmin={isSuper} mktCode={mktCode} /></div>}
      {section === "products" && isSuper && <ProductsTab />}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Marketing Hub" })

export default MarketingHubPage
