import { useEffect, useRef, useState } from "react"

export type ColumnDef<TId extends string = string> = {
  id: TId
  label: string
  default: number
  min: number
}

/**
 * Hook quản lý column widths có cache localStorage.
 * - Load width từ localStorage khi mount, fallback về default trong COLUMN_DEFS
 * - Khi user kéo handle: cập nhật width realtime, lưu localStorage khi thả chuột
 * - Reset về default qua `resetColWidths`
 *
 * Storage key version dùng để invalidate cache nếu schema cột đổi (vd thêm cột mới).
 *
 * @example
 *   const COLS: ColumnDef<"id"|"name">[] = [
 *     { id: "id",   label: "ID",   default: 100, min: 60 },
 *     { id: "name", label: "Tên",  default: 200, min: 100 },
 *   ]
 *   const { colWidths, onResizeMouseDown, resetColWidths, totalWidth } =
 *     useResizableColumns("my-table.col-widths.v1", COLS)
 *
 *   <table style={{ tableLayout: "fixed", width: `${totalWidth}px` }}>
 *     <colgroup>{COLS.map(c => <col key={c.id} style={{ width: `${colWidths[c.id]}px` }} />)}</colgroup>
 *     <thead><tr>
 *       {COLS.map(c => (
 *         <th key={c.id} className="relative ...">
 *           {c.label}
 *           <span onMouseDown={onResizeMouseDown(c.id)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400" />
 *         </th>
 *       ))}
 *     </tr></thead>
 *   </table>
 */
export function useResizableColumns<TId extends string>(
  storageKey: string,
  columnDefs: readonly ColumnDef<TId>[]
) {
  const loadWidths = (): Record<TId, number> => {
    const defaults = Object.fromEntries(columnDefs.map((c) => [c.id, c.default])) as Record<TId, number>
    if (typeof window === "undefined") return defaults
    try {
      const raw = window.localStorage.getItem(storageKey)
      const stored: Partial<Record<TId, number>> = raw ? JSON.parse(raw) : {}
      for (const c of columnDefs) {
        const v = stored[c.id]
        if (typeof v === "number" && v >= c.min) defaults[c.id] = v
      }
    } catch {}
    return defaults
  }

  const saveWidths = (widths: Record<TId, number>) => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(widths))
    } catch {}
  }

  const [colWidths, setColWidths] = useState<Record<TId, number>>(loadWidths)
  const dragRef = useRef<{ id: TId; startX: number; startW: number; minW: number } | null>(null)

  // Re-load nếu storageKey đổi (vd reset toàn cục)
  useEffect(() => {
    setColWidths(loadWidths())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const onResizeMouseDown = (id: TId) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const def = columnDefs.find((c) => c.id === id)
    if (!def) return
    dragRef.current = { id, startX: e.clientX, startW: colWidths[id], minW: def.min }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMove = (ev: MouseEvent) => {
      const s = dragRef.current
      if (!s) return
      const delta = ev.clientX - s.startX
      const next = Math.max(s.minW, Math.round(s.startW + delta))
      setColWidths((prev) => ({ ...prev, [s.id]: next }))
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      setColWidths((curr) => {
        saveWidths(curr)
        return curr
      })
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const resetColWidths = () => {
    const defaults = Object.fromEntries(columnDefs.map((c) => [c.id, c.default])) as Record<TId, number>
    setColWidths(defaults)
    saveWidths(defaults)
  }

  const totalWidth = columnDefs.reduce((s, c) => s + colWidths[c.id], 0)

  return { colWidths, onResizeMouseDown, resetColWidths, totalWidth }
}

/**
 * Drag handle JSX cho header column.
 * Use cùng useResizableColumns hook.
 */
export function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void
}) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 active:bg-blue-500"
      title="Kéo để đổi độ rộng cột"
      style={{ touchAction: "none" }}
    />
  )
}
