import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

type Rule = {
  id?: number; name: string; target_cpa: number; min_orders: number; spend_ratio: number; multiplier: number
  max_budget: number; cooldown_min: number; revert_factor: number; hour_from: number; hour_to: number
  nightly_reset: boolean; dry_run: boolean; active: boolean; camp_count?: number
}
type Camp = {
  campaign_id: string; campaign_name: string; rule_id: number; rule_name: string; dry_run: boolean; mkt_name: string
  base_budget: number; enabled: boolean; step_at: string | null; step_from: number | null; step_to: number | null
  last_checked_at: string | null; last_reason: string | null; last_metrics: any
}
type Candidate = {
  campaign_id: string; campaign_name: string; mkt_name: string; daily_budget: number; effective_status: string
  spend_7d: number; orders_7d: number; rule_id: number | null
}
type Log = {
  id: number; campaign_name: string; action: string; old_budget: number; new_budget: number; reason: string
  dry_run: boolean; success: boolean; error: string | null; created_at: string
}

// Mặc định theo cách XUANLT scale (rà 115 lần tăng ngân sách trên Ads344)
const MAC_DINH: Rule = {
  name: "Kiểu XUANLT — nhân đôi khi ra đơn", target_cpa: 200000, min_orders: 2, spend_ratio: 1, multiplier: 2,
  max_budget: 4000000, cooldown_min: 120, revert_factor: 1.5, hour_from: 9, hour_to: 19,
  nightly_reset: true, dry_run: true, active: true,
}

const vnd = (n: any) => (n === null || n === undefined || n === "" ? "—" : `${Math.round(Number(n)).toLocaleString("vi-VN")}đ`)
const time = (s: string | null) => (s ? new Date(s).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "—")
const ACTION: Record<string, { label: string; color: string }> = {
  tang: { label: "🚀 Tăng", color: "#16a34a" },
  lui: { label: "↩️ Lùi", color: "#d97706" },
  reset: { label: "🌙 Reset", color: "#6b7280" },
}

function TuScalePage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [camps, setCamps] = useState<Camp[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [editing, setEditing] = useState<Rule | null>(null)
  const [q, setQ] = useState("")
  const [cands, setCands] = useState<Candidate[]>([])
  const [pickRule, setPickRule] = useState<number | "">("")
  const [msg, setMsg] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const d = await apiJson("/admin/auto-scale")
    if (!d) return
    setRules(d.rules || []); setCamps(d.camps || []); setLogs(d.logs || [])
    if (!pickRule && d.rules?.length) setPickRule(d.rules.find((r: Rule) => r.active)?.id ?? d.rules[0].id)
  }, [pickRule])

  const search = useCallback(async () => {
    const d = await apiJson(`/admin/auto-scale/candidates?q=${encodeURIComponent(q)}`)
    setCands(d?.candidates || [])
  }, [q])

  useEffect(() => { load(); search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setMsg("")
    try {
      const r = await fn()
      if (r?.error) setMsg(`❌ ${r.error}`)
      else { setMsg(`✅ ${ok}`); await load() }
      return r
    } finally { setBusy(false) }
  }

  const saveRule = () => editing && act(async () => {
    const r = await apiJson("/admin/auto-scale/rules", "POST", editing)
    if (!r?.error) setEditing(null)
    return r
  }, "Đã lưu bộ điều kiện")

  const attach = (c: Candidate) => {
    if (!pickRule) { setMsg("❌ Chọn bộ điều kiện trước"); return }
    const nen = window.prompt(`Mức nền (reset về lúc 0h30) cho camp:\n${c.campaign_name}`, String(c.daily_budget))
    if (nen === null) return
    act(() => apiJson("/admin/auto-scale/camps", "POST", { campaign_id: c.campaign_id, rule_id: pickRule, base_budget: Number(nen) || undefined }),
      "Đã gắn camp").then(search)
  }

  const setCamp = (c: Camp, patch: Partial<{ enabled: boolean; base_budget: number; rule_id: number }>) =>
    act(() => apiJson("/admin/auto-scale/camps", "POST", {
      campaign_id: c.campaign_id, rule_id: patch.rule_id ?? c.rule_id,
      base_budget: patch.base_budget ?? c.base_budget, enabled: patch.enabled ?? c.enabled,
    }), "Đã cập nhật camp")

  const F = (k: keyof Rule, label: string, hint?: string, step?: number) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, minWidth: 150 }}>
      <span style={{ color: "#374151", fontWeight: 600 }}>{label}</span>
      <input type="number" step={step ?? 1} style={inp} value={(editing as any)[k]}
        onChange={(e) => setEditing({ ...(editing as Rule), [k]: Number(e.target.value) })} />
      {hint && <span style={{ color: "#6b7280" }}>{hint}</span>}
    </label>
  )

  return (
    <div style={{ padding: 20, maxWidth: 1400 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tự scale camp theo giờ</h1>
      <p style={{ color: "#4b5563", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
        Chỉ camp <b>được gắn bộ điều kiện</b> mới được hệ thống tự đổi ngân sách. Cứ 15 phút, trong khung giờ của bộ điều kiện:
        camp đủ số đơn, chi phí/đơn ≤ mục tiêu và theo nhịp tiêu trong ngày sẽ chạm trần ngân sách → <b>nhân ngân sách</b> (tối đa tới trần);
        sau lần tăng mà đơn không về tương xứng → <b>lùi</b> về mức trước. Từ <b>0h30</b> mỗi đêm → <b>reset</b> về mức nền.
        Chỉ hỗ trợ camp CBO. Mọi thay đổi nhắn Telegram cho MKT của camp + super admin.
        <br />Bộ điều kiện ở chế độ <b>CHẠY THỬ</b> chỉ ghi nhật ký "lẽ ra đã tăng", không đổi ngân sách thật.
      </p>
      {msg && <div style={{ padding: "8px 12px", background: msg.startsWith("❌") ? "#fef2f2" : "#f0fdf4", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {/* ── Bộ điều kiện ── */}
      <section style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>1. Bộ điều kiện</h2>
          <button style={btnPri} onClick={() => setEditing({ ...MAC_DINH })}>+ Tạo bộ điều kiện</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tbl}>
            <thead><tr>
              {["Tên", "CPA mục tiêu", "Đơn tối thiểu", "Nhịp tiêu ≥", "Nhân", "Trần/ngày", "Chờ giữa 2 lần", "Lùi khi CPA >", "Khung giờ", "Reset 0h30", "Chế độ", "Camp", ""].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td style={td}><b>{r.name}</b></td>
                  <td style={td}>{vnd(r.target_cpa)}</td>
                  <td style={td}>{r.min_orders}</td>
                  <td style={td}>{Number(r.spend_ratio)}× ngân sách (dự kiến cả ngày)</td>
                  <td style={td}>×{Number(r.multiplier)}</td>
                  <td style={td}>{vnd(r.max_budget)}</td>
                  <td style={td}>{r.cooldown_min} phút</td>
                  <td style={td}>{Number(r.revert_factor)}× mục tiêu</td>
                  <td style={td}>{r.hour_from}h–{r.hour_to}h</td>
                  <td style={td}>{r.nightly_reset ? "Có" : "Không"}</td>
                  <td style={td}>{!r.active ? <span style={{ color: "#6b7280" }}>Tắt</span> : r.dry_run ? <span style={{ color: "#d97706", fontWeight: 600 }}>CHẠY THỬ</span> : <span style={{ color: "#16a34a", fontWeight: 600 }}>ĐANG CHẠY THẬT</span>}</td>
                  <td style={td}>{r.camp_count}</td>
                  <td style={td}>
                    <button style={btn} onClick={() => setEditing({ ...r, spend_ratio: Number(r.spend_ratio), multiplier: Number(r.multiplier), revert_factor: Number(r.revert_factor), target_cpa: Number(r.target_cpa), max_budget: Number(r.max_budget) })}>Sửa</button>{" "}
                    {!r.camp_count && <button style={btn} onClick={() => window.confirm(`Xoá "${r.name}"?`) && act(() => apiJson(`/admin/auto-scale/rules?id=${r.id}`, "DELETE"), "Đã xoá")}>Xoá</button>}
                  </td>
                </tr>
              ))}
              {!rules.length && <tr><td colSpan={13} style={{ ...td, color: "#6b7280", textAlign: "center" }}>Chưa có bộ điều kiện nào — bấm "+ Tạo bộ điều kiện"</td></tr>}
            </tbody>
          </table>
        </div>

        {editing && (
          <div style={{ marginTop: 14, padding: 14, border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, marginBottom: 10 }}>
              <span style={{ fontWeight: 600 }}>Tên bộ điều kiện</span>
              <input style={{ ...inp, maxWidth: 420 }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              {F("target_cpa", "CPA mục tiêu (đ)", "Chi phí/đơn hôm nay phải ≤ mức này")}
              {F("min_orders", "Số đơn tối thiểu hôm nay", "Đơn thật, bỏ trùng/nháp chưa chốt/huỷ")}
              {F("spend_ratio", "Nhịp tiêu ≥ (× ngân sách)", "1 = cứ đà này cả ngày sẽ tiêu hết ngân sách", 0.1)}
              {F("multiplier", "Nhân ngân sách", "2 = gấp đôi mỗi lần tăng", 0.1)}
              {F("max_budget", "Trần ngân sách/ngày (đ)", "Không tăng quá mức này")}
              {F("cooldown_min", "Chờ giữa 2 lần (phút)", "Để đơn kịp về trước khi tăng tiếp")}
              {F("revert_factor", "Lùi khi CPA từ lần tăng >", "× CPA mục tiêu (1.5 = 150%)", 0.1)}
              {F("hour_from", "Từ giờ", "Giờ VN")}
              {F("hour_to", "Đến giờ", "Không tăng từ giờ này")}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 13 }}>
              <label><input type="checkbox" checked={editing.nightly_reset} onChange={(e) => setEditing({ ...editing, nightly_reset: e.target.checked })} /> Reset về mức nền lúc 0h30</label>
              <label><input type="checkbox" checked={editing.dry_run} onChange={(e) => setEditing({ ...editing, dry_run: e.target.checked })} /> <b>Chạy thử</b> (chỉ ghi, không đổi thật)</label>
              <label><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Đang bật</label>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button style={btnPri} disabled={busy} onClick={saveRule}>Lưu</button>
              <button style={btn} onClick={() => setEditing(null)}>Huỷ</button>
            </div>
          </div>
        )}
      </section>

      {/* ── Camp đã gắn ── */}
      <section style={box}>
        <h2 style={h2}>2. Camp đang gắn tự scale ({camps.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tbl}>
            <thead><tr>{["Camp", "MKT", "Bộ điều kiện", "Mức nền", "Hiện tại / hôm nay", "Lần xét gần nhất", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {camps.map((c) => {
                const m = c.last_metrics || {}
                return (
                  <tr key={c.campaign_id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
                    <td style={{ ...td, maxWidth: 360 }}><div style={{ fontWeight: 600 }}>{c.campaign_name}</div><div style={{ color: "#9ca3af", fontSize: 11 }}>{c.campaign_id}</div></td>
                    <td style={td}>{c.mkt_name}</td>
                    <td style={td}>
                      <select style={inp} value={c.rule_id} onChange={(e) => setCamp(c, { rule_id: Number(e.target.value) })}>
                        {rules.map((r) => <option key={r.id} value={r.id}>{r.name}{r.dry_run ? " (thử)" : ""}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      {vnd(c.base_budget)}{" "}
                      <button style={btnSm} onClick={() => { const v = window.prompt("Mức nền mới (đ)", String(c.base_budget)); if (v) setCamp(c, { base_budget: Number(v) }) }}>sửa</button>
                    </td>
                    <td style={td}>
                      {m.budget !== undefined ? <>
                        <div>Ngân sách: <b>{vnd(m.budget)}</b></div>
                        {m.spend_today !== undefined && <div style={{ color: "#4b5563" }}>Chi {vnd(m.spend_today)} · {m.orders_today} đơn · {m.cpa_today ? vnd(m.cpa_today) + "/đơn" : "—"}</div>}
                      </> : "—"}
                    </td>
                    <td style={{ ...td, maxWidth: 320, fontSize: 12 }}>
                      <div style={{ color: "#9ca3af" }}>{time(c.last_checked_at)}</div>
                      <div>{c.last_reason || "Chưa xét"}</div>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button style={btnSm} disabled={busy} onClick={() => act(() => apiJson("/admin/auto-scale/run", "POST", { campaign_id: c.campaign_id }), "Đã xét xong")}>Xét ngay</button>{" "}
                      <button style={btnSm} onClick={() => setCamp(c, { enabled: !c.enabled })}>{c.enabled ? "Tạm dừng" : "Bật lại"}</button>{" "}
                      <button style={btnSm} onClick={() => window.confirm("Gỡ camp khỏi tự scale? Ngân sách hiện tại giữ nguyên.") && act(() => apiJson(`/admin/auto-scale/camps?campaign_id=${c.campaign_id}`, "DELETE"), "Đã gỡ").then(search)}>Gỡ</button>
                    </td>
                  </tr>
                )
              })}
              {!camps.length && <tr><td colSpan={7} style={{ ...td, color: "#6b7280", textAlign: "center" }}>Chưa gắn camp nào</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Gắn camp ── */}
      <section style={box}>
        <h2 style={h2}>3. Gắn camp vào bộ điều kiện</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input style={{ ...inp, minWidth: 320 }} placeholder="Tìm theo tên camp (vd XUANLT, ADS344, VD131)…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button style={btn} onClick={search}>Tìm</button>
          <span style={{ fontSize: 13, alignSelf: "center" }}>Gắn vào:</span>
          <select style={inp} value={pickRule} onChange={(e) => setPickRule(Number(e.target.value))}>
            {rules.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}{r.dry_run ? " (thử)" : ""}</option>)}
          </select>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 420 }}>
          <table style={tbl}>
            <thead><tr>{["Camp", "MKT", "Trạng thái", "Ngân sách", "Chi 7 ngày", "Đơn 7 ngày", "Chi/đơn", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {cands.map((c) => (
                <tr key={c.campaign_id}>
                  <td style={{ ...td, maxWidth: 420 }}>{c.campaign_name}</td>
                  <td style={td}>{c.mkt_name}</td>
                  <td style={td}>{c.effective_status}</td>
                  <td style={td}>{vnd(c.daily_budget)}</td>
                  <td style={td}>{vnd(c.spend_7d)}</td>
                  <td style={td}>{c.orders_7d}</td>
                  <td style={td}>{c.orders_7d ? vnd(Number(c.spend_7d) / c.orders_7d) : "—"}</td>
                  <td style={td}>{c.rule_id ? <span style={{ color: "#16a34a" }}>Đã gắn</span> : <button style={btnSm} disabled={busy} onClick={() => attach(c)}>Gắn</button>}</td>
                </tr>
              ))}
              {!cands.length && <tr><td colSpan={8} style={{ ...td, color: "#6b7280", textAlign: "center" }}>Không có camp CBO nào khớp</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Nhật ký ── */}
      <section style={box}>
        <h2 style={h2}>4. Nhật ký thay đổi</h2>
        <div style={{ overflowX: "auto", maxHeight: 480 }}>
          <table style={tbl}>
            <thead><tr>{["Lúc", "Camp", "Hành động", "Ngân sách", "Lý do", "Kết quả"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{time(l.created_at)}</td>
                  <td style={{ ...td, maxWidth: 340 }}>{l.campaign_name}</td>
                  <td style={{ ...td, color: ACTION[l.action]?.color, fontWeight: 600 }}>{ACTION[l.action]?.label ?? l.action}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{vnd(l.old_budget)} → {vnd(l.new_budget)}</td>
                  <td style={{ ...td, maxWidth: 380 }}>{l.reason}</td>
                  <td style={td}>{l.dry_run ? <span style={{ color: "#d97706" }}>Chạy thử</span> : l.success ? <span style={{ color: "#16a34a" }}>Đã đổi</span> : <span style={{ color: "#dc2626" }}>Lỗi: {l.error}</span>}</td>
                </tr>
              ))}
              {!logs.length && <tr><td colSpan={6} style={{ ...td, color: "#6b7280", textAlign: "center" }}>Chưa có thay đổi nào</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const box: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16 }
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: "0 0 10px" }
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 }
const th: React.CSSProperties = { padding: "6px 8px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" }
const inp: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 8px", fontSize: 13 }
const btn: React.CSSProperties = { cursor: "pointer", padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 6, background: "#f9fafb", fontSize: 13 }
const btnSm: React.CSSProperties = { ...btn, padding: "2px 8px", fontSize: 12 }
const btnPri: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff", border: "1px solid #2563eb" }

export const config = defineRouteConfig({
  label: "Tự scale camp", rank: 4,
})

export default withRouteGuard(TuScalePage)
