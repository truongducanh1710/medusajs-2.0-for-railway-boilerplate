import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

type Rule = {
  id?: number; name: string; target_cpa: number; min_orders: number; spend_ratio: number; multiplier: number
  max_budget: number; cooldown_min: number; revert_factor: number; hour_from: number; hour_to: number
  nightly_reset: boolean; dry_run: boolean; active: boolean; camp_count?: number
  pause_enabled: boolean; pause_day_spend: number; pause_cost_pct: number; pause_resume: boolean
  pause_max_streak: number; pause_min_age_hours: number; pause_dry_run: boolean
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
type MktSetting = {
  mkt_name: string; enabled: boolean; dry_run: boolean; max_pct: number; lenient_max_pct: number
  trim_hour: number; trim_spend: number; trim_min_spend: number; trim_camp_pct: number
}
type Mkt = { mkt_name: string; setting: MktSetting | null; today: { spend: number; revenue: number; orders: number; pct: number | null } | null }
const MKT_MAC_DINH = { enabled: true, dry_run: true, max_pct: 27, lenient_max_pct: 70, trim_hour: 16, trim_spend: 0, trim_min_spend: 400000, trim_camp_pct: 40 }

type Log = {
  id: number; campaign_name: string; action: string; old_budget: number; new_budget: number; reason: string
  dry_run: boolean; success: boolean; error: string | null; created_at: string
}

// Mặc định theo cách XUANLT scale (rà 115 lần tăng ngân sách trên Ads344)
const MAC_DINH: Rule = {
  name: "Kiểu XUANLT — nhân đôi khi ra đơn", target_cpa: 200000, min_orders: 2, spend_ratio: 1, multiplier: 2,
  max_budget: 4000000, cooldown_min: 120, revert_factor: 1.5, hour_from: 9, hour_to: 19,
  nightly_reset: true, dry_run: true, active: true,
  pause_enabled: false, pause_day_spend: 300000, pause_cost_pct: 45, pause_resume: true,
  pause_max_streak: 3, pause_min_age_hours: 0, pause_dry_run: true,
}

const vnd = (n: any) => (n === null || n === undefined || n === "" ? "—" : `${Math.round(Number(n)).toLocaleString("vi-VN")}đ`)
const time = (s: string | null) => (s ? new Date(s).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "—")
const ACTION: Record<string, { label: string; color: string }> = {
  tang: { label: "🚀 Tăng", color: "#16a34a" },
  lui: { label: "↩️ Lùi", color: "#d97706" },
  reset: { label: "🌙 Reset", color: "#6b7280" },
  tat: { label: "⛔ Phanh (tắt)", color: "#dc2626" },
  bat: { label: "▶️ Bật lại", color: "#2563eb" },
  ctr_drop: { label: "⚠️ CTR tụt (chạy thử)", color: "#d97706" },
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
  const [mkts, setMkts] = useState<Mkt[]>([])
  const [editMkt, setEditMkt] = useState<MktSetting | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const d = await apiJson("/admin/auto-scale")
    if (!d) return
    setRules(d.rules || []); setCamps(d.camps || []); setLogs(d.logs || []); setMkts(d.mkts || [])
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

  const saveMkt = () => editMkt && act(async () => {
    const r = await apiJson("/admin/auto-scale/mkt", "POST", editMkt)
    if (!r?.error) setEditMkt(null)
    return r
  }, "Đã lưu cài đặt tổng theo MKT")

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
        sau lần tăng mà đơn không về tương xứng → <b>lùi</b> về mức trước (xét cả ngoài khung giờ). Từ <b>0h30</b> mỗi đêm → <b>reset</b> về mức nền.
        Bộ điều kiện bật <b>phanh ngày xấu</b> thì xét 24/7 theo số liệu <b>riêng hôm nay</b>: đã chi ≥ ngưỡng mà % chi phí hôm nay (chi / doanh số) quá mức → <b>tắt camp tới hết ngày</b>,
        0h30 hôm sau <b>tự bật lại</b> ở mức nền; xấu N ngày liền thì để tắt hẳn chờ người quyết. Ngày tốt tăng ga, ngày xấu phanh.
        Chỉ hỗ trợ camp CBO. Mọi thay đổi nhắn Telegram cho MKT của camp + super admin.
        <br />Bộ điều kiện ở chế độ <b>CHẠY THỬ</b> chỉ ghi nhật ký "lẽ ra đã tăng", không đổi ngân sách thật.
      </p>
      {msg && <div style={{ padding: "8px 12px", background: msg.startsWith("❌") ? "#fef2f2" : "#f0fdf4", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {/* ── Tổng theo MKT ── */}
      <section style={box}>
        <h2 style={h2}>0. Tổng theo MKT — giữ % chi phí cả MKT trong ngày</h2>
        <p style={{ color: "#4b5563", fontSize: 12, margin: "0 0 8px", lineHeight: 1.6 }}>
          Số hôm nay lấy đúng công thức báo cáo <b>COD theo MKT</b>. Tổng ≤ mục tiêu: camp lẽ ra bị phanh vẫn được <b>chạy thêm</b> nếu chưa quá tệ và CTR hôm nay ≥ CTR 7 ngày của MKT.
          Từ <b>giờ tỉa</b> (hoặc khi tổng chi đạt mức đặt) mà tổng &gt; mục tiêu: cứ 15 phút <b>tắt 1 camp xấu nhất</b> (% hôm nay của camp &gt; ngưỡng tỉa, vd 40%) — dần chỉ còn camp tốt. Camp bị tỉa 0h30 hôm sau tự bật lại như phanh.
          Chỉ tác động camp đã gắn ở mục 2 và thuộc bộ điều kiện bật phanh.
        </p>
        <table style={tbl}>
          <thead><tr>{["MKT", "Hôm nay chi", "Doanh số", "% chi phí", "Mục tiêu ≤", "Cho chạy thêm tới", "Tỉa từ", "Tỉa camp khi", "Chế độ", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {mkts.map((m) => {
              const st = m.setting
              const pct = m.today?.pct
              return (
                <tr key={m.mkt_name} style={{ opacity: st?.enabled ? 1 : 0.6 }}>
                  <td style={td}><b>{m.mkt_name}</b></td>
                  <td style={td}>{vnd(m.today?.spend ?? 0)}</td>
                  <td style={td}>{vnd(m.today?.revenue ?? 0)}</td>
                  <td style={{ ...td, fontWeight: 700, color: pct == null ? "#6b7280" : st && pct > Number(st.max_pct) ? "#dc2626" : "#16a34a" }}>{pct == null ? "—" : `${pct}%`}</td>
                  <td style={td}>{st ? `${Number(st.max_pct)}%` : "—"}</td>
                  <td style={td}>{st ? `camp ≤ ${Number(st.lenient_max_pct)}%` : "—"}</td>
                  <td style={td}>{st ? `${st.trim_hour}h${Number(st.trim_spend) > 0 ? ` hoặc tổng chi ≥ ${vnd(st.trim_spend)}` : ""}` : "—"}</td>
                  <td style={td}>{st ? `chi ≥ ${vnd(st.trim_min_spend)} và > ${Number(st.trim_camp_pct ?? 40)}%` : "—"}</td>
                  <td style={td}>{!st?.enabled ? <span style={{ color: "#6b7280" }}>Chưa bật</span> : st.dry_run ? <span style={{ color: "#d97706", fontWeight: 600 }}>TỈA CHẠY THỬ</span> : <span style={{ color: "#16a34a", fontWeight: 600 }}>ĐANG CHẠY THẬT</span>}</td>
                  <td style={td}><button style={btn} onClick={() => setEditMkt(st ? { ...st, max_pct: Number(st.max_pct), lenient_max_pct: Number(st.lenient_max_pct), trim_spend: Number(st.trim_spend), trim_min_spend: Number(st.trim_min_spend), trim_camp_pct: Number(st.trim_camp_pct ?? 40) } : { mkt_name: m.mkt_name, ...MKT_MAC_DINH })}>{st ? "Sửa" : "Bật"}</button></td>
                </tr>
              )
            })}
            {!mkts.length && <tr><td colSpan={10} style={{ ...td, color: "#6b7280", textAlign: "center" }}>Gắn camp ở mục 2 trước — MKT của camp sẽ hiện ở đây</td></tr>}
          </tbody>
        </table>
        {editMkt && (
          <div style={{ marginTop: 12, padding: 14, border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 8 }}>
            <b>{editMkt.mkt_name}</b>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
              {([
                ["max_pct", "Mục tiêu % chi phí tổng ≤", "Vd 27 (giữ 25–27%)"],
                ["lenient_max_pct", "Cho camp chạy thêm nếu camp ≤ (%)", "Khi tổng đang tốt; quá mức này vẫn phanh"],
                ["trim_hour", "Bắt đầu tỉa từ giờ", "Giờ VN, vd 13"],
                ["trim_spend", "Hoặc khi tổng chi MKT hôm nay ≥ (đ)", "0 = chỉ theo giờ"],
                ["trim_min_spend", "Camp chi ≥ (đ) mới bị tỉa", "Đủ mẫu mới phán"],
                ["trim_camp_pct", "Chỉ tỉa camp có % hôm nay >", "Camp gần mục tiêu thì giữ, vd 40"],
              ] as [keyof MktSetting, string, string][]).map(([k, label, hint]) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, minWidth: 170 }}>
                  <span style={{ fontWeight: 600 }}>{label}</span>
                  <input style={inp} type="number" value={editMkt[k] as any} onChange={(e) => setEditMkt({ ...editMkt, [k]: Number(e.target.value) })} />
                  <span style={{ color: "#6b7280" }}>{hint}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 13 }}>
              <label><input type="checkbox" checked={editMkt.enabled} onChange={(e) => setEditMkt({ ...editMkt, enabled: e.target.checked })} /> Bật quản lý tổng</label>
              <label><input type="checkbox" checked={editMkt.dry_run} onChange={(e) => setEditMkt({ ...editMkt, dry_run: e.target.checked })} /> <b>Tỉa: chạy thử</b> (chỉ ghi "lẽ ra đã tỉa")</label>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button style={btnPri} disabled={busy} onClick={saveMkt}>Lưu</button>
              <button style={btn} onClick={() => setEditMkt(null)}>Huỷ</button>
            </div>
          </div>
        )}
      </section>

      {/* ── Bộ điều kiện ── */}
      <section style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>1. Bộ điều kiện</h2>
          <button style={btnPri} onClick={() => setEditing({ ...MAC_DINH })}>+ Tạo bộ điều kiện</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tbl}>
            <thead><tr>
              {["Tên", "CPA mục tiêu", "Đơn tối thiểu", "Nhịp tiêu ≥", "Nhân", "Trần/ngày", "Chờ giữa 2 lần", "Lùi khi CPA >", "Khung giờ", "Reset 0h30", "Phanh ngày xấu", "Chế độ", "Camp", ""].map((h) => <th key={h} style={th}>{h}</th>)}
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
                  <td style={td}>{!r.pause_enabled ? <span style={{ color: "#6b7280" }}>Không</span> : <>
                    <div>Chi ≥ {vnd(r.pause_day_spend)} và % chi phí hôm nay &gt; {Number(r.pause_cost_pct)}%</div>
                    <div>{r.pause_resume ? `Sáng mai bật lại; xấu ${r.pause_max_streak} ngày liền thì tắt hẳn` : "Tắt hẳn, không tự bật lại"}</div>
                    <div style={{ color: r.pause_dry_run ? "#d97706" : "#dc2626", fontWeight: 600 }}>{r.pause_dry_run ? "CHẠY THỬ" : "TẮT THẬT"}</div>
                  </>}</td>
                  <td style={td}>{!r.active ? <span style={{ color: "#6b7280" }}>Tắt</span> : r.dry_run ? <span style={{ color: "#d97706", fontWeight: 600 }}>CHẠY THỬ</span> : <span style={{ color: "#16a34a", fontWeight: 600 }}>ĐANG CHẠY THẬT</span>}</td>
                  <td style={td}>{r.camp_count}</td>
                  <td style={td}>
                    <button style={btn} onClick={() => setEditing({ ...r, spend_ratio: Number(r.spend_ratio), multiplier: Number(r.multiplier), revert_factor: Number(r.revert_factor), target_cpa: Number(r.target_cpa), max_budget: Number(r.max_budget), pause_day_spend: Number(r.pause_day_spend), pause_cost_pct: Number(r.pause_cost_pct) })}>Sửa</button>{" "}
                    {!r.camp_count && <button style={btn} onClick={() => window.confirm(`Xoá "${r.name}"?`) && act(() => apiJson(`/admin/auto-scale/rules?id=${r.id}`, "DELETE"), "Đã xoá")}>Xoá</button>}
                  </td>
                </tr>
              ))}
              {!rules.length && <tr><td colSpan={14} style={{ ...td, color: "#6b7280", textAlign: "center" }}>Chưa có bộ điều kiện nào — bấm "+ Tạo bộ điều kiện"</td></tr>}
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
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed #a5b4fc" }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                <input type="checkbox" checked={editing.pause_enabled} onChange={(e) => setEditing({ ...editing, pause_enabled: e.target.checked })} /> ⛔ Phanh ngày xấu (xét 24/7 theo số liệu hôm nay)
              </label>
              {editing.pause_enabled && <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
                  {F("pause_day_spend", "Xét khi hôm nay đã chi ≥ (đ)", "Đủ mẫu mới phán — mô phỏng: 300k")}
                  {F("pause_cost_pct", "Phanh khi % chi phí hôm nay >", "Chi / doanh số hôm nay; 0 đơn = vô cùng", 1)}
                  {F("pause_max_streak", "Tắt hẳn sau số ngày xấu liền", "Không tự bật lại nữa, báo người")}
                  {F("pause_min_age_hours", "Không phanh camp mới dưới (giờ)", "0 = phanh cả camp mới")}
                </div>
                <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>
                  <input type="checkbox" checked={editing.pause_resume} onChange={(e) => setEditing({ ...editing, pause_resume: e.target.checked })} /> Sáng hôm sau (0h30) tự bật lại ở mức nền
                </label>
                <label style={{ fontSize: 13, display: "block", marginTop: 4 }}>
                  <input type="checkbox" checked={editing.pause_dry_run} onChange={(e) => setEditing({ ...editing, pause_dry_run: e.target.checked })} /> <b>Phanh: chạy thử</b> (chỉ ghi "lẽ ra đã phanh", riêng với phần tăng ngân sách)
                </label>
              </>}
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
