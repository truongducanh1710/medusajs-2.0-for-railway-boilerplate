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

// Nhóm quyền theo bộ phận. Mọi key trong PERMISSIONS nên nằm đúng 1 nhóm ở đây —
// nhóm "Khác" (tự động fallback bên dưới) chỉ nên xuất hiện khi thêm permission mới
// mà quên gắn nhóm, không phải nơi chứa cố định cho 1/3 số quyền như trước.
const PERM_GROUPS: { label: string; note: string; color: string; keys: string[] }[] = [
  {
    label: "📊 MKT — Báo cáo & quảng cáo",
    note: "Gắn MKT Code bên trên để giới hạn camp được bật/tắt",
    color: "bg-blue-50 border-blue-200",
    keys: [
      "page.bao-cao.view",
      "page.bao-cao.camp-control",
      "page.bao-cao.fb-accounts",
      "page.bao-cao.care-rules",
      "page.san-pham.view",
      "page.san-pham.edit",
      "medusa.products.view",
    ],
  },
  {
    label: "🎬 MKT — Content & Video",
    note: "Marketing Hub: nguyên liệu video, đăng bài Facebook, lên camp từ video",
    color: "bg-indigo-50 border-indigo-200",
    keys: [
      "page.marketing-video.view",
      "page.marketing-video.edit",
      "page.fb-content.view",
      "page.fb-content.post",
      "page.fb-content.boost",
      "page.fb-content.stats",
    ],
  },
  {
    label: "💬 MKT — Chat nội bộ & Task",
    note: "Chat group MKT (khác với inbox Facebook khách hàng) và giao việc trong team",
    color: "bg-sky-50 border-sky-200",
    keys: [
      "page.mkt-chat.view",
      "page.mkt-chat.manage",
      "page.mkt-tasks.view",
      "page.mkt-tasks.manage",
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
    label: "☎️ CSKH — Inbox & Tổng đài",
    note: "Trả lời khách qua inbox Facebook trong Medusa và tổng đài ITY",
    color: "bg-lime-50 border-lime-200",
    keys: [
      "page.chat.view",
      "page.chat.reply",
      "page.chat.manage",
      "page.chat.bot.manage",
      "page.chat.order.create",
      "page.ity-cdr.view",
      "page.ity-cdr.run",
      "page.cskh-goi-khach.call",
    ],
  },
  {
    label: "✅ QA — Đánh giá chất lượng",
    note: "Chấm điểm QA tuần, ghi chú hàng ngày — dành cho leader",
    color: "bg-fuchsia-50 border-fuchsia-200",
    keys: [
      "page.qa.view",
      "page.qa.score",
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
    label: "📦 Kho Vận — Theo dõi đóng gói",
    note: "Xem video quay đóng gói (Dohana), theo dõi năng suất nhân viên kho",
    color: "bg-orange-50 border-orange-200",
    keys: [
      "page.dohana-sync.view",
      "page.dohana-sync.run",
    ],
  },
  {
    label: "🗓 Chấm công, Nghỉ phép & Nhân sự",
    note: "checkin/leave-view mặc định mọi nhân viên đã có qua role — tick approve/nhan-su/cham-cong riêng cho HR hoặc quản lý cụ thể",
    color: "bg-teal-50 border-teal-200",
    keys: [
      "page.cham-cong-nv.checkin",
      "page.cham-cong.view",
      "page.overtime.view",
      "page.overtime.approve",
      "page.leave-request.view",
      "page.leave-request.approve",
      "page.nhan-su.view",
      "page.nhan-su.manage",
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
      "page.ai-settings.manage",
      "page.live-view.view",
      "medusa.inventory.view",
      "medusa.promotions.view",
      "medusa.settings.view",
    ],
  },
]

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— Không có role (dùng permissions thủ công) —" },
  { value: "admin", label: "Admin (toàn quyền)" },
  { value: "marketing", label: "Marketing (video, camp, content, tasks)" },
  { value: "manager", label: "Manager (đơn hàng, báo cáo, phân quyền)" },
  { value: "sale", label: "Sale (đơn hàng, chat)" },
  { value: "cskh", label: "CSKH (vận đơn, chat)" },
  { value: "ketoan", label: "Kế toán (giá vốn)" },
  { value: "kho-van", label: "Kho Vận (theo dõi video đóng gói)" },
  { value: "ai-agent", label: "AI Agent (đọc báo cáo/KPI, đăng FB cần duyệt — không sửa/xóa dữ liệu)" },
]

const UserPermissionsWidget = ({ data }: { data: any }) => {
  const [role, setRole] = useState<string>((data?.metadata?.role as string) ?? "")
  const [perms, setPerms] = useState<string[]>(
    Array.isArray(data?.metadata?.permissions) ? data.metadata.permissions : []
  )
  const [mktCode, setMktCode] = useState<string>(
    ((data?.metadata?.mkt_name as string) || (data?.metadata?.mkt_code as string)) ?? ""
  )
  const [mktCodesRaw, setMktCodesRaw] = useState<string>(
    Array.isArray(data?.metadata?.mkt_codes)
      ? (data.metadata.mkt_codes as string[]).join(", ")
      : ""
  )
  const [dohanaEmail, setDohanaEmail] = useState<string>((data?.metadata?.dohana_email as string) ?? "")
  const [ggAdsSheetUrl, setGgAdsSheetUrl] = useState<string>((data?.metadata?.gg_ads_sheet_url as string) ?? "")
  const [ggAdsSheetToken, setGgAdsSheetToken] = useState<string>((data?.metadata?.gg_ads_sheet_token as string) ?? "")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [autoAdded, setAutoAdded] = useState<string[]>([])

  // Permissions có hiệu lực thực sự (role + extra manual)
  const effectivePerms = [
    ...new Set([
      ...(role && ROLE_PRESETS[role] ? (ROLE_PRESETS[role] as string[]) : []),
      ...perms,
    ])
  ]

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
            role: role || null,
            permissions: finalPerms,
            mkt_code: mktCode.trim().toUpperCase() || null,
            mkt_name: mktCode.trim().toUpperCase() || null,
            mkt_codes: mktCodesRaw
              .split(",")
              .map(s => s.trim().toUpperCase())
              .filter(Boolean),
            gg_ads_sheet_url: ggAdsSheetUrl.trim() || null,
            gg_ads_sheet_token: ggAdsSheetToken.trim() || null,
            dohana_email: dohanaEmail.trim().toLowerCase() || null,
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

      {/* Role */}
      <div className="flex items-start gap-3 pb-3 border-b">
        <label className="text-sm font-medium whitespace-nowrap pt-1">Role:</label>
        <div className="flex-1">
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="px-2 py-1 text-sm border rounded w-full max-w-sm"
          >
            {ROLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {role && (
            <p className="mt-1 text-xs text-blue-600">
              ✓ User sẽ tự động có {(ROLE_PRESETS[role] as string[])?.length ?? 0} quyền từ role này (luôn cập nhật khi role preset thay đổi). Permissions thủ công bên dưới sẽ được cộng thêm.
            </p>
          )}
          {!role && perms.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">⚠ Chưa có role và chưa có quyền thủ công — user sẽ thấy 403.</p>
          )}
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

      {/* MKT Codes bàn giao */}
      <div className="flex items-center gap-3 pb-3 border-b">
        <label className="text-sm font-medium whitespace-nowrap">Codes bàn giao:</label>
        <input
          type="text"
          value={mktCodesRaw}
          onChange={(e) => setMktCodesRaw(e.target.value)}
          placeholder="VD: KIENLB, XUANLT (cách nhau bằng dấu phẩy)"
          className="px-2 py-1 text-sm border rounded font-mono uppercase flex-1 max-w-sm"
        />
        <span className="text-xs text-gray-500">
          User care được camp của tất cả codes này (kể cả code bàn giao từ người khác)
        </span>
      </div>

      {/* Dohana Email — chỉ cần khi email tài khoản Dohana khác email Medusa */}
      <div className="flex items-center gap-3 pb-3 border-b">
        <label className="text-sm font-medium whitespace-nowrap">Dohana Email:</label>
        <input
          type="text"
          value={dohanaEmail}
          onChange={(e) => setDohanaEmail(e.target.value)}
          placeholder="Để trống nếu email Dohana trùng email tài khoản này"
          className="px-2 py-1 text-sm border rounded flex-1 max-w-sm"
        />
        <span className="text-xs text-gray-500">
          Map thủ công user Medusa ↔ tài khoản Dohana khi email không trùng
        </span>
      </div>

      {/* Google Ads Sheet — chỉ hiện khi user có MKT Code */}
      {mktCode.trim() && (
        <div className="space-y-2 pb-3 border-b">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap w-32">GG Ads Sheet URL:</label>
            <input
              type="text"
              value={ggAdsSheetUrl}
              onChange={(e) => setGgAdsSheetUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="px-2 py-1 text-sm border rounded font-mono flex-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap w-32">GG Ads Token:</label>
            <input
              type="text"
              value={ggAdsSheetToken}
              onChange={(e) => setGgAdsSheetToken(e.target.value)}
              placeholder="token trong query ?token=..."
              className="px-2 py-1 text-sm border rounded font-mono flex-1 max-w-xs"
            />
          </div>
          <span className="text-xs text-gray-500">
            Nếu điền, hệ thống sẽ tự động sync chi phí Google Ads hằng ngày cho user này (mkt_name = {mktCode.trim().toUpperCase()})
          </span>
        </div>
      )}

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
          {effectivePerms.length}/{Object.keys(PERMISSIONS).length} quyền có hiệu lực
          {role && perms.length > 0 && ` (${(ROLE_PRESETS[role] as string[])?.length ?? 0} từ role + ${perms.length} thủ công)`}
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
