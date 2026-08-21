import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useCallback, Fragment } from "react"
import { createPortal } from "react-dom"
import { apiJson } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"
import { withRouteGuard } from "../../components/route-guard"

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
  /** Do DB tự điền khi thêm dòng; dòng cũ (trước 20/08/2026) là null. */
  created_at?: string | null
  _dirty?: boolean
}

// Schema cột dùng CHUNG với API (admin/lib/gia-von-schema) — một nguồn sự thật
// duy nhất cho tên cột, kiểu dữ liệu và công thức, tránh FE/BE lệch nhau.
import { TINH_CHAT, specAt, isValidCell, parseNumLoose, computeFormulas } from "../../lib/gia-von-schema"

/**
 * Bảng màu của trang. Neutral lệch vàng nhạt cho hợp bối cảnh kho/hoá đơn, accent
 * xanh dầu; ba màu trạng thái tách riêng khỏi accent để "cần xử lý" đọc được ngay.
 */
const C = {
  ground: "#FBFAF8", surface: "#FFFFFF", surface2: "#F6F4EF",
  line: "#E4E0D6", lineSoft: "#EFECE5",
  ink: "#1F1D17", ink2: "#4A463C", muted: "#7A756A",
  accent: "#0E6E62", accentSoft: "#E3F0ED",
  bad: "#B4342A", badSoft: "#FBEAE8",
  warn: "#A56A12", warnSoft: "#FAF0DE",
  good: "#2F7A3E", goodSoft: "#E7F2E8",
} as const

/** Font số — canh đều nét để nhìn ra ngay số lệch hàng. */
const NUM_FONT = 'ui-monospace, "SFMono-Regular", Menlo, monospace' 

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
    // Cột số: gõ ra thứ không phải số thì bỏ hẳn thay vì lưu rác vào báo cáo.
    if (colType === "number" && String(v).trim() && isNaN(parseNumLoose(v))) {
      setDraft(editValue)
      return
    }
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
            onChange={e => {
              // Chặn tại nguồn: ô số không nhận chữ, ký tự lạ bị bỏ ngay khi gõ
              // nên người nhập thấy liền chứ không đợi lưu xong mới báo sai.
              const raw = e.target.value
              const next = colType === "number" ? raw.replace(/[^0-9.,-]/g, "") : raw
              setDraft(next); setActiveIdx(-1); updateDropdownPos()
            }}
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
              border: `2px solid ${C.accent}`, borderRadius: 4,
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
              // Gõ thẳng vào ô (không double-click) cũng phải theo kiểu cột.
              if (colType === "number" && !/[0-9.,-]/.test(e.key)) return
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
            // Chữ số thẳng cột thì nhìn ra ngay số nhập lệch hàng.
            ...(colType === "number"
              ? { fontFamily: NUM_FONT, fontVariantNumeric: "tabular-nums" as const }
              : null),
          }}
        >
          {display}
        </div>
      )}
    </div>
  )
}

// ─── TinhChatCell ─────────────────────────────────────────────────────────────

/**
 * Ô "Tính chất" — chỉ có 2 giá trị hợp lệ nên cho CHỌN thay vì gõ.
 *
 * Backend (avg-cost) so khớp tuyệt đối `=== "Sản phẩm chính"`. Gõ tay thừa một dấu
 * cách hay viết tắt là dòng đó bị tính thành phụ kiện, giá vốn sai mà không báo gì.
 */
function TinhChatCell({ value, onCommit, onFocus, onNav, inputRef }: {
  value: string
  onCommit: (v: string) => void
  onFocus: () => void
  onNav: (dir: "left" | "right" | "up" | "down" | "tab") => void
  inputRef?: (el: HTMLSelectElement | null) => void
}) {
  const v = value.trim()
  const known = TINH_CHAT.includes(v as any)
  const isMain = v === "Sản phẩm chính"
  const tone = !v
    ? { fg: "#9ca3af", bg: "transparent", bd: "transparent" }
    : !known
      ? { fg: "#b91c1c", bg: "#fdecec", bd: "#f0bdbd" }
      : isMain
        ? { fg: "#0f766e", bg: "#e6f2f0", bd: "#99c9c3" }
        : { fg: "#57534e", bg: "#f4f2ee", bd: "#cfcabf" }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", padding: "0 4px" }}>
      <select
        ref={inputRef}
        value={known ? v : ""}
        onFocus={onFocus}
        onChange={e => onCommit(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Tab") { e.preventDefault(); onNav("tab") }
          else if (e.key === "Enter") { e.preventDefault(); onNav("down") }
        }}
        style={{
          width: "100%", height: 22, border: `1px solid ${tone.bd}`, borderRadius: 5,
          background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 600,
          fontFamily: "inherit", padding: "0 4px", outline: "none", cursor: "pointer",
        }}
      >
        <option value="">— chọn —</option>
        {TINH_CHAT.map(t => <option key={t} value={t}>{t}</option>)}
        {/* Giá trị cũ sai chính tả vẫn phải hiện được, nếu không select sẽ tự nhảy
            sang giá trị khác và âm thầm sửa dữ liệu người dùng chưa xem. */}
        {v && !known && <option value={v}>{v} (sai)</option>}
      </select>
    </div>
  )
}

// ─── CreatedAtCell ────────────────────────────────────────────────────────────

/** Ngày tạo dòng — DB tự điền, không sửa được. Dòng cũ (trước 20/08/2026) là null. */
function CreatedAtCell({ iso }: { iso?: string | null }) {
  if (!iso) return <span style={{ color: "#d1d5db" }}>—</span>
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return <span style={{ color: "#d1d5db" }}>—</span>
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const label = `${dd}/${mm}/${d.getFullYear()}`
  // "Mới" = tạo trong hôm nay, để biết ai vừa thêm gì mà không phải so ngày bằng mắt.
  const today = new Date()
  const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  return (
    <span style={{ display: "inline-flex", alignItems: "center", color: isToday ? "#15803d" : "#8a8378", fontWeight: isToday ? 600 : 400 }}>
      {label}
      {isToday && (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".05em", padding: "1px 5px", borderRadius: 4, background: "#e9f5ec", color: "#15803d", marginLeft: 6, textTransform: "uppercase" }}>mới</span>
      )}
    </span>
  )
}

// ─── Spreadsheet ──────────────────────────────────────────────────────────────

function Spreadsheet({ canManage }: { canManage: boolean }) {
  const [columns, setColumns] = useState<SheetColumn[]>([])
  const [rows, setRows] = useState<SheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [search, setSearch] = useState("")
  const [showIssues, setShowIssues] = useState(true)
  const [mktProducts, setMktProducts] = useState<MktProduct[]>([])
  const [syncing, setSyncing] = useState(false)

  // focusedCell: [rowIdx, colIdx] trong mảng hiển thị
  const [focused, setFocused] = useState<[number, number] | null>(null)
  const focusedRef = useRef<[number, number] | null>(null)

  const dirtyRef = useRef<Map<string, SheetRow>>(new Map()) // id → row
  const saveTimerRef = useRef<any>(null)
  // Ô "Tính chất" là <select>, các ô còn lại là <input> — cả hai đều cần focus()
  // và scrollIntoView() khi điều hướng bàn phím hoặc nhảy tới dòng lỗi.
  const cellRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement>>(new Map()) // "ri,ci" → ô
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
      // Ô paste sai kiểu (chữ vào cột số, "Tính chất" lạ) bị bỏ chứ không ghi đè —
      // API cũng lọc lần nữa, nhưng lọc sẵn ở đây để bảng không hiện số rác rồi mới mất.
      let droppedCells = 0
      for (let ri = 0; ri < pasteRows.length; ri++) {
        const rowIdx = startRi + ri
        if (rowIdx >= allRows.length) break
        const row = allRows[rowIdx]
        const newData = { ...row.data }
        for (let ci = 0; ci < pasteRows[ri].length; ci++) {
          const colIdx = startCi + ci
          if (colIdx >= currentCols.length) break
          const targetCol = currentCols[colIdx]
          const cellVal = pasteRows[ri][ci]
          // Dòng 0 là header (tên cột), không áp kiểu dữ liệu của cột lên nó.
          if (rowIdx > 0 && !isValidCell(specAt(targetCol.position), cellVal)) { droppedCells++; continue }
          newData[targetCol.id] = cellVal
        }
        updates.push({ id: row.id, data: newData })
      }
      if (droppedCells > 0) {
        alert(`Đã bỏ qua ${droppedCells} ô dán sai định dạng (cột số chỉ nhận số, "Tính chất" chỉ nhận "Sản phẩm chính" hoặc "Phụ kiện").`)
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

  /**
   * Ghi đè các ô công thức đang lệch bằng số máy tính ra. Ô công thức vẫn cho gõ tay
   * (có lúc mua hàng cố ý để số khác), nên đây là hành động người dùng chủ động bấm.
   */
  function applyFormula(rowId: string, drift: { colId: string; want: number }[]) {
    if (drift.length === 0) return
    setRows(rs => rs.map(r => {
      if (r.id !== rowId) return r
      const newData = { ...r.data }
      for (const d of drift) newData[d.colId] = String(d.want)
      const updated = { ...r, data: newData, _dirty: true }
      dirtyRef.current.set(rowId, updated)
      return updated
    }))
    scheduleSave()
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

  async function syncProducts() {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await apiJson("/admin/gia-von/products", "POST", { action: "sync" })
      // Reload danh sách SP để cột SP (cột K, autocomplete) hiện SP mới ngay
      const prod = await apiJson("/admin/gia-von/products", "GET").catch(() => ({ products: [] }))
      setMktProducts((prod.products ?? []).filter((p: MktProduct) => p.active !== false))
      alert(`Đã đồng bộ ${res.synced ?? 0}/${res.total ?? 0} sản phẩm từ Pancake POS.`)
    } catch (e: any) {
      alert("Lỗi đồng bộ SP: " + e.message)
    } finally {
      setSyncing(false)
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

  if (loading) return <div style={{ padding: 40, color: C.muted, fontSize: 14 }}>Đang tải…</div>

  // ── Đọc cấu hình cột từ dòng header (dòng 0) ─────────────────────────────
  // Backend (avg-cost) cũng đọc y hệt cách này: tên cột nằm ở dòng dữ liệu đầu tiên,
  // fallback về vị trí cột nếu header trống. Phải khớp, nếu không UI báo "sạch"
  // trong khi báo cáo lại bỏ dòng đó.
  const posToId: Record<number, string> = {}
  for (const c of columns) posToId[c.position] = c.id
  const hdr = (rows[0]?.data ?? {}) as Record<string, string>
  const headerToId: Record<string, string> = {}
  for (const [cid, v] of Object.entries(hdr)) if (v) headerToId[String(v).trim()] = cid
  const colSanPham = headerToId["Sản phẩm"] ?? posToId[1]
  const colTinhChat = headerToId["Tính chất"] ?? posToId[2]
  const colMaSP = posToId[10]

  // ── Soát lỗi ─────────────────────────────────────────────────────────────
  // Mã hợp lệ = có trong danh mục SP (mkt_product). Dữ liệu cũ lưu TÊN thay vì mã
  // nên chấp nhận cả hai, giống backend.
  const validCodes = new Set(mktProducts.map(p => p.code.trim().toUpperCase()))
  const validNames = new Set(mktProducts.map(p => p.name.trim().toUpperCase()))

  type Issue = {
    rowIdx: number
    kind: "no_code" | "bad_code" | "bad_tinhchat" | "blank" | "formula_drift"
    /** Chỉ có ở formula_drift — cột nào lệch và công thức ra bao nhiêu. */
    drift?: { colId: string; label: string; want: number }[]
  }
  const issues: Issue[] = []
  const nameCount = new Map<string, number[]>()

  rows.forEach((r, i) => {
    if (i === 0) return // dòng header, không phải dữ liệu
    const d = r.data ?? {}
    const ten = (d[colSanPham] ?? "").trim()
    if (!ten) {
      // Dòng trống hẳn mới tính; dòng có nhập gì đó mà thiếu tên là chuyện khác.
      if (!Object.values(d).some(v => (v ?? "").trim())) issues.push({ rowIdx: i, kind: "blank" })
      return
    }
    const key = ten.toUpperCase()
    nameCount.set(key, [...(nameCount.get(key) ?? []), i])

    const tc = (d[colTinhChat] ?? "").trim()
    if (tc && !TINH_CHAT.includes(tc as any)) issues.push({ rowIdx: i, kind: "bad_tinhchat" })

    // Ô công thức (VAT, Tổng tiền, Giá TB/sp) vẫn cho gõ đè, nhưng lệch với công
    // thức thì phải nói ra — số tay và số máy khác nhau là lúc báo cáo sai âm thầm.
    const colG = posToId[6], colI = posToId[8], colJ = posToId[9]
    if (colG && colI && colJ) {
      const expect = computeFormulas({
        qty: parseNum(d[posToId[3]] ?? ""),
        priceUnit: parseNum(d[posToId[4]] ?? ""),
        fee: parseNum(d[posToId[5]] ?? ""),
        vat: parseNum(d[colG] ?? ""),
        otherFee: parseNum(d[posToId[7]] ?? ""),
      })
      const drift = (colId: string, want: number) => {
        const raw = (d[colId] ?? "").trim()
        if (!raw || want <= 0) return false
        // Sai 1đ do làm tròn thì bỏ qua, chỉ báo khi lệch thật.
        return Math.abs(parseNum(raw) - want) > 1
      }
      const driftCols: { colId: string; label: string; want: number }[] = []
      if (drift(colG, expect.vat)) driftCols.push({ colId: colG, label: "VAT", want: expect.vat })
      if (drift(colI, expect.total)) driftCols.push({ colId: colI, label: "Tổng tiền", want: expect.total })
      if (drift(colJ, expect.avg)) driftCols.push({ colId: colJ, label: "Giá TB/sp", want: expect.avg })
      if (driftCols.length > 0) issues.push({ rowIdx: i, kind: "formula_drift", drift: driftCols })
    }

    const ma = (colMaSP ? d[colMaSP] : "")?.trim() ?? ""
    if (!ma) issues.push({ rowIdx: i, kind: "no_code" })
    else if (!validCodes.has(ma.toUpperCase()) && !validNames.has(ma.toUpperCase())) {
      issues.push({ rowIdx: i, kind: "bad_code" })
    }
  })

  // Issue theo dòng — dùng để vẽ vạch màu đầu dòng và dải giải thích ngay bên dưới,
  // thay vì bắt người nhập tự dò xem dòng nào đang hỏng.
  const issuesByRow = new Map<number, Issue[]>()
  for (const it of issues) {
    if (it.kind === "blank") continue // dòng trống không cần giải thích gì
    issuesByRow.set(it.rowIdx, [...(issuesByRow.get(it.rowIdx) ?? []), it])
  }

  const dupGroups = [...nameCount.entries()].filter(([, idxs]) => idxs.length > 1)
  const byKind = (k: Issue["kind"]) => issues.filter(x => x.kind === k)
  // Dòng "hỏng" = không vào được báo cáo LNG (thiếu mã hoặc mã sai).
  const brokenRows = new Set(issues.filter(x => x.kind === "no_code" || x.kind === "bad_code").map(x => x.rowIdx))
  const dataRowCount = Math.max(rows.length - 1, 0)
  const usableRows = dataRowCount - byKind("blank").length - brokenRows.size

  function jumpToRow(rowIdx: number) {
    const key = `${rowIdx},1`
    const el = cellRefs.current.get(key)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
    setTimeout(() => el?.focus(), 250)
  }

  // ── Lọc theo ô tìm kiếm ──────────────────────────────────────────────────
  // Giữ nguyên chỉ số gốc để nhảy tới dòng và đánh số thứ tự vẫn đúng.
  const q = search.trim().toLowerCase()
  const visibleRows: { row: SheetRow; idx: number }[] = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row, idx }) => {
      if (idx === 0) return true // luôn giữ dòng header
      if (!q) return true
      const d = row.data ?? {}
      const ten = (d[colSanPham] ?? "").toLowerCase()
      const ma = (colMaSP ? d[colMaSP] : "")?.toLowerCase() ?? ""
      return ten.includes(q) || ma.includes(q)
    })

  // Bộ cột đã cố định A–K nên hiện hết, không còn cột thừa để ẩn như bản A–Z cũ.
  const visibleCols = columns

  const ROW_H = 28
  const NUM_COL_W = 40

  const issueCards: { n: number; sev: "bad" | "warn" | "ok"; chip: string; label: string; why: string; jump?: () => void }[] = [
    {
      // Gộp "chưa chọn mã" và "mã sai" vào một thẻ: hậu quả giống hệt nhau (dòng bị
      // loại khỏi báo cáo), tách ra chỉ làm người nhập tưởng là hai việc phải sửa.
      n: brokenRows.size, sev: brokenRows.size ? "bad" : "ok",
      chip: brokenRows.size ? "Mất số liệu" : "Sạch",
      label: "Chưa vào được báo cáo LNG",
      why: "Thiếu mã SP hoặc mã không khớp danh mục — đã khai giá vốn nhưng coi như chưa khai.",
      jump: brokenRows.size ? (() => jumpToRow(Math.min(...brokenRows))) : undefined,
    },
    {
      n: byKind("blank").length, sev: byKind("blank").length ? "warn" : "ok",
      chip: byKind("blank").length ? "Dòng trống" : "Sạch",
      label: "Dòng chưa nhập gì",
      why: "Nằm xen giữa bảng, làm khó cuộn và đếm.",
      jump: byKind("blank")[0] && (() => jumpToRow(byKind("blank")[0].rowIdx)),
    },
    {
      n: dupGroups.length, sev: dupGroups.length ? "warn" : "ok",
      chip: dupGroups.length ? "Trùng tên" : "Sạch",
      label: "Tên lặp ở nhiều dòng",
      why: "Đúng nếu là nhiều lô nhập khác nhau — kiểm tra lại nếu gõ trùng.",
      jump: dupGroups[0] && (() => jumpToRow(dupGroups[0][1][0])),
    },
    {
      n: byKind("formula_drift").length, sev: byKind("formula_drift").length ? "warn" : "ok",
      chip: byKind("formula_drift").length ? "Lệch công thức" : "Sạch",
      label: "Số gõ tay khác số tự tính",
      why: "VAT / Tổng tiền / Giá TB đang khác công thức — cố ý thì bỏ qua, không thì sửa lại.",
      jump: byKind("formula_drift")[0] && (() => jumpToRow(byKind("formula_drift")[0].rowIdx)),
    },
    {
      n: byKind("bad_tinhchat").length, sev: byKind("bad_tinhchat").length ? "bad" : "ok",
      chip: byKind("bad_tinhchat").length ? "Sai giá trị" : "Sạch",
      label: "Tính chất sai chính tả",
      why: "Chỉ nhận đúng \"Sản phẩm chính\" hoặc \"Phụ kiện\" — sai là bị tính thành phụ kiện.",
      jump: byKind("bad_tinhchat")[0] && (() => jumpToRow(byKind("bad_tinhchat")[0].rowIdx)),
    },
  ]
  const SEV: Record<string, { fg: string; bg: string; bd: string }> = {
    bad: { fg: C.bad, bg: C.badSoft, bd: `${C.bad}33` },
    warn: { fg: C.warn, bg: C.warnSoft, bd: `${C.warn}33` },
    ok: { fg: C.muted, bg: C.surface2, bd: C.line },
  }
  const usablePct = dataRowCount > 0 ? Math.round(usableRows / dataRowCount * 100) : 100

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)" }}>
      {/* Kiểm tra dữ liệu — thứ cần xử lý, đặt trên cùng để đọc trước khi cuộn bảng */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface, marginBottom: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 16px", borderBottom: showIssues ? `1px solid ${C.line}` : "none" }}>
          <b style={{ fontSize: 14.5 }}>Kiểm tra dữ liệu</b>
          <span style={{ fontSize: 12.5, color: C.muted }}>{dataRowCount} dòng · cập nhật khi bạn nhập</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 12.5, color: C.muted }}>Dùng được cho báo cáo</span>
            <span style={{ width: 140, height: 6, borderRadius: 99, background: C.line, overflow: "hidden", display: "inline-block" }}>
              <span style={{ display: "block", height: "100%", width: `${usablePct}%`, borderRadius: 99, background: usablePct >= 90 ? C.good : usablePct >= 70 ? C.warn : C.bad }} />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: NUM_FONT, color: usablePct >= 90 ? C.good : usablePct >= 70 ? C.warn : C.bad }}>
              {usableRows}/{dataRowCount}
            </span>
            <button onClick={() => setShowIssues(v => !v)}
              style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 7, padding: "4px 9px", cursor: "pointer", fontSize: 12, color: C.ink2 }}>
              {showIssues ? "Thu gọn" : "Mở rộng"}
            </button>
          </div>
        </div>
        {showIssues && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(224px, 1fr))" }}>
            {issueCards.map((c, i) => {
              const sv = SEV[c.sev]
              return (
                <button key={i} onClick={c.jump} disabled={!c.jump}
                  style={{
                    padding: "12px 16px", borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`,
                    borderTop: 0, borderLeft: 0, background: "none", textAlign: "left",
                    display: "flex", flexDirection: "column", gap: 6,
                    cursor: c.jump ? "pointer" : "default", font: "inherit", color: "inherit",
                  }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: NUM_FONT, fontSize: 21, fontWeight: 700, lineHeight: 1, color: sv.fg }}>{c.n}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", padding: "3px 7px", borderRadius: 5, color: sv.fg, background: sv.bg, border: `1px solid ${sv.bd}` }}>{c.chip}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{c.label}</span>
                  <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>{c.why}</span>
                  {c.jump && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.accent, marginTop: "auto" }}>Tới dòng đầu tiên →</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        {canManage && (
          <>
            <button onClick={() => addRow(1)}
              style={{ background: C.accent, border: "1px solid transparent", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#fff" }}>
              + Thêm dòng
            </button>
            <button onClick={() => addRow(10)}
              style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 12px", cursor: "pointer", fontSize: 12, color: C.ink2 }}>
              +10 dòng
            </button>
            <button onClick={syncProducts} disabled={syncing}
              title="Kéo danh mục SP mới nhất từ Pancake POS về (cập nhật gợi ý cột Sản phẩm)"
              style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 14px", cursor: syncing ? "wait" : "pointer", fontSize: 13, fontWeight: 600, color: C.ink2 }}>
              {syncing ? "Đang đồng bộ…" : "Đồng bộ SP từ POS"}
            </button>
          </>
        )}
        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 320 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 12, pointerEvents: "none" }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Tìm tên hoặc mã sản phẩm…"
            style={{ width: "100%", font: "inherit", fontSize: 13, padding: "7px 11px 7px 28px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, outline: "none" }} />
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12.5, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: C.muted, fontFamily: NUM_FONT }}>
            {q ? `${visibleRows.length - 1}/${dataRowCount} dòng` : `${dataRowCount} dòng`}
          </span>
          {saveState === "saving" && <span style={{ color: C.warn }}>Đang lưu…</span>}
          {saveState === "saved" && <span style={{ color: C.good }}>Đã lưu</span>}
          {saveState === "error" && <span style={{ color: C.bad }}>Lỗi lưu</span>}
        </div>
      </div>

      {/* Sheet */}
      <div style={{ flex: 1, overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: NUM_COL_W + visibleCols.reduce((s, c) => s + c.width, 0) + 110 }}>
          <colgroup>
            <col style={{ width: NUM_COL_W }} />
            {visibleCols.map(c => <col key={c.id} style={{ width: c.width }} />)}
            <col style={{ width: 110 }} />
            {canManage && <col style={{ width: 32 }} />}
          </colgroup>
          <thead>
            <tr>
              {/* Row number header */}
              <th style={thS(NUM_COL_W)}></th>

              {visibleCols.map((col) => (
                <ColumnHeader key={col.id} col={col} headerName={(hdr[col.id] ?? "").trim()} />
              ))}

              {/* Ngày tạo — do hệ thống điền, không sửa được nên không dùng ColumnHeader */}
              <th style={{ ...thS(110), padding: "6px 10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#1c1917" }}>Ngày tạo</span>
                  <span style={{ fontSize: 9.5, color: "#8a8378", textTransform: "uppercase", letterSpacing: ".03em", fontWeight: 600 }}>tự động</span>
                </div>
              </th>

              {canManage && <th style={thS(32)}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length + 3} style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "32px 0" }}>
                  Bảng trống — bấm "+ Thêm dòng" hoặc paste dữ liệu từ Excel/GG Sheets
                </td>
              </tr>
            ) : visibleRows.length <= 1 && q ? (
              <tr>
                <td colSpan={visibleCols.length + 3} style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "32px 0" }}>
                  Không có dòng nào khớp "{search}"
                </td>
              </tr>
            ) : visibleRows.map(({ row, idx: ri }) => {
              const isHeaderRow = ri === 0
              const broken = brokenRows.has(ri)
              const rowIssues = issuesByRow.get(ri) ?? []
              // Nặng nhất quyết định màu dòng: thiếu/sai mã (đỏ) > lệch công thức (vàng).
              const sev: "bad" | "warn" | null =
                broken ? "bad" : rowIssues.length > 0 ? "warn" : null
              const bg = isHeaderRow ? C.surface2
                : sev === "bad" ? C.badSoft
                : sev === "warn" ? C.warnSoft
                : C.surface
              return (
              <Fragment key={row.id}>
              <tr style={{ height: ROW_H, background: bg }}>
                {/* Số dòng + vạch màu: dòng cần xử lý nhận ra được khi lướt nhanh. */}
                <td style={{ ...tdS(NUM_COL_W), textAlign: "center", color: C.muted, fontSize: 11, background: isHeaderRow ? C.surface2 : C.ground, userSelect: "none", position: "relative" }}>
                  {sev && (
                    <span style={{
                      position: "absolute", left: 0, top: 4, bottom: 4, width: 3,
                      borderRadius: "0 2px 2px 0",
                      background: sev === "bad" ? C.bad : C.warn,
                    }} />
                  )}
                  {ri + 1}
                </td>

                {visibleCols.map((col, ci) => {
                  const isProductCol = col.position === 10
                  // Cột "Tính chất" chỉ nhận 2 giá trị — cho chọn thay vì gõ, xoá hẳn
                  // lỗi sai chính tả làm dòng bị tính nhầm thành phụ kiện.
                  const isTinhChat = !isHeaderRow && col.id === colTinhChat
                  return (
                  <td key={col.id}
                    style={{ ...tdS(col.width), position: "relative", padding: 0 }}
                  >
                    {isTinhChat && canManage ? (
                      <TinhChatCell
                        value={row.data[col.id] ?? ""}
                        onCommit={v => updateCell(row.id, col.id, v)}
                        onFocus={() => setFocused([ri, ci])}
                        onNav={dir => navigate(ri, ci, dir)}
                        inputRef={el => {
                          const key = `${ri},${ci}`
                          if (el) cellRefs.current.set(key, el)
                          else cellRefs.current.delete(key)
                        }}
                      />
                    ) : (
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
                    )}
                  </td>
                  )
                })}

                {/* Ngày tạo */}
                <td style={{ ...tdS(110), padding: "0 10px", fontSize: 11.5, fontFamily: NUM_FONT, color: C.muted }}>
                  {isHeaderRow ? "" : <CreatedAtCell iso={row.created_at} />}
                </td>

                {canManage && (
                  <td style={{ ...tdS(32), textAlign: "center", padding: 0 }}>
                    <button onClick={() => deleteRow(row.id)}
                      title="Xóa dòng"
                      style={{ background: "none", border: "none", cursor: "pointer", color: C.line, fontSize: 13, padding: "0 4px", lineHeight: 1 }}
                      onMouseOver={e => (e.currentTarget.style.color = C.bad)}
                      onMouseOut={e => (e.currentTarget.style.color = C.line)}
                    >✕</button>
                  </td>
                )}
              </tr>

              {/* Dải giải thích ngay dưới dòng lỗi — nói rõ sai gì và sửa thế nào,
                  thay vì để người nhập tự đoán từ ô đỏ. */}
              {rowIssues.length > 0 && (
                <tr style={{ background: sev === "bad" ? C.badSoft : C.warnSoft }}>
                  <td colSpan={visibleCols.length + (canManage ? 3 : 2)}
                    style={{ padding: "0 12px 9px", borderBottom: `1px solid ${C.lineSoft}` }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingLeft: NUM_COL_W - 12 }}>
                      {rowIssues.map((it, k) => (
                        <IssueNote key={k} issue={it} rowIdx={ri}
                          onFix={it.kind === "formula_drift" && canManage
                            ? () => applyFormula(row.id, it.drift ?? [])
                            : undefined} />
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {canManage && rows.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          Tip: Paste trực tiếp từ Excel / GG Sheets (Ctrl+V) vào bất kỳ ô nào để điền hàng loạt.
        </div>
      )}

    </div>
  )
}

// ─── IssueNote ────────────────────────────────────────────────────────────────

/**
 * Một lỗi của dòng, hiện thành dải ngay dưới dòng đó. Mỗi lỗi nói đúng ba thứ:
 * sai gì, hậu quả ra sao, và (nếu máy sửa hộ được) một nút bấm để sửa.
 */
function IssueNote({ issue, onFix }: {
  issue: { kind: string; drift?: { colId: string; label: string; want: number }[] }
  rowIdx: number
  onFix?: () => void
}) {
  const nf = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n))
  const bad = issue.kind === "no_code" || issue.kind === "bad_code" || issue.kind === "bad_tinhchat"
  const fg = bad ? C.bad : C.warn

  let chip = ""
  let text: React.ReactNode = null
  if (issue.kind === "no_code") {
    chip = "Thiếu mã SP"
    text = "Chưa chọn mã ở cột Mã SP — dòng này không vào được báo cáo LNG."
  } else if (issue.kind === "bad_code") {
    chip = "Mã SP sai"
    text = "Mã không khớp danh mục sản phẩm — đã khai giá vốn nhưng báo cáo vẫn coi như chưa khai."
  } else if (issue.kind === "bad_tinhchat") {
    chip = "Tính chất sai"
    text = 'Chỉ nhận đúng "Sản phẩm chính" hoặc "Phụ kiện" — sai là bị tính thành phụ kiện.'
  } else if (issue.kind === "formula_drift") {
    const d = issue.drift ?? []
    chip = "Lệch công thức"
    text = (
      <>
        {d.map((x, i) => (
          <span key={x.colId}>
            {i > 0 && " · "}
            {x.label} gõ tay khác số tự tính <b style={{ fontFamily: NUM_FONT }}>{nf(x.want)}</b>
          </span>
        ))}
      </>
    )
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", padding: "2px 8px",
        borderRadius: 99, color: fg, background: bad ? C.badSoft : C.warnSoft,
        border: `1px solid ${fg}33`, whiteSpace: "nowrap",
      }}>{chip}</span>
      <span style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.45 }}>{text}</span>
      {onFix && (
        <button onClick={onFix}
          style={{
            font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
            padding: "3px 10px", borderRadius: 6,
            border: `1px solid ${C.line}`, background: C.surface, color: C.ink2,
          }}>
          Dùng số tự tính
        </button>
      )}
    </span>
  )
}

// ─── ColumnHeader ─────────────────────────────────────────────

/** Cột bắt buộc — thiếu là dòng không vào được báo cáo LNG. */
const REQUIRED_HEADERS = new Set(["Sản phẩm", "Tính chất", "Số lượng", "Tổng tiền"])

/**
 * Header cột — chỉ hiển thị. Cấu trúc bảng khoá theo SHEET_SCHEMA nên không còn
 * đổi tên / xoá cột; API cũng trả 403 cho hai thao tác đó.
 */
function ColumnHeader({ col, headerName }: {
  col: SheetColumn
  /** Tên nghiệp vụ lấy từ dòng header (dòng 0) — hiện lên đầu cột thay cho A, B, C. */
  headerName?: string
}) {
  const spec = specAt(col.position)
  const label = headerName || spec?.name || col.name
  return (
    <th style={{ ...thS(col.width), position: "relative", userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: col.col_type === "number" ? "flex-end" : "flex-start" }}>
        <span
          title={spec?.formula ? `${label} — ô tự tính theo công thức` : label}
          style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: col.col_type === "number" ? "flex-end" : "flex-start" }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".05em", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {label}
            {REQUIRED_HEADERS.has(label) && <span style={{ color: C.bad, marginLeft: 2 }}>*</span>}
            {spec?.formula && <span title="Ô tự tính theo công thức" style={{ color: C.muted, marginLeft: 4, fontWeight: 400, textTransform: "none" }}>ƒ</span>}
          </span>
        </span>
      </div>
    </th>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

function thS(w: number): React.CSSProperties {
  return {
    padding: "9px 12px",
    borderBottom: `1px solid ${C.line}`,
    background: C.surface2,
    fontSize: 11, fontWeight: 700, color: C.muted,
    whiteSpace: "nowrap",
    width: w, minWidth: w,
    position: "sticky", top: 0, zIndex: 10,
    boxSizing: "border-box",
  }
}

function tdS(w: number): React.CSSProperties {
  return {
    borderBottom: `1px solid ${C.lineSoft}`,
    width: w, minWidth: w,
    height: 32,
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

function GiaVonPage() {
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
  label: "Giá vốn", rank: 2,
})

export default withRouteGuard(GiaVonPage)
