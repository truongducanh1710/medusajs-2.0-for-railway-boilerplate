import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useState } from "react"
import { apiFetch } from "../lib/api-client"
import { PERMISSIONS, ROLE_PRESETS } from "../lib/permissions"

const Btn = ({ onClick, disabled, children, variant = "secondary" }: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  variant?: "primary" | "secondary"
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 ${
      variant === "primary"
        ? "bg-violet-600 text-white border-violet-600 hover:bg-violet-700"
        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
    }`}
  >
    {children}
  </button>
)

// Nhóm quyền theo vai trò
const PERM_GROUPS: { label: string; note: string; color: string; keys: string[] }[] = [
  {
    label: "📊 MKT — Báo cáo & quảng cáo",
    note: "Gắn MKT Code bên trên để giới hạn camp được bật/tắt",
    color: "bg-blue-50 border-blue-200",
    keys: [
      "page.bao-cao.view",
      "page.bao-cao.camp-control",
      "page.san-pham.view",
      "page.san-pham.edit",
      "medusa.products.view",
    ],
  },
  {
    label: "📦 Sale — Đơn hàng & vận đơn",
    note: "Sale xem + xử lý đơn; CSKH xem thêm vận đơn",
    color: "bg-green-50 border-green-200",
    keys: [
      "page.don-hang.view",
      "page.don-hang.edit",
      "medusa.orders.view",
      "medusa.customers.view",
      "page.cskh.view",
      "page.cskh.analyze",
      "page.cskh.manage",
    ],
  },
  {
    label: "💰 Kế toán / Giá vốn",
    note: "Xem hoặc nhập lô hàng giá vốn",
    color: "bg-amber-50 border-amber-200",
    keys: [
      "page.gia-von.view",
      "page.gia-von.manage",
    ],
  },
  {
    label: "⚙️ Hệ thống & Admin",
    note: "Chỉ cấp cho admin / kỹ thuật",
    color: "bg-gray-50 border-gray-200",
    keys: [
      "users.manage",
      "page.pancake-sync.view",
      "page.pancake-sync.run",
      "page.pages.view",
      "page.pages.edit",
      "medusa.inventory.view",
      "medusa.promotions.view",
      "medusa.settings.view",
    ],
  },
]

const UserPermissionsWidget = ({ data }: { data: any }) => {
  const [perms, setPerms] = useState<string[]>(
    Array.isArray(data?.metadata?.permissions) ? data.metadata.permissions : []
  )
  const [mktCode, setMktCode] = useState<string>((data?.metadata?.mkt_code as string) ?? "")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [autoAdded, setAutoAdded] = useState<string[]>([])

  const toggle = (p: string) =>
    setPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  const applyPreset = (r: keyof typeof ROLE_PRESETS) => setPerms(ROLE_PRESETS[r] as string[])

  const DEFAULT_MKT_PERMS = ["page.bao-cao.view", "page.bao-cao.camp-control"]

  const save = async () => {
    setSaving(true)
    setMsg(null)
    let finalPerms = [...perms]
    const added: string[] = []
    if (mktCode.trim()) {
      for (const p of DEFAULT_MKT_PERMS) {
        if (!finalPerms.includes(p)) { finalPerms.push(p); added.push(p) }
      }
      if (added.length) setPerms(finalPerms)
    }
    setAutoAdded(added)
    try {
      const res = await apiFetch(`/admin/users/${data.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            ...(data.metadata ?? {}),
            permissions: finalPerms,
            mkt_code: mktCode.trim().toUpperCase() || null,
          },
        }),
      })
      setMsg(res.ok ? { text: "Đã cập nhật quyền thành công", ok: true } : { text: "Lưu thất bại", ok: false })
    } catch {
      setMsg({ text: "Lỗi kết nối", ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  // Quyền không thuộc nhóm nào (fallback)
  const groupedKeys = PERM_GROUPS.flatMap(g => g.keys)
  const ungrouped = Object.keys(PERMISSIONS).filter(k => !groupedKeys.includes(k))

  return (
    <div className="p-6 border rounded-lg space-y-4 bg-white shadow-sm">
      {/* Header + presets */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-base">Phân quyền truy cập</h3>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={() => applyPreset("admin")}>Preset Admin</Btn>
          <Btn onClick={() => applyPreset("marketing")}>MKT</Btn>
          <Btn onClick={() => applyPreset("sale")}>Sale</Btn>
          <Btn onClick={() => applyPreset("cskh")}>CSKH</Btn>
          <Btn onClick={() => setPerms([])}>Xóa hết</Btn>
        </div>
      </div>

      {/* MKT Code */}
      <div className="flex items-center gap-3 pb-3 border-b">
        <label className="text-sm font-medium whitespace-nowrap">MKT Code:</label>
        <input
          type="text"
          value={mktCode}
          onChange={(e) => setMktCode(e.target.value)}
          placeholder="VD: KIENLB, NAMDV (để trống nếu không phải marketer)"
          className="px-2 py-1 text-sm border rounded font-mono uppercase flex-1 max-w-xs"
        />
        <span className="text-xs text-gray-500">
          User chỉ bật/tắt được camp có MKT code này
        </span>
      </div>

      {autoAdded.length > 0 && (
        <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
          ℹ️ Đã tự động thêm quyền: {autoAdded.join(", ")}
        </p>
      )}

      {perms.length === 0 && (
        <p className="text-sm text-gray-500 italic">
          Chưa có quyền nào — user này sẽ thấy 403 trên mọi custom route.
        </p>
      )}

      {/* Grouped permissions */}
      <div className="space-y-3">
        {PERM_GROUPS.map(group => (
          <div key={group.label} className={`rounded-lg border p-3 space-y-2 ${group.color}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-700">{group.label}</span>
              <span className="text-xs text-gray-400 italic">{group.note}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {group.keys.filter(k => k in PERMISSIONS).map(key => (
                <label
                  key={key}
                  className="flex items-start gap-2 text-sm cursor-pointer hover:bg-white/60 rounded p-1 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-violet-600"
                    checked={perms.includes(key)}
                    onChange={() => toggle(key)}
                  />
                  <span className="flex-1">
                    {(PERMISSIONS as Record<string, string>)[key]}
                    <code className="ml-1 text-xs text-gray-400 font-mono">{key}</code>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        {ungrouped.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2 bg-gray-50 border-gray-200">
            <span className="text-xs font-semibold text-gray-500">Khác</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {ungrouped.map(key => (
                <label key={key} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-white/60 rounded p-1">
                  <input type="checkbox" className="mt-0.5 accent-violet-600"
                    checked={perms.includes(key)} onChange={() => toggle(key)} />
                  <span className="flex-1">
                    {(PERMISSIONS as Record<string, string>)[key]}
                    <code className="ml-1 text-xs text-gray-400 font-mono">{key}</code>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-3 items-center pt-2 border-t flex-wrap">
        <Btn onClick={save} disabled={saving} variant="primary">
          {saving ? "Đang lưu..." : "Lưu quyền"}
        </Btn>
        <span className="text-xs text-gray-400">
          {perms.length}/{Object.keys(PERMISSIONS).length} quyền được cấp
        </span>
        {msg && (
          <span className={`text-xs font-medium ${msg.ok ? "text-green-600" : "text-red-600"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({ zone: "user.details.after" })
export default UserPermissionsWidget
