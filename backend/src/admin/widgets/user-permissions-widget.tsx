import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useState } from "react"
import { toast, Button } from "@medusajs/ui"
import { apiFetch } from "../lib/api-client"
import { PERMISSIONS, ROLE_PRESETS } from "../lib/permissions"

const UserPermissionsWidget = ({ data }: { data: any }) => {
  const [perms, setPerms] = useState<string[]>(
    Array.isArray(data?.metadata?.permissions) ? data.metadata.permissions : []
  )
  const [saving, setSaving] = useState(false)

  const toggle = (p: string) =>
    setPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  const applyPreset = (r: keyof typeof ROLE_PRESETS) => setPerms(ROLE_PRESETS[r] as string[])

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/admin/users/${data.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { ...(data.metadata ?? {}), permissions: perms },
        }),
      })
      if (res.ok) {
        toast.success("Đã cập nhật quyền thành công")
      } else {
        toast.error("Lưu thất bại")
      }
    } catch {
      toast.error("Lỗi kết nối")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 border rounded-lg space-y-4 bg-white shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-base">Phân quyền truy cập</h3>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="small" onClick={() => applyPreset("admin")}>
            Preset Admin
          </Button>
          <Button variant="secondary" size="small" onClick={() => applyPreset("marketing")}>
            Marketing
          </Button>
          <Button variant="secondary" size="small" onClick={() => applyPreset("sale")}>
            Sale
          </Button>
          <Button variant="secondary" size="small" onClick={() => setPerms([])}>
            Xóa hết
          </Button>
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

      <div className="flex gap-3 items-center pt-2 border-t">
        <Button onClick={save} disabled={saving} size="small">
          {saving ? "Đang lưu..." : "Lưu quyền"}
        </Button>
        <span className="text-xs text-gray-400">
          {perms.length}/{Object.keys(PERMISSIONS).length} quyền được cấp
        </span>
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({ zone: "user.details.after" })
export default UserPermissionsWidget
