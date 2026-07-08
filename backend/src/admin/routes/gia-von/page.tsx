import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
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

interface MktProduct {
  id: string
  name: string
  code: string
  pancake_id: string | null
  active: boolean
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
  value, colType, readOnly, onCommit, onFocus, onNav, inputRef, products, colId,
}: {
  value: string
  colType: "text" | "number"
  readOnly: boolean
  onCommit: (v: string) => void
  onFocus: () => void
  onNav: (dir: "left" | "right" | "up" | "down" | "tab") => void
  inputRef?: (el: HTMLInputElement | null) => void
  products?: MktProduct[]
  colId?: string
}) {
  // Cột SP (autocomplete): value lưu là code; resolve ngược ra tên để hiển thị cho dễ đọc.
  // Dữ liệu cũ có thể vẫn là tên text (chưa được chọn lại từ dropdown) — khi đó không match
  // được code nào trong `products` thì hiển thị/chỉnh sửa nguyên giá trị cũ.
  const resolvedName = products?.find(p => p.code.trim().toUpperCase() === value.trim().toUpperCase())?.name
  const editValue = resolvedName ?? value

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(editValue)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(editValue) }, [value])

  const filtered = products && draft
    ? products.filter(p => p.name.toLowerCase().includes(draft.toLowerCase()) || p.code.toLowerCase().includes(draft.toLowerCase()))
    : (products ?? [])

  function startEdit() {
    if (readOnly) return
    onFocus()
    setDraft(editValue)
    setEditing(true)
    setActiveIdx(-1)
    setTimeout(() => {
      ref.current?.select()
      updateDropdownPos()
    }, 0)
  }

  function updateDropdownPos() {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: Math.max(rect.width, 240) })
  }

  function commitValue(v: string) {
    setEditing(false)
    setDropdownPos(null)
    if (v !== value) onCommit(v)
  }

  function commit() {
    // Nếu user không gõ gì khác (draft vẫn là tên/giá trị hiển thị ban đầu) thì giữ nguyên
    // value gốc (code) — tránh việc tab/click qua ô ghi đè code bằng tên hiển thị.
    commitValue(draft === editValue ? value : draft)
  }

  const display = !editing && colType === "number" && value ? fmtNumber(value) : (editing ? draft : editValue)

  const dropdown = editing && products && dropdownPos && filtered.length > 0
    ? createPortal(
        <div
          onMouseDown={e => e.preventDefault()}
          style={{
            position: "absolute",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            maxHeight: 220,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            zIndex: 99999,
            fontSize: 12,
          }}
        >
          {filtered.map((p, i) => (
            <div
              key={p.id}
              onMouseDown={() => commitValue(p.code)}
              style={{
                padding: "6px 10px",
                cursor: "pointer",
                background: i === activeIdx ? "#ede9fe" : "#fff",
                borderBottom: "1px solid #f3f4f6",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span style={{ color: "#7c3aed", fontWeight: 700, minWidth: 90, fontSize: 11 }}>{p.code}</span>
              <span style={{ color: "#111827" }}>{p.name}</span>
            </div>
          ))}
        </div>,
        document.body
      )
    : null

  return (
    <div
      style={{
        width: "100%", height: "100%", position: "relative",
        background: "transparent",
      }}
      onDoubleClick={startEdit}
    >
      {editing ? (
        <>
          <input
            ref={el => { (ref as any).current = el; inputRef?.(el) }}
            value={draft}
            onChange={e => { setDraft(e.target.value); setActiveIdx(-1); updateDropdownPos() }}
            onBlur={commit}
            onKeyDown={e => {
              if (products && filtered.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); return }
                if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
                if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); commitValue(filtered[activeIdx].code); onNav("down"); return }
              }
              if (e.key === "Enter") { commit(); onNav("down") }
              else if (e.key === "Escape") { setDraft(editValue); setEditing(false); setDropdownPos(null) }
              else if (e.key === "Tab") { e.preventDefault(); commit(); onNav("tab") }
              else if (e.key === "ArrowRight" && ref.current && ref.current.selectionStart === draft.length) { commit(); onNav("right") }
              else if (e.key === "ArrowLeft" && ref.current && ref.current.selectionStart === 0) { commit(); onNav("left") }
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
          {dropdown}
        </>
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
  const [mktProducts, setMktProducts] = useState<MktProduct[]>([])

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

  // Load sheet + mkt_product list
  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiJson("/admin/gia-von/sheet", "GET"),
      apiJson("/admin/gia-von/products", "GET").catch(() => ({ products: [] })),
    ]).then(([sheet, prod]) => {
      setColumns(sheet.columns ?? [])
      setRows(sheet.rows ?? [])
      setMktProducts((prod.products ?? []).filter((p: MktProduct) => p.active !== false))
      setLoading(false)
    }).catch(() => setLoading(false))
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
      const newData = { ...r.data, [colId]: value }

      // Auto-tính các cột công thức khi D/E/F/G/H thay đổi
      const cols = colsRef.current
      const posToId = Object.fromEntries(cols.map(c => [c.position, c.id]))
      const idD = posToId[3], idE = posToId[4], idF = posToId[5]
      const idG = posToId[6], idH = posToId[7], idI = posToId[8], idJ = posToId[9]
      if (idD && idE && idF && idG && [idD, idE, idF].includes(colId)) {
        const D = parseFloat((newData[idD] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const E = parseFloat((newData[idE] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const F = parseFloat((newData[idF] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        // G = (E*D + F) * 8%
        const G = Math.round((E * D + F) * 0.08)
        newData[idG] = G > 0 ? String(G) : ""
      }
      // I = (E*D) + F + G + H  |  J = I/D  — trigger khi D/E/F/G/H thay đổi
      if (idD && idE && idF && idG && idH && idI && idJ && [idD, idE, idF, idG, idH].includes(colId)) {
        const D = parseFloat((newData[idD] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const E = parseFloat((newData[idE] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const F = parseFloat((newData[idF] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const G = parseFloat((newData[idG] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const H = parseFloat((newData[idH] ?? "").replace(/\./g, "").replace(",", ".")) || 0
        const I = Math.round(E * D + F + G + H)
        newData[idI] = I > 0 ? String(I) : ""
        const J = D > 0 ? Math.round(I / D) : 0
        newData[idJ] = J > 0 ? String(J) : ""
      }

      const updated = { ...r, data: newData, _dirty: true }
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

                {columns.map((col, ci) => {
                  const isProductCol = col.position === 10
                  return (
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
                      products={isProductCol ? mktProducts : undefined}
                      colId={isProductCol ? col.id : undefined}
                    />
                  </td>
                  )
                })}

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

// ─── Summary Tab ─────────────────────────────────────────────────────────────

function parseNum(s: string): number {
  if (!s) return 0
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0
}

function SummaryTab() {
  const [items, setItems] = useState<{
    ten: string; tinhChat: string; nhom: string; soLuong: number; tongTien: number
  }[]>([])
  const [mktProducts, setMktProducts] = useState<MktProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    apiJson("/admin/gia-von/products", "GET").then((d) => {
      setMktProducts((d.products ?? []).filter((p: MktProduct) => p.active !== false))
    }).catch(() => {})
    apiJson("/admin/gia-von/sheet", "GET").then((sheet) => {
      const cols: SheetColumn[] = sheet.columns ?? []
      const rows: SheetRow[] = sheet.rows ?? []
      if (rows.length < 2) { setLoading(false); return }

      const headerRow = rows[0].data
      const headerToId: Record<string, string> = {}
      for (const [colId, val] of Object.entries(headerRow)) {
        if (val) headerToId[val.trim()] = colId
      }
      const posToId: Record<number, string> = {}
      for (const c of cols) posToId[c.position] = c.id

      const colSanPham = headerToId["Sản phẩm"] ?? posToId[1]
      const colTinhChat = headerToId["Tính chất"] ?? posToId[2]
      const colSoLuong = headerToId["Số lượng"] ?? posToId[3]
      const colTongTien = headerToId["Tổng tiền"] ?? posToId[8]
      // Cột K (pos 10) = nhóm sản phẩm (product autocomplete)
      const colNhom = posToId[10]

      const dataRows = rows.slice(1).filter(r => r.data[colSanPham]?.trim())

      setItems(dataRows.map(r => ({
        ten: r.data[colSanPham]?.trim() ?? "",
        tinhChat: r.data[colTinhChat]?.trim() ?? "",
        nhom: (colNhom ? r.data[colNhom]?.trim() : "") ?? "",
        soLuong: parseNum(r.data[colSoLuong] ?? ""),
        tongTien: parseNum(r.data[colTongTien] ?? ""),
      })))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const fmt = (n: number) => n > 0 ? new Intl.NumberFormat("vi-VN").format(Math.round(n)) : "—"

  // Group theo nhóm (cột K) — nếu không có nhóm thì group theo tên SP chính
  // Chỉ hiển thị SP chính, phụ kiện cùng nhóm được cộng tổng tiền vào
  const allItems = items.filter(i =>
    !search || i.ten.toLowerCase().includes(search.toLowerCase()) || i.nhom.toLowerCase().includes(search.toLowerCase())
  )

  // Build nhóm → { chinh, phuKien[] }
  type Group = { tenChinh: string; nhom: string; soLuong: number; tongTienChinh: number; tongTienPhuKien: number; tenPhuKien: string[] }
  const groupMap: Record<string, Group> = {}

  for (const i of allItems) {
    // Key group: ưu tiên nhóm (K), fallback tên SP
    const key = i.nhom || i.ten
    if (!groupMap[key]) {
      groupMap[key] = { tenChinh: "", nhom: i.nhom, soLuong: 0, tongTienChinh: 0, tongTienPhuKien: 0, tenPhuKien: [] }
    }
    const g = groupMap[key]
    if (i.tinhChat === "Sản phẩm chính") {
      g.tenChinh = i.ten
      g.soLuong += i.soLuong
      g.tongTienChinh += i.tongTien
    } else {
      g.tongTienPhuKien += i.tongTien
      if (i.ten && !g.tenPhuKien.includes(i.ten)) g.tenPhuKien.push(i.ten)
    }
  }

  // Khớp mã SP — đúng logic computeAvgCost ở backend (avg-cost/route.ts):
  // ưu tiên cột K là mã hợp lệ (đã chọn lại từ dropdown), fallback so tên SP chính với mkt_product.
  const codeSet = new Set(mktProducts.map(p => p.code.trim().toUpperCase()).filter(Boolean))
  const nameToCode: Record<string, string> = {}
  for (const p of mktProducts) {
    if (p.name && p.code) nameToCode[p.name.trim().toUpperCase()] = p.code
  }

  const summary = Object.values(groupMap)
    .filter(g => g.tenChinh || g.soLuong > 0)
    .map(g => {
      const tongTienTong = g.tongTienChinh + g.tongTienPhuKien
      const giaTB = g.soLuong > 0 ? tongTienTong / g.soLuong : 0
      const tenChinh = g.tenChinh || g.nhom
      const nhomUpper = g.nhom.trim().toUpperCase()
      const matchedCode = (nhomUpper && codeSet.has(nhomUpper))
        ? nhomUpper
        : nameToCode[nhomUpper] ?? nameToCode[tenChinh.toUpperCase()]
      return { ...g, tongTienTong, giaTB, matchedCode }
    })
    .sort((a, b) => b.giaTB - a.giaTB)

  if (loading) return <div style={{ padding: 40, color: "#9ca3af", fontSize: 14 }}>Đang tải…</div>

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Tìm sản phẩm..."
          style={{ border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 12px", fontSize: 13, width: 280, outline: "none" }}
        />
        <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{summary.length} sản phẩm</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["#", "Sản phẩm", "Mã SP (khớp LNG)", "SL sp chính (D)", "Tổng tiền sp chính", "Tổng tiền phụ kiện", "Tổng cộng", "Giá TB/sp"].map((h, i) => (
                <th key={i} style={{ padding: "8px 10px", borderBottom: "2px solid #e5e7eb", background: "#f9fafb", textAlign: i >= 3 ? "right" : "left", fontWeight: 700, color: "#374151", whiteSpace: "nowrap", position: "sticky", top: 0 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map((s, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ padding: "7px 10px", color: "#9ca3af", width: 36 }}>{idx + 1}</td>
                <td style={{ padding: "7px 10px", color: "#111827" }}>
                  <div style={{ fontWeight: 600 }}>{s.tenChinh || s.nhom}</div>
                  {s.tenPhuKien.length > 0 && (
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>+ {s.tenPhuKien.join(", ")}</div>
                  )}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {s.matchedCode ? (
                    <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 12 }}>{s.matchedCode}</span>
                  ) : (
                    <span style={{ color: "#dc2626", fontWeight: 600, fontSize: 11 }}>Chưa khớp</span>
                  )}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#374151" }}>{fmt(s.soLuong)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#374151" }}>{fmt(s.tongTienChinh)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: s.tongTienPhuKien > 0 ? "#d97706" : "#d1d5db" }}>{fmt(s.tongTienPhuKien)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#374151" }}>{fmt(s.tongTienTong)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#7c3aed", fontSize: 14 }}>{fmt(s.giaTB)}đ</td>
              </tr>
            ))}
            {summary.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "#9ca3af" }}>Không có dữ liệu</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── CPQC Calculator Tab ───────────────────────────────────────────────────────

interface CpqcInputs {
  product_code: string | null
  product_name: string
  from_date: string
  to_date: string
  avg_selling_price: string
  cost_don1: string
  cost_don2: string
  cost_don3: string
  pct_don1: string  // 0..100 (hiển thị), quy đổi 0..1 khi tính/lưu
  pct_don2: string
  pct_don3: string
  return_rate: string  // 0..100
  ship_fee: string
  cod_fee_pct: string  // 0..100
  packing_fee: string
  target_margin_pct: string  // 0..100
  exchange_rate: string
}

const emptyCpqcInputs: CpqcInputs = {
  product_code: null, product_name: "",
  from_date: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0, 10),
  to_date: new Date().toISOString().slice(0, 10),
  avg_selling_price: "", cost_don1: "", cost_don2: "", cost_don3: "",
  pct_don1: "", pct_don2: "", pct_don3: "",
  return_rate: "", ship_fee: "16000", cod_fee_pct: "2", packing_fee: "3000",
  target_margin_pct: "20", exchange_rate: "24000",
}

function numField(label: string, value: string, onChange: (v: string) => void, suffix?: string) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "#374151" }}>
      {label}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: 140, outline: "none", textAlign: "right" }}
        />
        {suffix && <span style={{ fontSize: 12, color: "#9ca3af", minWidth: 16 }}>{suffix}</span>}
      </div>
    </label>
  )
}

function CpqcCalculatorTab({ canManage }: { canManage: boolean }) {
  const [mktProducts, setMktProducts] = useState<MktProduct[]>([])
  const [inputs, setInputs] = useState<CpqcInputs>(emptyCpqcInputs)
  const [productQuery, setProductQuery] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [unmatchedItems, setUnmatchedItems] = useState<{ name: string; count: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    apiJson("/admin/gia-von/products", "GET").then((d) => {
      setMktProducts((d.products ?? []).filter((p: MktProduct) => p.active !== false))
    }).catch(() => {})
  }, [])

  function set<K extends keyof CpqcInputs>(key: K, value: CpqcInputs[K]) {
    setInputs(i => ({ ...i, [key]: value }))
  }

  function selectProduct(p: MktProduct) {
    set("product_code", p.code)
    set("product_name", p.name)
    setProductQuery(p.name)
    setShowDropdown(false)
    setUnmatchedItems([])
    setAutoError(null)
  }

  function useNewProduct() {
    set("product_code", null)
    set("product_name", productQuery)
    setShowDropdown(false)
  }

  async function fetchAutoStats() {
    if (!inputs.product_code) return
    setAutoLoading(true)
    setAutoError(null)
    setUnmatchedItems([])
    try {
      const d = await apiJson(
        `/admin/gia-von/cpqc/auto-stats?code=${encodeURIComponent(inputs.product_code)}&from=${inputs.from_date}&to=${inputs.to_date}`,
        "GET"
      )
      if (d.insufficient_data) {
        setAutoError(`Chưa đủ dữ liệu đơn thật (${d.sample_size ?? 0} đơn) trong khoảng thời gian này — hãy nhập tay hoặc mở rộng khoảng ngày.`)
      } else {
        setInputs(i => ({
          ...i,
          avg_selling_price: String(d.avg_selling_price ?? ""),
          cost_don1: String(d.cost_don1 ?? ""),
          cost_don2: String(d.cost_don2 ?? ""),
          cost_don3: String(d.cost_don3 ?? ""),
          pct_don1: String(Math.round((d.pct_don1 ?? 0) * 1000) / 10),
          pct_don2: String(Math.round((d.pct_don2 ?? 0) * 1000) / 10),
          pct_don3: String(Math.round((d.pct_don3 ?? 0) * 1000) / 10),
          return_rate: String(Math.round((d.return_rate ?? 0) * 1000) / 10),
        }))
        setUnmatchedItems(d.unmatched_items ?? [])
      }
    } catch (e: any) {
      setAutoError("Lỗi lấy dữ liệu: " + e.message)
    } finally {
      setAutoLoading(false)
    }
  }

  async function loadHistory() {
    if (!inputs.product_code) return
    try {
      const d = await apiJson(`/admin/gia-von/cpqc?product_code=${encodeURIComponent(inputs.product_code)}`, "GET")
      setHistory(d.rows ?? [])
      setShowHistory(true)
    } catch (e: any) {
      alert("Lỗi tải lịch sử: " + e.message)
    }
  }

  async function save() {
    if (!inputs.product_name.trim()) { alert("Thiếu tên sản phẩm"); return }
    setSaving(true)
    try {
      await apiJson("/admin/gia-von/cpqc", "POST", {
        product_code: inputs.product_code,
        product_name: inputs.product_name,
        from_date: inputs.product_code ? inputs.from_date : null,
        to_date: inputs.product_code ? inputs.to_date : null,
        avg_selling_price: n(inputs.avg_selling_price),
        cost_don1: n(inputs.cost_don1), cost_don2: n(inputs.cost_don2), cost_don3: n(inputs.cost_don3),
        pct_don1: n(inputs.pct_don1) / 100, pct_don2: n(inputs.pct_don2) / 100, pct_don3: n(inputs.pct_don3) / 100,
        return_rate: n(inputs.return_rate) / 100,
        ship_fee: n(inputs.ship_fee), cod_fee_pct: n(inputs.cod_fee_pct) / 100, packing_fee: n(inputs.packing_fee),
        target_margin_pct: n(inputs.target_margin_pct) / 100,
        exchange_rate: n(inputs.exchange_rate),
      })
      alert("Đã lưu.")
    } catch (e: any) {
      alert("Lỗi lưu: " + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteHistoryRow(id: string) {
    if (!confirm("Xóa bản ghi này?")) return
    try {
      await apiJson(`/admin/gia-von/cpqc/${id}`, "DELETE")
      setHistory(h => h.filter(r => r.id !== id))
    } catch (e: any) {
      alert("Lỗi xóa: " + e.message)
    }
  }

  function n(s: string): number {
    return parseFloat(parseViNum(s)) || 0
  }

  // ── Tính toán live ──
  // Công thức khớp mẫu Excel gốc: tỷ lệ hoàn trừ thẳng theo VNĐ trên giá bán (không phải
  // chiết khấu doanh thu), phí thu hộ tính % trên giá bán rồi trừ thẳng — không nhân với (1-hoàn).
  const avgSellingPrice = n(inputs.avg_selling_price)
  const giaVonTb =
    n(inputs.cost_don1) * (n(inputs.pct_don1) / 100) +
    n(inputs.cost_don2) * (n(inputs.pct_don2) / 100) +
    n(inputs.cost_don3) * (n(inputs.pct_don3) / 100)
  const phiHoan = avgSellingPrice * (n(inputs.return_rate) / 100)
  const codFee = avgSellingPrice * (n(inputs.cod_fee_pct) / 100)
  const lnGopBienPhi = avgSellingPrice - phiHoan - giaVonTb - n(inputs.ship_fee) - codFee - n(inputs.packing_fee)
  const lnGopPct = avgSellingPrice > 0 ? (lnGopBienPhi / avgSellingPrice) * 100 : 0
  const pctCpqcMax = lnGopPct - n(inputs.target_margin_pct)
  const cpqcVnd = (pctCpqcMax / 100) * avgSellingPrice
  const exchangeRate = n(inputs.exchange_rate) || 24000
  const cpqcUsd = cpqcVnd / exchangeRate

  const pctSum = n(inputs.pct_don1) + n(inputs.pct_don2) + n(inputs.pct_don3)
  const fmt = (v: number) => new Intl.NumberFormat("vi-VN").format(Math.round(v))

  const filteredProducts = productQuery
    ? mktProducts.filter(p => p.name.toLowerCase().includes(productQuery.toLowerCase()) || p.code.toLowerCase().includes(productQuery.toLowerCase()))
    : mktProducts

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* ── Cột trái: input ── */}
        <div style={{ flex: "1 1 420px", minWidth: 380 }}>
          <div style={{ marginBottom: 14, position: "relative" }}>
            <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 4 }}>Sản phẩm</label>
            <input
              value={productQuery}
              onChange={e => { setProductQuery(e.target.value); setShowDropdown(true); set("product_code", null) }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Gõ tên/mã SP có sẵn, hoặc gõ tên SP mới..."
              style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            {showDropdown && productQuery && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, maxHeight: 220, overflowY: "auto", background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 50 }}>
                {filteredProducts.slice(0, 20).map(p => (
                  <div key={p.id} onMouseDown={() => selectProduct(p)}
                    style={{ padding: "6px 10px", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #f3f4f6" }}>
                    <span style={{ color: "#7c3aed", fontWeight: 700, minWidth: 90, fontSize: 11 }}>{p.code}</span>
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                  </div>
                ))}
                <div onMouseDown={useNewProduct}
                  style={{ padding: "6px 10px", cursor: "pointer", color: "#16a34a", fontSize: 12, fontWeight: 600 }}>
                  + Dùng "{productQuery}" làm sản phẩm mới (nhập tay toàn bộ)
                </div>
              </div>
            )}
          </div>

          {inputs.product_code && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
              <input type="date" value={inputs.from_date} onChange={e => set("from_date", e.target.value)}
                style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px", fontSize: 12 }} />
              <span style={{ fontSize: 12, color: "#9ca3af" }}>→</span>
              <input type="date" value={inputs.to_date} onChange={e => set("to_date", e.target.value)}
                style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px", fontSize: 12 }} />
              <button onClick={fetchAutoStats} disabled={autoLoading}
                style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
                {autoLoading ? "Đang lấy…" : "📊 Lấy dữ liệu thật"}
              </button>
            </div>
          )}
          {autoError && (
            <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{autoError}</div>
          )}
          {unmatchedItems.length > 0 && (
            <div style={{ fontSize: 11, color: "#d97706", marginBottom: 10, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px" }}>
              ⚠ {unmatchedItems.length} SP phụ chưa khớp giá vốn (tính 0): {unmatchedItems.map(u => `${u.name} (${u.count})`).join(", ")}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {numField("Giá bán TB/đơn", inputs.avg_selling_price, v => set("avg_selling_price", v), "đ")}
            <div />
            {numField("Giá vốn đơn 1 (1 SP)", inputs.cost_don1, v => set("cost_don1", v), "đ")}
            {numField("% đơn 1", inputs.pct_don1, v => set("pct_don1", v), "%")}
            {numField("Giá vốn đơn đảo (2 SP)", inputs.cost_don2, v => set("cost_don2", v), "đ")}
            {numField("% đơn đảo", inputs.pct_don2, v => set("pct_don2", v), "%")}
            {numField("Giá vốn đơn đất liền (3+ SP)", inputs.cost_don3, v => set("cost_don3", v), "đ")}
            {numField("% đơn đất liền", inputs.pct_don3, v => set("pct_don3", v), "%")}
          </div>
          {Math.abs(pctSum - 100) > 1 && (inputs.pct_don1 || inputs.pct_don2 || inputs.pct_don3) && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: -8, marginBottom: 12 }}>
              ⚠ Tổng % đơn = {pctSum.toFixed(1)}% (nên ≈ 100%)
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {numField("Tỷ lệ hoàn/huỷ dự kiến", inputs.return_rate, v => set("return_rate", v), "%")}
            {numField("Target LN gộp", inputs.target_margin_pct, v => set("target_margin_pct", v), "%")}
            {numField("Phí ship", inputs.ship_fee, v => set("ship_fee", v), "đ")}
            {numField("Phí thu hộ (COD)", inputs.cod_fee_pct, v => set("cod_fee_pct", v), "%")}
            {numField("Phí lưu kho/đóng gói", inputs.packing_fee, v => set("packing_fee", v), "đ")}
            {numField("Tỷ giá USD/VNĐ", inputs.exchange_rate, v => set("exchange_rate", v))}
          </div>

          {canManage && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} disabled={saving}
                style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 7, padding: "9px 20px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                {saving ? "Đang lưu…" : "💾 Lưu"}
              </button>
              {inputs.product_code && (
                <button onClick={loadHistory}
                  style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, padding: "9px 16px", cursor: "pointer", fontSize: 13 }}>
                  🕘 Xem lịch sử
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Cột phải: kết quả ── */}
        <div style={{ flex: "1 1 320px", minWidth: 300 }}>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, color: "#111827" }}>Kết quả</div>
            {[
              ["Giá vốn TB theo tỷ lệ", `${fmt(giaVonTb)}đ`],
              ["LN gộp - CP biến đổi", `${fmt(lnGopBienPhi)}đ`, lnGopBienPhi < 0 ? "#dc2626" : "#16a34a"],
              ["% LN gộp - biến phí", `${lnGopPct.toFixed(2)}%`],
              ["% CPQC max để đạt target", `${pctCpqcMax.toFixed(2)}%`, pctCpqcMax < 0 ? "#dc2626" : "#7c3aed"],
              ["CPQC (VNĐ/đơn)", `${fmt(cpqcVnd)}đ`, cpqcVnd < 0 ? "#dc2626" : undefined],
              ["CPQC ($/đơn)", `$${cpqcUsd.toFixed(2)}`, cpqcUsd < 0 ? "#dc2626" : undefined],
            ].map(([label, value, color], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 5 ? "1px solid #e5e7eb" : "none" }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: (color as string) ?? "#111827" }}>{value}</span>
              </div>
            ))}
          </div>

          {showHistory && (
            <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Lịch sử lưu</span>
                <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>✕</button>
              </div>
              {history.length === 0 ? (
                <div style={{ fontSize: 12, color: "#9ca3af" }}>Chưa có lần lưu nào.</div>
              ) : history.map(h => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                  <span style={{ color: "#6b7280" }}>{new Date(h.created_at).toLocaleString("vi-VN")}</span>
                  <span>Target {Number(h.target_margin_pct * 100).toFixed(0)}%</span>
                  {canManage && (
                    <button onClick={() => deleteHistoryRow(h.id)} style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer" }}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GiaVonPage() {
  const { has, loading } = useCurrentPermissions()
  const canManage = has("page.gia-von.manage")
  const [tab, setTab] = useState<"sheet" | "summary" | "cpqc">("sheet")

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

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderBottom: "2px solid #e5e7eb" }}>
        {([["sheet", "Bảng dữ liệu"], ["summary", "Tổng kết giá TB"], ["cpqc", "Target CPQC"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: "none", background: "none",
              color: tab === key ? "#7c3aed" : "#6b7280",
              borderBottom: `3px solid ${tab === key ? "#7c3aed" : "transparent"}`,
              marginBottom: -2,
            }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "sheet" ? <Spreadsheet canManage={canManage} />
          : tab === "summary" ? <SummaryTab />
          : <CpqcCalculatorTab canManage={canManage} />}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: " Giá vốn",
})
