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

const UserPermissionsWidget = ({ data }: { data: any }) => {
  const [perms, setPerms] = useState<string[]>(
    Array.isArray(data?.metadata?.permissions) ? data.metadata.permissions : []
  )
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const toggle = (p: string) =>
    setPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  const applyPreset = (r: keyof typeof ROLE_PRESETS) => setPerms(ROLE_PRESETS[r] as string[])

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/admin/users/${data.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { ...(data.metadata ?? {}), permissions: perms },
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

  return (
    <div className="p-6 border rounded-lg space-y-4 bg-white shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-base">Phân quyền truy cập</h3>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={() => applyPreset("admin")}>Preset Admin</Btn>
          <Btn onClick={() => applyPreset("marketing")}>Marketing</Btn>
          <Btn onClick={() => applyPreset("sale")}>Sale</Btn>
          <Btn onClick={() => setPerms([])}>Xóa hết</Btn>
        </div>
      </div>

      {perms.length === 0 && (
        <p className="text-sm text-gray-500 italic">
          Chưa có quyền nào — user này sẽ thấy 403 trên mọi custom route.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {Object.entries(PERMISSIONS).map(([key, label]) => (
          <label
            key={key}
            className="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded p-1"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-violet-600"
              checked={perms.includes(key)}
              onChange={() => toggle(key)}
            />
            <span className="flex-1">
              {label}
              <code className="ml-1 text-xs text-gray-400 font-mono">{key}</code>
            </span>
          </label>
        ))}
      </div>

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
