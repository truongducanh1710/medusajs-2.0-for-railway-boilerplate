import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"
import { apiFetch } from "../../lib/api-client"

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function daysAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
  if (d < 1) return "Hôm nay"
  if (d < 30) return `${Math.floor(d)}d`
  if (d < 365) return `${Math.floor(d / 30)}th`
  return `${Math.floor(d / 365)}y`
}

type Item = {
  key: string
  size: number
  last_modified: string
  kind: "video" | "image" | "other"
  url: string
  in_use: boolean
  refs: string[]
}

type Summary = {
  total_count: number
  total_size: number
  filtered_count: number
  video: { count: number; size: number; unused_count: number; unused_size: number }
  image: { count: number; size: number; unused_count: number; unused_size: number }
}

const MediaPage = () => {
  const [items, setItems] = useState<Item[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<"video" | "image" | "all">("video")
  const [usedFilter, setUsedFilter] = useState<"all" | "used" | "unused">("unused")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const params = new URLSearchParams({ kind, filter: usedFilter })
      if (search) params.set("search", search)
      const res = await apiFetch(`/admin/media?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setSummary(data.summary)
    } catch (e: any) {
      alert("Lỗi: " + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [kind, usedFilter])

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map(i => i.key)))
  }

  const deleteSelected = async () => {
    if (selected.size === 0) return
    const hasInUse = items.filter(i => selected.has(i.key)).some(i => i.in_use)
    const msg = hasInUse
      ? `⚠️ CẢNH BÁO: ${selected.size} file được chọn, MỘT SỐ ĐANG ĐƯỢC DÙNG.\nXoá sẽ làm hỏng hiển thị sản phẩm/trang!\n\nVẫn xoá?`
      : `Xoá ${selected.size} file đã chọn?\nKhông thể hoàn tác.`
    if (!confirm(msg)) return

    setDeleting(true)
    try {
      const res = await apiFetch("/admin/media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: Array.from(selected) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      alert(`✅ Đã xoá ${data.deleted} file${data.errors?.length ? `, lỗi ${data.errors.length}` : ""}`)
      await fetchData()
    } catch (e: any) {
      alert("Lỗi xoá: " + e.message)
    } finally {
      setDeleting(false)
    }
  }

  const selectedSize = items.filter(i => selected.has(i.key)).reduce((s, i) => s + i.size, 0)

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-2xl font-bold mb-2">Quản lý Media (MinIO)</h1>
      <p className="text-gray-500 text-sm mb-5">
        Hiển thị toàn bộ file trong bucket. File "Không dùng" = không xuất hiện trong sản phẩm, trang chủ, CMS pages, collection, category.
      </p>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-white border rounded-xl p-4 shadow-sm">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Tổng dung lượng</div>
            <div className="text-2xl font-bold mt-1">{formatBytes(summary.total_size)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{summary.total_count} file</div>
          </div>
          <div className="bg-white border rounded-xl p-4 shadow-sm">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Video</div>
            <div className="text-2xl font-bold mt-1 text-purple-700">{formatBytes(summary.video.size)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{summary.video.count} file</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
            <div className="text-xs text-red-600 uppercase tracking-wide">Video không dùng</div>
            <div className="text-2xl font-bold mt-1 text-red-600">{formatBytes(summary.video.unused_size)}</div>
            <div className="text-xs text-red-500 mt-0.5">{summary.video.unused_count} file có thể xoá</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm">
            <div className="text-xs text-orange-600 uppercase tracking-wide">Ảnh không dùng</div>
            <div className="text-2xl font-bold mt-1 text-orange-600">{formatBytes(summary.image.unused_size)}</div>
            <div className="text-xs text-orange-500 mt-0.5">{summary.image.unused_count} file có thể xoá</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 border rounded-lg p-0.5 bg-gray-50">
          {(["video", "image", "all"] as const).map(k => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                kind === k ? "bg-white shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {k === "video" ? "🎬 Video" : k === "image" ? "🖼️ Ảnh" : "📦 Tất cả"}
            </button>
          ))}
        </div>

        <div className="flex gap-1 border rounded-lg p-0.5 bg-gray-50">
          {(["unused", "used", "all"] as const).map(f => (
            <button
              key={f}
              onClick={() => setUsedFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                usedFilter === f ? "bg-white shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f === "unused" ? "🗑️ Không dùng" : f === "used" ? "✓ Đang dùng" : "Tất cả"}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Tìm theo tên file..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchData()}
          className="border rounded-lg px-3 py-1.5 text-sm w-64"
        />
        <button onClick={fetchData} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
          🔄 Tải lại
        </button>

        <div className="flex-1" />

        {/* Action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            <span className="text-sm text-red-700 font-medium">
              {selected.size} chọn ({formatBytes(selectedSize)})
            </span>
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Đang xoá..." : "🗑️ Xoá đã chọn"}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 text-red-600 text-sm hover:bg-red-100 rounded"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">Đang tải... (quét DB + bucket có thể mất 10-20s)</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">Không có file nào khớp bộ lọc</div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2 text-sm text-gray-500">
            <input
              type="checkbox"
              checked={selected.size === items.length && items.length > 0}
              onChange={toggleAll}
            />
            <span>Chọn tất cả ({items.length} file)</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map(item => {
              const isSelected = selected.has(item.key)
              return (
                <div
                  key={item.key}
                  className={`bg-white border rounded-xl overflow-hidden transition-all ${
                    isSelected ? "ring-2 ring-blue-500 border-blue-500" : "border-gray-200 hover:shadow-md"
                  }`}
                >
                  {/* Preview */}
                  <div
                    className="relative aspect-video bg-gray-100 cursor-pointer"
                    onClick={() => setPreview(item)}
                  >
                    {item.kind === "image" ? (
                      <img src={item.url} alt={item.key} className="w-full h-full object-cover" loading="lazy" />
                    ) : item.kind === "video" ? (
                      <video src={item.url} className="w-full h-full object-cover" preload="metadata" muted />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">📄</div>
                    )}

                    {/* Play overlay for video */}
                    {item.kind === "video" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <div className="bg-white/90 rounded-full w-10 h-10 flex items-center justify-center">▶</div>
                      </div>
                    )}

                    {/* Status badge */}
                    <div className="absolute top-2 left-2">
                      {item.in_use ? (
                        <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                          ✓ Đang dùng
                        </span>
                      ) : (
                        <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                          🗑️ Không dùng
                        </span>
                      )}
                    </div>

                    {/* Checkbox */}
                    <div className="absolute top-2 right-2" onClick={(e) => { e.stopPropagation(); toggle(item.key) }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(item.key)}
                        className="w-5 h-5 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-1">
                    <div className="text-xs font-mono text-gray-700 truncate" title={item.key}>
                      {item.key}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="font-semibold">{formatBytes(item.size)}</span>
                      <span>{daysAgo(item.last_modified)}</span>
                    </div>
                    {item.in_use && item.refs.length > 0 && (
                      <div className="text-xs text-green-700 truncate" title={item.refs.join("\n")}>
                        {item.refs.length === 1 ? item.refs[0] : `${item.refs[0]} +${item.refs.length - 1}`}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm truncate">{preview.key}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {formatBytes(preview.size)} · {daysAgo(preview.last_modified)} · {preview.in_use ? "✓ Đang dùng" : "🗑️ Không dùng"}
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="text-2xl leading-none px-2 hover:bg-gray-100 rounded">×</button>
            </div>

            <div className="flex-1 overflow-auto bg-gray-900 flex items-center justify-center">
              {preview.kind === "video" ? (
                <video src={preview.url} controls autoPlay className="max-w-full max-h-full" />
              ) : preview.kind === "image" ? (
                <img src={preview.url} alt={preview.key} className="max-w-full max-h-full" />
              ) : null}
            </div>

            {preview.refs.length > 0 && (
              <div className="p-4 border-t bg-gray-50 max-h-40 overflow-auto">
                <div className="text-xs font-semibold text-gray-600 mb-2">Đang được dùng ở:</div>
                <ul className="text-xs text-gray-700 space-y-1">
                  {preview.refs.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}

            <div className="p-3 border-t flex gap-2">
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
              >
                Mở tab mới
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(preview.url); alert("Đã copy URL") }}
                className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
              >
                Copy URL
              </button>
              <div className="flex-1" />
              <button
                onClick={async () => {
                  if (!confirm(`Xoá file này?\n${preview.key}${preview.in_use ? "\n\n⚠️ FILE ĐANG ĐƯỢC DÙNG!" : ""}`)) return
                  const res = await apiFetch("/admin/media", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ keys: [preview.key] }),
                  })
                  if (res.ok) {
                    alert("Đã xoá")
                    setPreview(null)
                    fetchData()
                  } else {
                    alert("Lỗi xoá")
                  }
                }}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
              >
                🗑️ Xoá file này
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Quản lý Media",
})

export default MediaPage
