import { useEffect, useState } from "react"
import { apiFetch } from "./api-client"

// Admin-only override: which extension rings when this browser presses "Gọi".
const EXT_KEY = "click2call.extension"

function readExt(): string {
  try { return localStorage.getItem(EXT_KEY) || "" } catch { return "" }
}

/**
 * Ring the caller's extension, then the PBX bridges to `phone`.
 * The server only builds the ITY link; the browser sends it because ITY refuses
 * connections from Railway's IP while office machines in VN get through. ITY sends
 * no CORS headers, so the request goes out as no-cors and its reply is unreadable —
 * a rejected fetch (network down) is the only failure we can see.
 */
export async function click2call(phone: string, userfield?: string) {
  const extension = readExt() || undefined
  const r = await apiFetch("/admin/ity-cdr-sync/click2call", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, userfield, extension }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d?.error || "Không gọi được")
  try {
    await fetch(d.url, { mode: "no-cors", cache: "no-store", credentials: "omit" })
  } catch {
    throw new Error("Máy này không kết nối được tổng đài ITY — kiểm tra mạng rồi thử lại")
  }
  return d as { extension: string; phone: string }
}

/** Extension picker shown to admins only; empty choice = their own extension. */
export function CallExtensionPicker() {
  const [info, setInfo] = useState<{ extension: string | null; is_admin: boolean; extensions: { extension: string; name: string }[] } | null>(null)
  const [ext, setExt] = useState(readExt())

  useEffect(() => {
    apiFetch("/admin/ity-cdr-sync/click2call").then((r) => r.json()).then(setInfo).catch(() => {})
  }, [])

  if (!info?.is_admin) return null
  return (
    <label className="text-xs text-gray-600 flex flex-col gap-0.5">
      Gọi bằng máy nhánh
      <select value={ext} onChange={(e) => {
        setExt(e.target.value)
        try { e.target.value ? localStorage.setItem(EXT_KEY, e.target.value) : localStorage.removeItem(EXT_KEY) } catch {}
      }} className="border rounded px-1 py-1 text-xs">
        <option value="">{info.extension ? `Của tôi (${info.extension})` : "Của tôi (chưa gán)"}</option>
        {info.extensions.map((x) => <option key={x.extension} value={x.extension}>{x.name} · {x.extension}</option>)}
      </select>
    </label>
  )
}
