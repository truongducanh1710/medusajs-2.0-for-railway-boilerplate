import { useState, useEffect, useCallback, useMemo } from "react"
import { apiJson } from "../lib/api-client"

/** Mục "Theo video" của /app/content-ads: video nào chi bao nhiêu, ra đơn ra sao, chỉ số bài, lời thoại. API: /admin/ad-content/videos. */

type VRow = {
  video_id: string; post_id: string | null; post_short: string | null; page_id: string | null; page_name: string | null
  title: string | null; length_s: number | null; uploaded_at: string | null; picture: string | null; permalink: string | null
  views_3s: number | null; avg_watch_s: number | null; reactions: number | null; comments: number | null; shares: number | null
  stats_at: string | null; transcript: string | null; transcript_at: string | null
  product_code: string | null; product_name: string; mkts: string[]; ads: number; first_day: string; last_day: string; days: number
  spend: number; spend_7d: number; running: boolean; impressions: number; clicks: number
  orders: number; delivered: number; revenue: number; pct: number | null; cost_per_order: number | null; cpm: number | null; ctr: number | null
}
type VData = { from: string; to: string; synced_at: string | null; syncing: boolean; unmapped_spend: number; rows: VRow[] }
type Preset = "7" | "30" | "all" | "custom"
type SortKey = "spend" | "spend_7d" | "pct" | "orders" | "views_3s" | "uploaded_at"

// Ngưỡng đánh giá: mục tiêu % chi phí ≤ 28% (DS MKT theo mkt-today); dưới 2tr chưa đủ dữ liệu để kết luận
const TARGET_PCT = 28
const BAD_PCT = 35
const MIN_SPEND = 2_000_000
const SURE_SPEND = 5_000_000
const FIRST_DAY = "2026-07-20"

const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() + 7 * 3600e3 - n * 864e5).toISOString().slice(0, 10)
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("vi-VN"))
const tr = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr` : `${Math.round(n / 1e3)}k`)
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "—")
const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
const dt = (s: string) => new Date(s).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

type Verdict = { label: string; color: string; bg: string; rank: number }
function verdictOf(r: VRow): Verdict {
  if (r.spend < MIN_SPEND) return { label: "Ít dữ liệu", color: "#6b7280", bg: "#f3f4f6", rank: 4 }
  if (r.pct === null) return { label: "Chưa ra đơn", color: "#991b1b", bg: "#fee2e2", rank: 5 }
  if (r.pct <= TARGET_PCT) return r.spend >= SURE_SPEND
    ? { label: "Tốt", color: "#166534", bg: "#dcfce7", rank: 0 }
    : { label: "Triển vọng", color: "#1d4ed8", bg: "#dbeafe", rank: 1 }
  if (r.pct <= BAD_PCT) return { label: "Trung bình", color: "#92400e", bg: "#fef3c7", rank: 2 }
  return { label: "Kém", color: "#991b1b", bg: "#fee2e2", rank: 3 }
}

function Copy({ id, label }: { id: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      title="Sao chép"
      style={idBtn}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(id).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }) }}
    >
      {label ? <span style={{ color: "var(--fg-muted, #9ca3af)" }}>{label} </span> : null}{id} {done ? "✓" : "⧉"}
    </button>
  )
}

function Badge({ v }: { v: Verdict }) {
  return <span style={{ background: v.bg, color: v.color, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{v.label}</span>
}

function Thumb({ r, size = 48 }: { r: VRow; size?: number }) {
  return r.picture
    ? <img src={r.picture} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: size, height: Math.round(size * 1.25), objectFit: "cover", borderRadius: 4, display: "block", background: "#111" }} />
    : <div style={{ width: size, height: Math.round(size * 1.25), borderRadius: 4, background: "var(--bg-subtle, #f3f4f6)" }} />
}

function VideoModal({ r, onClose, onTranscript }: { r: VRow; onClose: () => void; onTranscript: (id: string, text: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const getTranscript = async () => {
    setBusy(true); setErr("")
    try {
      const d = await apiJson("/admin/ad-content/videos/transcript", "POST", { video_id: r.video_id })
      if (d?.transcript) onTranscript(r.video_id, d.transcript)
    } catch (e: any) {
      setErr(e.message || "Không lấy được lời thoại")
    } finally {
      setBusy(false)
    }
  }
  const v = verdictOf(r)
  const info: [string, React.ReactNode][] = [
    ["Đánh giá", <Badge v={v} />],
    ["Page", r.page_name || r.page_id || "—"],
    ["Sản phẩm", `${r.product_name}${r.product_code ? ` (${r.product_code})` : ""}`],
    ["Người chạy", r.mkts.join(", ") || "—"],
    ["Video", <Copy id={r.video_id} />],
    ["ID bài (dán vào ô Nhập ID bài viết)", r.post_short ? <Copy id={r.post_short} /> : "—"],
    ["ID bài đầy đủ", r.post_id ? <Copy id={r.post_id} /> : "—"],
    ["Độ dài / đăng ngày", `${r.length_s ?? "—"}s · ${dmy(r.uploaded_at)}`],
    ["Chạy", `${dmy(r.first_day)} → ${dmy(r.last_day)} · ${r.days} ngày có chi · ${r.ads} ad${r.running ? " · đang chạy" : ""}`],
    ["Chi / chi 7 ngày", `${num(r.spend)}đ / ${num(r.spend_7d)}đ`],
    ["Đơn / đã giao", `${num(r.orders)} / ${num(r.delivered)}`],
    ["Doanh số / % chi phí", `${num(r.revenue)}đ / ${r.pct === null ? "—" : `${r.pct}%`}`],
    ["Chi mỗi đơn", r.cost_per_order === null ? "—" : `${num(r.cost_per_order)}đ`],
    ["CPM / CTR", `${num(r.cpm)}đ / ${r.ctr === null ? "—" : `${r.ctr}%`}`],
    ["Xem 3 giây / xem TB", `${num(r.views_3s)} / ${r.avg_watch_s === null ? "—" : `${r.avg_watch_s}s`}`],
    ["Cảm xúc / bình luận / chia sẻ", `${num(r.reactions)} / ${num(r.comments)} / ${num(r.shares)}`],
  ]
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Chi tiết video">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, wordBreak: "break-word" }}>{r.title || "Video chưa đặt tên"}</div>
          <button style={btn} onClick={onClose}>Đóng</button>
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 160px", display: "grid", gap: 8 }}>
            <Thumb r={r} size={160} />
            {r.permalink && <a style={link} href={r.permalink} target="_blank" rel="noreferrer">Mở video trên Facebook</a>}
            {r.post_id && <a style={link} href={`https://www.facebook.com/${r.post_id}`} target="_blank" rel="noreferrer">Mở bài viết</a>}
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {info.map(([k, val]) => (
                  <tr key={k}>
                    <td style={{ ...sub, padding: "4px 12px 4px 0", verticalAlign: "top" }}>{k}</td>
                    <td style={{ padding: "4px 0", wordBreak: "break-word" }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border-base, #e5e7eb)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <b>Lời thoại</b>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {r.transcript_at && <span style={sub}>Lấy lúc {dt(r.transcript_at)}</span>}
              {r.transcript && (
                <button style={btn} onClick={() => navigator.clipboard?.writeText(r.transcript || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })}>
                  {copied ? "Đã chép ✓" : "Sao chép"}
                </button>
              )}
              <button style={btn} disabled={busy} onClick={getTranscript}>{busy ? "Đang nghe video..." : r.transcript ? "Lấy lại" : "Lấy lời thoại"}</button>
            </div>
          </div>
          {err && <div style={{ ...notice, background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{err}</div>}
          {r.transcript
            ? <div style={{ whiteSpace: "pre-wrap", background: "var(--bg-subtle, #f9fafb)", borderRadius: 8, padding: 12, lineHeight: 1.5, maxHeight: 360, overflowY: "auto" }}>{r.transcript}</div>
            : <div style={sub}>{busy ? "Gemini đang nghe video, thường mất 20–60 giây." : "Chưa có. Bấm \"Lấy lời thoại\" để Gemini chép lời từ video (tốn một chút phí AI)."}</div>}
        </div>
      </div>
    </div>
  )
}

export function ContentVideoTab() {
  const [preset, setPreset] = useState<Preset>("30")
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(todayVN())
  const [data, setData] = useState<VData | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [err, setErr] = useState("")
  const [page, setPage] = useState("")
  const [mkt, setMkt] = useState("")
  const [product, setProduct] = useState("")
  const [verdict, setVerdict] = useState("")
  const [q, setQ] = useState("")
  const [onlyRunning, setOnlyRunning] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>("spend")
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true); setErr("")
    try {
      const d = await apiJson(`/admin/ad-content/videos?from=${f}&to=${t}`)
      if (d) setData(d)
    } catch (e: any) {
      setErr(e.message || "Không tải được dữ liệu")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load(from, to) }, [load, from, to])

  // Lần đầu: server đang đồng bộ nền thì tự tải lại sau 20 giây
  useEffect(() => {
    if (!data?.syncing) return
    const t = setTimeout(() => load(from, to), 20000)
    return () => clearTimeout(t)
  }, [data, load, from, to])

  const choose = (p: Preset) => {
    setPreset(p)
    if (p === "7") { setFrom(daysAgo(6)); setTo(todayVN()) }
    if (p === "30") { setFrom(daysAgo(29)); setTo(todayVN()) }
    if (p === "all") { setFrom(FIRST_DAY); setTo(todayVN()) }
  }
  const refresh = async () => {
    setSyncing(true); setErr("")
    try {
      await apiJson("/admin/ad-content/videos/sync", "POST")
      await load(from, to)
    } catch (e: any) {
      setErr(e.message || "Không đồng bộ được")
    } finally {
      setSyncing(false)
    }
  }
  const setTranscript = (id: string, text: string) =>
    setData((d) => d && { ...d, rows: d.rows.map((r) => (r.video_id === id ? { ...r, transcript: text, transcript_at: new Date().toISOString() } : r)) })

  const all = data?.rows || []
  const pageName = (r: VRow) => r.page_name || r.page_id || "Chưa rõ"
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = all.filter((r) => {
      if (page && pageName(r) !== page) return false
      if (mkt && !r.mkts.includes(mkt)) return false
      if (product && r.product_name !== product) return false
      if (verdict && verdictOf(r).label !== verdict) return false
      if (onlyRunning && !r.running) return false
      if (!needle) return true
      return [r.title, r.video_id, r.post_id, r.transcript, pageName(r), r.product_name].some((s) => (s || "").toLowerCase().includes(needle))
    })
    const val = (r: VRow): number =>
      sortBy === "pct" ? (r.spend >= MIN_SPEND && r.pct !== null ? r.pct : 9999)
        : sortBy === "uploaded_at" ? -(r.uploaded_at ? Date.parse(r.uploaded_at) : 0)
          : -(r[sortBy] ?? -1)
    return list.sort((a, b) => val(a) - val(b) || b.spend - a.spend)
  }, [all, page, mkt, product, verdict, onlyRunning, q, sortBy])

  const sum = rows.reduce((t, r) => ({ s: t.s + r.spend, o: t.o + r.orders, ds: t.ds + r.revenue }), { s: 0, o: 0, ds: 0 })
  const counts = rows.reduce((m, r) => { const k = verdictOf(r).label; m[k] = (m[k] || 0) + 1; return m }, {} as Record<string, number>)
  const options = (get: (r: VRow) => string[]) => {
    const m = new Map<string, number>()
    for (const r of all) for (const k of get(r)) m.set(k, (m.get(k) || 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "vi"))
  }
  const opened = openId ? all.find((r) => r.video_id === openId) || null : null
  const hasFilter = !!(page || mkt || product || verdict || q || onlyRunning)

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div style={toolbarRow}>
          <div style={seg}>
            {([["7", "7 ngày"], ["30", "30 ngày"], ["all", "Từ 20/7"], ["custom", "Tuỳ chọn"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => choose(k)} aria-pressed={preset === k} style={{ ...segBtn, ...(preset === k ? segOn : {}) }}>{l}</button>
            ))}
          </div>
          {preset === "custom" && (
            <>
              <input type="date" style={inp} value={from} min={FIRST_DAY} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Từ ngày" />
              <span style={sub}>→</span>
              <input type="date" style={inp} value={to} min={from} max={todayVN()} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Đến ngày" />
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={sub}>{data?.synced_at ? `Chỉ số video cập nhật ${dt(data.synced_at)}` : ""}</span>
          <button style={btn} disabled={syncing} onClick={refresh}>{syncing ? "Đang đọc Facebook..." : "Làm mới chỉ số video"}</button>
        </div>
      </div>

      {err && <div style={{ ...notice, background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{err}</div>}
      {data?.syncing && !all.length && <div style={notice}>Đang đọc video của các ad lần đầu, mất vài phút. Trang tự tải lại.</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Video có chi" value={String(rows.length)} />
        <Stat label="Chi" value={tr(sum.s)} />
        <Stat label="Đơn" value={num(sum.o)} />
        <Stat label="% chi phí" value={sum.ds ? `${(sum.s / sum.ds * 100).toFixed(1)}%` : "—"} />
        <Stat label="Tốt" value={String(counts["Tốt"] || 0)} color="#166534" />
        <Stat label="Triển vọng" value={String(counts["Triển vọng"] || 0)} color="#1d4ed8" />
        <Stat label="Kém / chưa ra đơn" value={String((counts["Kém"] || 0) + (counts["Chưa ra đơn"] || 0))} color="#991b1b" />
      </div>

      <div style={toolbarRow}>
        <select style={inp} aria-label="Page" value={page} onChange={(e) => setPage(e.target.value)}>
          <option value="">Mọi page</option>
          {options((r) => [pageName(r)]).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select style={inp} aria-label="Sản phẩm" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">Mọi sản phẩm</option>
          {options((r) => [r.product_name]).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select style={inp} aria-label="Người chạy" value={mkt} onChange={(e) => setMkt(e.target.value)}>
          <option value="">Mọi người chạy</option>
          {options((r) => r.mkts).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select style={inp} aria-label="Đánh giá" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
          <option value="">Mọi đánh giá</option>
          {["Tốt", "Triển vọng", "Trung bình", "Kém", "Chưa ra đơn", "Ít dữ liệu"].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> Đang chạy
        </label>
        <input style={{ ...inp, flex: "1 1 220px", minWidth: 180 }} placeholder="Tìm tiêu đề, lời thoại, ID video/bài" value={q} onChange={(e) => setQ(e.target.value)} />
        {hasFilter && <button style={btn} onClick={() => { setPage(""); setMkt(""); setProduct(""); setVerdict(""); setQ(""); setOnlyRunning(false) }}>Xoá lọc</button>}
        <label>Sắp xếp{" "}
          <select style={inp} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
            <option value="spend">Chi nhiều</option>
            <option value="spend_7d">Chi 7 ngày</option>
            <option value="pct">% chi phí thấp</option>
            <option value="orders">Nhiều đơn</option>
            <option value="views_3s">Xem 3 giây</option>
            <option value="uploaded_at">Mới đăng</option>
          </select>
        </label>
      </div>

      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={tbl}>
          <thead>
            <tr>
              {["", "Video", "Đánh giá", "Chi", "Đơn", "%", "Chi/đơn", "CPM", "CTR", "Xem 3s", "Xem TB", "👍 / 💬 / ↗", "Chạy", "Chi 7N"].map((h, i) => (
                <th key={i} style={{ ...th, textAlign: i >= 3 && i !== 12 ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = verdictOf(r)
              return (
                <tr key={r.video_id} style={{ cursor: "pointer" }} onClick={() => setOpenId(r.video_id)}>
                  <td style={td}><Thumb r={r} /></td>
                  <td style={{ ...td, minWidth: 260, maxWidth: 380 }}>
                    <div style={clamp2} title={r.title || ""}>{r.title || <span style={sub}>Video chưa đặt tên</span>}</div>
                    <div style={sub}>{pageName(r)} · {r.product_name} · {r.length_s ?? "—"}s · đăng {dmy(r.uploaded_at)}{r.transcript ? " · có lời thoại" : ""}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Copy id={r.video_id} label="Video" />
                      {r.post_short && <Copy id={r.post_short} label="Bài" />}
                    </div>
                  </td>
                  <td style={td}><Badge v={v} /></td>
                  <td style={{ ...td, ...right, fontWeight: 600 }}>{tr(r.spend)}</td>
                  <td style={{ ...td, ...right }}>{num(r.orders)}</td>
                  <td style={{ ...td, ...right, fontWeight: 600, color: v.color }}>{r.pct === null ? "—" : `${r.pct}%`}</td>
                  <td style={{ ...td, ...right }}>{r.cost_per_order === null ? "—" : `${Math.round(r.cost_per_order / 1000)}k`}</td>
                  <td style={{ ...td, ...right }}>{r.cpm === null ? "—" : `${Math.round(r.cpm / 1000)}k`}</td>
                  <td style={{ ...td, ...right }}>{r.ctr === null ? "—" : `${r.ctr}%`}</td>
                  <td style={{ ...td, ...right }}>{num(r.views_3s)}</td>
                  <td style={{ ...td, ...right }}>{r.avg_watch_s === null ? "—" : `${r.avg_watch_s}s`}</td>
                  <td style={{ ...td, ...right }}>{num(r.reactions)} / {num(r.comments)} / {num(r.shares)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div>{r.running && <span title="Có chi hôm qua hoặc hôm nay" style={{ color: "#16a34a" }}>● </span>}{dm(r.first_day)} → {dm(r.last_day)}</div>
                    <div style={sub}>{r.ads} ad · {r.mkts.join(", ")}</div>
                  </td>
                  <td style={{ ...td, ...right }}>{r.spend_7d ? tr(r.spend_7d) : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <div style={{ ...sub, textAlign: "center", padding: 32 }}>{loading ? "Đang tải..." : "Không có video nào khớp bộ lọc"}</div>}

      <div style={{ ...sub, marginTop: 10, lineHeight: 1.6 }}>
        Chi lấy theo ad (có dữ liệu từ 20/7/2026){data?.unmapped_spend ? `, ${tr(data.unmapped_spend)} chi của ad chưa đọc được video không tính` : ""}.
        Đơn và doanh số đo như báo cáo MKT, ghép theo camp; camp có nhiều video thì chia đơn theo tỷ lệ tiền của từng ad. Camp không gắn UTM sẽ không có đơn.
        Đánh giá: Tốt = chi từ 5tr và ≤ {TARGET_PCT}%, Triển vọng = ≤ {TARGET_PCT}% nhưng chi 2–5tr, Kém = trên {BAD_PCT}%, dưới 2tr là ít dữ liệu.
        Xem 3 giây, cảm xúc, bình luận, chia sẻ là số trọn đời của bài, không theo khoảng ngày.
      </div>

      {opened && <VideoModal r={opened} onClose={() => setOpenId(null)} onTranscript={setTranscript} />}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: "1px solid var(--border-base, #e5e7eb)", borderRadius: 8, padding: "8px 14px", minWidth: 110 }}>
      <div style={sub}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

const toolbarRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }
const seg: React.CSSProperties = { display: "inline-flex", border: "1px solid var(--border-base, #d1d5db)", borderRadius: 6, overflow: "hidden" }
const segBtn: React.CSSProperties = { cursor: "pointer", padding: "5px 12px", border: 0, background: "transparent", color: "inherit", fontSize: 13 }
const segOn: React.CSSProperties = { background: "#111827", color: "#fff" }
const clamp2: React.CSSProperties = { fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, overflowY: "auto" }
const modal: React.CSSProperties = { background: "var(--bg-base, #fff)", color: "var(--fg-base, #111827)", borderRadius: 12, padding: 18, width: "100%", maxWidth: 820, fontSize: 13 }
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 }
const th: React.CSSProperties = { padding: "6px 8px", borderBottom: "2px solid var(--border-base, #e5e7eb)", whiteSpace: "nowrap", fontWeight: 600 }
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border-base, #f3f4f6)", verticalAlign: "top" }
const right: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" }
const sub: React.CSSProperties = { color: "var(--fg-subtle, #6b7280)", fontSize: 12 }
const inp: React.CSSProperties = { border: "1px solid var(--border-base, #d1d5db)", borderRadius: 6, padding: "5px 8px", fontSize: 13, background: "var(--bg-field, #fff)", color: "inherit" }
const btn: React.CSSProperties = { cursor: "pointer", padding: "5px 10px", border: "1px solid var(--border-base, #d1d5db)", borderRadius: 6, background: "var(--bg-subtle, #f9fafb)", color: "inherit", fontSize: 13 }
const notice: React.CSSProperties = { padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 6, marginBottom: 12 }
const link: React.CSSProperties = { color: "#2563eb", fontSize: 13 }
const idBtn: React.CSSProperties = { display: "inline-block", padding: 0, border: 0, background: "none", color: "var(--fg-subtle, #6b7280)", cursor: "pointer", fontSize: 12, textAlign: "left", wordBreak: "break-all" }
