import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useCallback } from "react"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

// ─── Types ───────────────────────────────────────────────────────────────────

interface SheetColumn {
  id: string
  position: number
  name: string
  col_type: "text" | "number"
  width: number
}

interface SheetRow {
  id: string
  position: number
  data: Record<string, string>
  _dirty?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNumber(v: string): string {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""))
  if (isNaN(n)) return v
  return new Intl.NumberFormat("vi-VN").format(n)
}

function parseViNum(s: string): string {
  // Chuẩn hóa về dạng plain number string cho số vi-VN (1.234.567 → 1234567)
  return s.replace(/\./g, "").replace(",", ".")
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

function Cell({
  value, colType, readOnly, onCommit, onFocus, onNav, inputRef,
}: {
  value: string
  colType: "text" | "number"
  readOnly: boolean
  onCommit: (v: string) => void
  onFocus: () => void
  onNav: (dir: "left" | "right" | "up" | "down" | "tab") => void
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  function startEdit() {
    if (readOnly) return
    onFocus()
    setDraft(value)
    setEditing(true)
    setTimeout(() => ref.current?.select(), 0)
  }

  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }

  const display = !editing && colType === "number" && value ? fmtNumber(value) : (editing ? draft : value)

  return (
    <div
      style={{
        width: "100%", height: "100%", position: "relative",
        background: "transparent",
      }}
      onDoubleClick={startEdit}
    >
      {editing ? (
        <input
          ref={el => { (ref as any).current = el; inputRef?.(el) }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") { commit(); onNav("down") }
            else if (e.key === "Escape") { setDraft(value); setEditing(false) }
            else if (e.key === "Tab") { e.preventDefault(); commit(); onNav("tab") }
            else if (e.key === "ArrowRight" && ref.current && ref.current.selectionStart === draft.length) { commit(); onNav("right") }
            else if (e.key === "ArrowLeft" && ref.current && ref.current.selectionStart === 0) { commit(); onNav("left") }
            else if (e.key === "ArrowUp") { commit(); onNav("up") }
            else if (e.key === "ArrowDown") { commit(); onNav("down") }
          }}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            border: "2px solid #7c3aed", borderRadius: 2,
            padding: "0 4px", fontSize: 12, fontFamily: "inherit",
            outline: "none", background: "#fff", zIndex: 2,
            textAlign: colType === "number" ? "right" : "left",
            boxSizing: "border-box",
          }}
        />
      ) : (
        <div
          onClick={startEdit}
          onFocus={() => { onFocus(); startEdit() }}
          tabIndex={readOnly ? -1 : 0}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === "F2") startEdit()
            else if (e.key === "Tab") { e.preventDefault(); onNav("tab") }
            else if (e.key === "ArrowRight") onNav("right")
            else if (e.key === "ArrowLeft") onNav("left")
            else if (e.key === "ArrowUp") onNav("up")
            else if (e.key === "ArrowDown") onNav("down")
            else if (!readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
              setDraft(e.key); setEditing(true)
              setTimeout(() => { if (ref.current) { ref.current.value = e.key; ref.current.setSelectionRange(1,1) } }, 0)
            }
          }}
          style={{
            width: "100%", height: "100%",
            padding: "0 4px", fontSize: 12,
            display: "flex", alignItems: "center",
            justifyContent: colType === "number" ? "flex-end" : "flex-start",
            cursor: readOnly ? "default" : "text",
            userSelect: "none",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            outline: "none",
            boxSizing: "border-box",
          }}
        >
          {display}
        </div>
      )}
    </div>
  )
}

// ─── AddColumnModal ────────────────────────────────────────────────────────────

function AddColumnModal({ onAdd, onClose }: {
  onAdd: (name: string, type: "text" | "number") => void
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [type, setType] = useState<"text" | "number">("text")

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: 340, boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Thêm cột mới</div>
        <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 4 }}>Tên cột</label>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && onAdd(name.trim(), type)}
          placeholder="Ví dụ: Phí kho..."
          style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 13, marginBottom: 12, boxSizing: "border-box", outline: "none" }}
        />
        <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 4 }}>Loại dữ liệu</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["text", "number"] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: `2px solid ${type === t ? "#7c3aed" : "#e5e7eb"}`, background: type === t ? "#ede9fe" : "#fff", color: type === t ? "#7c3aed" : "#374151", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
              {t === "text" ? "📝 Văn bản" : "🔢 Số"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => name.trim() && onAdd(name.trim(), type)}
            disabled={!name.trim()}
            style={{ flex: 1, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, padding: "9px 0", fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed", fontSize: 13 }}>
            Thêm cột
          </button>
          <button onClick={onClose}
            style={{ padding: "9px 16px", border: "1px solid #e5e7eb", borderRadius: 7, background: "#fff", cursor: "pointer", fontSize: 13 }}>
            Hủy
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Spreadsheet ──────────────────────────────────────────────────────────────

function Spreadsheet({ canManage }: { canManage: boolean }) {
  const [columns, setColumns] = useState<SheetColumn[]>([])
  const [rows, setRows] = useState<SheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [showAddCol, setShowAddCol] = useState(false)

  // focusedCell: [rowIdx, colIdx] trong mảng hiển thị
  const [focused, setFocused] = useState<[number, number] | null>(null)
  const focusedRef = useRef<[number, number] | null>(null)

  const dirtyRef = useRef<Map<string, SheetRow>>(new Map()) // id → row
  const saveTimerRef = useRef<any>(null)
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map()) // "ri,ci" → input
  const rowsRef = useRef<SheetRow[]>([])
  const colsRef = useRef<SheetColumn[]>([])

  // Sync refs để paste handler luôn có data mới nhất
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { colsRef.current = columns }, [columns])
  useEffect(() => { focusedRef.current = focused }, [focused])

  // Load
  useEffect(() => {
    setLoading(true)
    apiJson("/admin/gia-von/sheet", "GET")
      .then(d => {
        setColumns(d.columns ?? [])
        setRows(d.rows ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Global paste listener — bắt Ctrl+V dù input nào đang focus
  useEffect(() => {
    if (!canManage) return
    async function onPaste(e: ClipboardEvent) {
      // Chỉ xử lý khi có cell đang focused
      const fc = focusedRef.current
      if (!fc) return
      const text = e.clipboardData?.getData("text/plain")
      if (!text) return
      e.preventDefault()

      const [startRi, startCi] = fc
      const currentRows = rowsRef.current
      const currentCols = colsRef.current

      const pasteRows = text
        .split("\n")
        .map(r => r.replace(/\r$/, "").split("\t"))
      // Bỏ dòng cuối nếu rỗng (GG Sheets hay thêm \n cuối)
      if (pasteRows.length > 1 && pasteRows[pasteRows.length - 1].every(c => !c)) {
        pasteRows.pop()
      }
      if (!pasteRows.length) return

      let allRows = currentRows
      const needed = (startRi + pasteRows.length) - currentRows.length
      if (needed > 0) {
        const d = await apiJson("/admin/gia-von/sheet/rows", "POST", { count: needed })
        allRows = [...currentRows, ...(d.rows ?? [])]
        setRows(allRows)
      }

      const updates: { id: string; data: Record<string, string> }[] = []
      for (let ri = 0; ri < pasteRows.length; ri++) {
        const rowIdx = startRi + ri
        if (rowIdx >= allRows.length) break
        const row = allRows[rowIdx]
        const newData = { ...row.data }
        for (let ci = 0; ci < pasteRows[ri].length; ci++) {
          const colIdx = startCi + ci
          if (colIdx >= currentCols.length) break
          newData[currentCols[colIdx].id] = pasteRows[ri][ci]
        }
        updates.push({ id: row.id, data: newData })
      }

      setRows(rs => rs.map(r => {
        const u = updates.find(u => u.id === r.id)
        return u ? { ...r, data: u.data } : r
      }))

      setSaveState("saving")
      try {
        await apiJson("/admin/gia-von/sheet/rows", "PUT", { rows: updates })
        setSaveState("saved")
        setTimeout(() => setSaveState("idle"), 2000)
      } catch {
        setSaveState("error")
      }
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [canManage])

  // Autosave debounce
  function scheduleSave() {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(flushSave, 800)
  }

  async function flushSave() {
    if (dirtyRef.current.size === 0) return
    const toSave = Array.from(dirtyRef.current.values()).map(r => ({ id: r.id, data: r.data }))
    dirtyRef.current.clear()
    setSaveState("saving")
    try {
      await apiJson("/admin/gia-von/sheet/rows", "PUT", { rows: toSave })
      setSaveState("saved")
      setTimeout(() => setSaveState("idle"), 2000)
    } catch {
      setSaveState("error")
    }
  }

  function updateCell(rowId: string, colId: string, value: string) {
    setRows(rs => rs.map(r => {
      if (r.id !== rowId) return r
      const updated = { ...r, data: { ...r.data, [colId]: value }, _dirty: true }
      dirtyRef.current.set(rowId, updated)
      return updated
    }))
    scheduleSave()
  }

  async function addRow(count = 1) {
    try {
      const d = await apiJson("/admin/gia-von/sheet/rows", "POST", { count })
      setRows(rs => [...rs, ...(d.rows ?? [])])
    } catch (e: any) {
      alert("Lỗi thêm dòng: " + e.message)
    }
  }

  async function deleteRow(id: string) {
    if (!confirm("Xóa dòng này?")) return
    try {
      await apiJson(`/admin/gia-von/sheet/rows/${id}`, "DELETE")
      setRows(rs => rs.filter(r => r.id !== id))
    } catch (e: any) {
      alert("Lỗi xóa: " + e.message)
    }
  }

  async function addColumn(name: string, type: "text" | "number") {
    setShowAddCol(false)
    try {
      const d = await apiJson("/admin/gia-von/sheet/columns", "POST", { name, col_type: type })
      setColumns(cs => [...cs, d.column])
    } catch (e: any) {
      alert("Lỗi thêm cột: " + e.message)
    }
  }

  async function deleteColumn(col: SheetColumn) {
    if (!confirm(`Xóa cột "${col.name}"? Dữ liệu trong cột này sẽ mất.`)) return
    try {
      await apiJson(`/admin/gia-von/sheet/columns/${col.id}`, "DELETE")
      setColumns(cs => cs.filter(c => c.id !== col.id))
    } catch (e: any) {
      alert("Lỗi xóa cột: " + e.message)
    }
  }

  async function renameColumn(col: SheetColumn, newName: string) {
    if (!newName.trim() || newName === col.name) return
    try {
      const d = await apiJson(`/admin/gia-von/sheet/columns/${col.id}`, "PUT", { name: newName.trim() })
      setColumns(cs => cs.map(c => c.id === col.id ? d.column : c))
    } catch (e: any) {
      alert("Lỗi đổi tên: " + e.message)
    }
  }

  function navigate(ri: number, ci: number, dir: "left" | "right" | "up" | "down" | "tab") {
    let nri = ri, nci = ci
    if (dir === "right" || dir === "tab") nci = Math.min(ci + 1, columns.length - 1)
    else if (dir === "left") nci = Math.max(ci - 1, 0)
    else if (dir === "down") nri = Math.min(ri + 1, rows.length - 1)
    else if (dir === "up") nri = Math.max(ri - 1, 0)
    setFocused([nri, nci])
    const key = `${nri},${nci}`
    setTimeout(() => cellRefs.current.get(key)?.focus(), 0)
  }

  if (loading) return <div style={{ padding: 40, color: "#9ca3af", fontSize: 14 }}>Đang tải…</div>

  const ROW_H = 28
  const NUM_COL_W = 40

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        {canManage && (
          <>
            <button onClick={() => addRow(1)}
              style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              + Thêm dòng
            </button>
            <button onClick={() => setShowAddCol(true)}
              style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#7c3aed" }}>
              + Thêm cột
            </button>
            <button onClick={() => addRow(10)}
              style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 12px", cursor: "pointer", fontSize: 12, color: "#6b7280" }}>
              +10 dòng
            </button>
          </>
        )}
        <div style={{ marginLeft: "auto", fontSize: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: "#9ca3af" }}>{rows.length} dòng · {columns.length} cột</span>
          {saveState === "saving" && <span style={{ color: "#d97706" }}>⏳ Đang lưu…</span>}
          {saveState === "saved" && <span style={{ color: "#16a34a" }}>✓ Đã lưu</span>}
          {saveState === "error" && <span style={{ color: "#dc2626" }}>✗ Lỗi lưu</span>}
        </div>
      </div>

      {/* Sheet */}
      <div style={{ flex: 1, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: NUM_COL_W + columns.reduce((s, c) => s + c.width, 0) }}>
          <colgroup>
            <col style={{ width: NUM_COL_W }} />
            {columns.map(c => <col key={c.id} style={{ width: c.width }} />)}
            {canManage && <col style={{ width: 32 }} />}
          </colgroup>
          <thead>
            <tr>
              {/* Row number header */}
              <th style={thS(NUM_COL_W)}></th>

              {columns.map((col) => (
                <ColumnHeader key={col.id} col={col} canManage={canManage}
                  onDelete={() => deleteColumn(col)}
                  onRename={n => renameColumn(col, n)}
                />
              ))}

              {canManage && <th style={thS(32)}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "32px 0" }}>
                  Bảng trống — bấm "+ Thêm dòng" hoặc paste dữ liệu từ Excel/GG Sheets
                </td>
              </tr>
            ) : rows.map((row, ri) => (
              <tr key={row.id} style={{ height: ROW_H, background: ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                {/* Row number */}
                <td style={{ ...tdS(NUM_COL_W), textAlign: "center", color: "#9ca3af", fontSize: 11, background: "#f9fafb", borderRight: "2px solid #e5e7eb", userSelect: "none" }}>
                  {ri + 1}
                </td>

                {columns.map((col, ci) => (
                  <td key={col.id}
                    style={{ ...tdS(col.width), position: "relative", padding: 0 }}
                  >
                    <Cell
                      value={row.data[col.id] ?? ""}
                      colType={col.col_type}
                      readOnly={!canManage}
                      onCommit={v => updateCell(row.id, col.id, v)}
                      onFocus={() => setFocused([ri, ci])}
                      onNav={dir => navigate(ri, ci, dir)}
                      inputRef={el => {
                        const key = `${ri},${ci}`
                        if (el) cellRefs.current.set(key, el)
                        else cellRefs.current.delete(key)
                      }}
                    />
                  </td>
                ))}

                {canManage && (
                  <td style={{ ...tdS(32), textAlign: "center", padding: 0 }}>
                    <button onClick={() => deleteRow(row.id)}
                      title="Xóa dòng"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#d1d5db", fontSize: 13, padding: "0 4px", lineHeight: 1 }}
                      onMouseOver={e => (e.currentTarget.style.color = "#dc2626")}
                      onMouseOut={e => (e.currentTarget.style.color = "#d1d5db")}
                    >✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && rows.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
          Tip: Paste trực tiếp từ Excel / GG Sheets (Ctrl+V) vào bất kỳ ô nào để điền hàng loạt.
        </div>
      )}

      {showAddCol && <AddColumnModal onAdd={addColumn} onClose={() => setShowAddCol(false)} />}
    </div>
  )
}

// ─── ColumnHeader (inline rename) ─────────────────────────────────────────────

function ColumnHeader({ col, canManage, onDelete, onRename }: {
  col: SheetColumn
  canManage: boolean
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(col.name)

  useEffect(() => setDraft(col.name), [col.name])

  function commit() {
    setEditing(false)
    onRename(draft)
  }

  return (
    <th style={{ ...thS(col.width), position: "relative", userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: col.col_type === "number" ? "flex-end" : "flex-start" }}>
        {editing ? (
          <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(col.name); setEditing(false) } }}
            style={{ flex: 1, border: "1px solid #a78bfa", borderRadius: 4, padding: "2px 5px", fontSize: 11, fontWeight: 700, outline: "none", minWidth: 0 }}
          />
        ) : (
          <span
            onDoubleClick={canManage ? () => setEditing(true) : undefined}
            title={canManage ? "Double-click để đổi tên" : col.name}
            style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: canManage ? "pointer" : "default" }}
          >
            {col.col_type === "number" ? <span style={{ color: "#9ca3af", marginRight: 3, fontSize: 9 }}>🔢</span> : null}
            {col.name}
          </span>
        )}
        {canManage && !editing && (
          <button onClick={onDelete}
            title="Xóa cột"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#d1d5db", fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}
            onMouseOver={e => (e.currentTarget.style.color = "#dc2626")}
            onMouseOut={e => (e.currentTarget.style.color = "#d1d5db")}
          >✕</button>
        )}
      </div>
    </th>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

function thS(w: number): React.CSSProperties {
  return {
    padding: "5px 6px",
    borderRight: "1px solid #e5e7eb",
    borderBottom: "2px solid #d1d5db",
    background: "#f3f4f6",
    fontSize: 11, fontWeight: 700, color: "#374151",
    whiteSpace: "nowrap",
    width: w, minWidth: w,
    position: "sticky", top: 0, zIndex: 10,
    boxSizing: "border-box",
  }
}

function tdS(w: number): React.CSSProperties {
  return {
    borderRight: "1px solid #f3f4f6",
    borderBottom: "1px solid #f3f4f6",
    width: w, minWidth: w,
    height: 28,
    verticalAlign: "middle",
    padding: 0,
    boxSizing: "border-box",
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GiaVonPage() {
  const { has, loading } = useCurrentPermissions()
  const canManage = has("page.gia-von.manage")

  // Chờ permissions load xong mới render — tránh flash "read-only" rồi switch sang "editable"
  if (loading) {
    return <div style={{ padding: 40, color: "#9ca3af", fontSize: 14 }}>Đang tải quyền truy cập…</div>
  }

  return (
    <div style={{ padding: "20px 24px", maxWidth: "100%", height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#111827" }}>Bảng giá vốn</h1>
        <p style={{ fontSize: 12, color: "#9ca3af", margin: "3px 0 0" }}>
          Double-click ô để sửa · Double-click tên cột để đổi tên · Paste từ Excel/GG Sheets trực tiếp
          {canManage ? "" : " · (chỉ xem)"}
        </p>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Spreadsheet canManage={canManage} />
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Giá vốn",
})
