import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback, useMemo, Fragment } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

type Card = {
  type: "video" | "image"; video_url: string | null; poster: string | null; aspect_ratio: number | null; duration_ms: number | null
  display: string | null; headline: string | null; description: string | null; cta: string | null; link: string | null
}
type Preview = { page_name: string | null; page_avatar: string | null; message: string | null; cards: Card[]; reactions: string | null; comments: string | null; shares: string | null }
type Row = {
  ad_id: string; ad_name: string; vd_code: string | null; created_time: string
  preview_url: string | null; ads_manager_url: string
  campaign_id: string; campaign_name: string; campaign_budget: number | null
  adset_id: string; adset_name: string; adset_budget: number | null
  account_id: string; account_name: string; mkt: string
  product_code: string | null; product_name: string
  page_id: string | null; page_name: string | null; post_id: string | null; post_url: string | null; creative_id: string | null
  titles: string[]; descriptions: string[]; bodies: string[]; cta: string | null; landing: string | null; thumbnail: string | null
  preview: Preview | null
  spend_today: number; spend_7d: number; ctr_7d: number | null; cpm_7d: number | null; orders_7d: number
}
type Data = { generated_at: string; accounts_checked: number; errors: { account: string; error: string }[]; rows: Row[] }
type GroupBy = "" | "title" | "product" | "account" | "mkt" | "page"
type SortBy = "spend_today" | "spend_7d" | "created_time"

const NO_TITLE = "Chưa có tiêu đề"
const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "", label: "Không gộp" },
  { key: "title", label: "Tiêu đề" },
  { key: "product", label: "Sản phẩm" },
  { key: "account", label: "Tài khoản" },
  { key: "mkt", label: "Người chạy" },
  { key: "page", label: "Page" },
]

const vnd = (n: number | null) => (n === null ? "—" : `${Math.round(n).toLocaleString("vi-VN")}đ`)
const dt = (s: string) => new Date(s).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
const titleOf = (r: Row) => (r.titles.length ? r.titles.join(" | ") : NO_TITLE)
const pageOf = (r: Row) => r.page_name || r.page_id || "Chưa rõ"
const groupValue = (r: Row, g: GroupBy) =>
  g === "title" ? titleOf(r) : g === "product" ? r.product_name : g === "account" ? r.account_name : g === "mkt" ? r.mkt : g === "page" ? pageOf(r) : ""
const domainOf = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "").toUpperCase() : null } catch { return null } }

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      title="Sao chép ID"
      style={idBtn}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(id).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }) }}
    >
      {id} {done ? "✓" : "⧉"}
    </button>
  )
}

function Options({ rows, get, all }: { rows: Row[]; get: (r: Row) => string; all: string }) {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(get(r), (counts.get(get(r)) || 0) + 1)
  return (
    <>
      <option value="">{all}</option>
      {[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "vi")).map(([v, n]) => <option key={v} value={v}>{v.length > 60 ? `${v.slice(0, 60)}…` : v} ({n})</option>)}
    </>
  )
}

/** Dựng lại bài quảng cáo như khách thấy trên điện thoại. Màu cố định theo Facebook, không đổi theo giao diện admin. */
function AdMock({ r, expanded }: { r: Row; expanded?: boolean }) {
  const [more, setMore] = useState(!!expanded)
  const p = r.preview
  const card: Partial<Card> = p?.cards[0] || {}
  const message = p?.message || r.bodies[0] || ""
  const headline = card.headline || r.titles[0] || null
  const poster = card.poster || r.thumbnail
  const ratio = Math.max(card.aspect_ratio || 0.8, 0.8)
  const cta = card.cta || r.cta
  return (
    <div style={fb.wrap}>
      <div style={fb.head}>
        {p?.page_avatar
          ? <img src={p.page_avatar} alt="" referrerPolicy="no-referrer" loading="lazy" style={fb.avatar} />
          : <div style={{ ...fb.avatar, background: "#e4e6eb" }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={fb.page}>{pageOf(r)}</div>
          <div style={fb.meta}>Quảng cáo · 🌐</div>
        </div>
        <div style={{ color: "#65676b", fontSize: 15, whiteSpace: "nowrap" }}>··· ✕</div>
      </div>
      {message && (
        <div style={fb.body}>
          <div style={more ? { whiteSpace: "pre-wrap" } : fb.clamp3}>{message}</div>
          {!more && message.length > 90 && <button style={fb.more} onClick={(e) => { e.stopPropagation(); setMore(true) }}>Xem thêm</button>}
        </div>
      )}
      <div style={{ background: "#000", aspectRatio: String(ratio), position: "relative" }}>
        {card.video_url
          ? <video
              src={card.video_url} poster={poster || undefined} controls preload="none" playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              onClick={(e) => e.stopPropagation()}
              onPlay={(e) => document.querySelectorAll("video").forEach((v) => { if (v !== e.currentTarget) v.pause() })}
            />
          : poster
            ? <img src={poster} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ color: "#fff", padding: 24, textAlign: "center", fontSize: 12 }}>Không có ảnh xem trước</div>}
      </div>
      <div style={fb.foot}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={fb.domain}>{card.display || domainOf(card.link || r.landing) || ""}</div>
          {headline
            ? <div style={fb.headline} title={headline}>{headline}</div>
            : <div style={{ ...fb.headline, color: "#b45309", fontWeight: 500 }}>{NO_TITLE}</div>}
          {card.description && <div style={fb.desc}>{card.description}</div>}
        </div>
        {cta && <div style={fb.cta}>{cta}</div>}
      </div>
      {(p?.reactions || p?.comments || p?.shares) && (
        <div style={fb.ufi}>
          <span>{p?.reactions || ""}</span>
          <span>{[p?.comments, p?.shares].filter(Boolean).join(" · ")}</span>
        </div>
      )}
      <div style={fb.actions}><span>Thích</span><span>Bình luận</span><span>Chia sẻ</span></div>
    </div>
  )
}

function AdCard({ r, onOpen }: { r: Row; onOpen: () => void }) {
  return (
    <div style={cardBox}>
      <AdMock r={r} />
      {!r.preview && <div style={warnLine}>Chưa lấy được bản xem trước, đang hiện dữ liệu creative</div>}
      <div style={{ padding: "10px 12px", display: "grid", gap: 6, fontSize: 12 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <span style={tag}>{r.product_name}</span>
          <span style={tag}>{r.mkt}</span>
          <span style={tag}>{r.account_name}</span>
          {r.vd_code && <span style={tag}>{r.vd_code}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px" }}>
          <Metric label="Chi hôm nay" value={vnd(r.spend_today)} />
          <Metric label="Chi 7 ngày" value={vnd(r.spend_7d)} />
          <Metric label="CTR 7N" value={r.ctr_7d === null ? "—" : `${r.ctr_7d.toFixed(2)}%`} />
          <Metric label="Đơn UTM 7N" value={String(r.orders_7d)} />
        </div>
        <CopyId id={r.ad_id} />
        <button style={{ ...btn, width: "100%" }} onClick={onOpen}>Xem chi tiết</button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><span style={sub}>{label}</span><b style={{ fontWeight: 600 }}>{value}</b></div>
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td style={{ ...sub, padding: "5px 12px 5px 0", verticalAlign: "top", whiteSpace: "nowrap" }}>{label}</td>
      <td style={{ padding: "5px 0", wordBreak: "break-word" }}>{children}</td>
    </tr>
  )
}

function DetailModal({ r, onClose }: { r: Row; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const links: [string, string | null][] = [["Xem trên Facebook", r.preview_url], ["Bài viết", r.post_url], ["Landing", r.landing], ["Trình quản lý quảng cáo", r.ads_manager_url]]
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Chi tiết ad ${r.ad_name}`}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, wordBreak: "break-word" }}>{r.ad_name}</div>
          <button style={btn} onClick={onClose}>Đóng</button>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 320px", maxWidth: "100%", border: "1px solid var(--border-base, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
            <AdMock r={r} expanded />
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                <InfoRow label="Tiêu đề">{r.titles.length ? r.titles.map((t) => <div key={t} style={{ fontWeight: 600 }}>{t}</div>) : NO_TITLE}</InfoRow>
                {!!r.descriptions.length && <InfoRow label="Mô tả">{r.descriptions.map((d) => <div key={d}>{d}</div>)}</InfoRow>}
                <InfoRow label="Sản phẩm">{r.product_name}{r.product_code ? ` (${r.product_code})` : ""}</InfoRow>
                <InfoRow label="Người chạy">{r.mkt}</InfoRow>
                <InfoRow label="Tài khoản">{r.account_name} <CopyId id={r.account_id} /></InfoRow>
                <InfoRow label="Page">{pageOf(r)} {r.page_id && <CopyId id={r.page_id} />}</InfoRow>
                <InfoRow label="ID ad"><CopyId id={r.ad_id} /></InfoRow>
                <InfoRow label="Video">{r.vd_code || "—"}</InfoRow>
                <InfoRow label="Tạo lúc">{dt(r.created_time)}</InfoRow>
                <InfoRow label="Camp">{r.campaign_name} <CopyId id={r.campaign_id} /></InfoRow>
                <InfoRow label="Nhóm QC">{r.adset_name} <CopyId id={r.adset_id} /></InfoRow>
                <InfoRow label="Ngân sách/ngày">{r.campaign_budget ? `${vnd(r.campaign_budget)} (camp)` : r.adset_budget ? `${vnd(r.adset_budget)} (nhóm)` : "—"}</InfoRow>
                {r.post_id && <InfoRow label="ID bài"><CopyId id={r.post_id} /></InfoRow>}
                {r.creative_id && <InfoRow label="ID creative"><CopyId id={r.creative_id} /></InfoRow>}
                <InfoRow label="Nút">{r.cta || "—"}</InfoRow>
                <InfoRow label="Landing">{r.landing || "—"}</InfoRow>
                <InfoRow label="Chi hôm nay / 7N">{vnd(r.spend_today)} / {vnd(r.spend_7d)}</InfoRow>
                <InfoRow label="CTR / CPM 7N">{r.ctr_7d === null ? "—" : `${r.ctr_7d.toFixed(2)}%`} / {vnd(r.cpm_7d)}</InfoRow>
                <InfoRow label="Đơn UTM 7N">{r.orders_7d}</InfoRow>
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              {links.filter(([, u]) => u).map(([l, u]) => <a key={l} style={link} href={u as string} target="_blank" rel="noreferrer">{l}</a>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ContentAdsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [mkt, setMkt] = useState("")
  const [product, setProduct] = useState("")
  const [account, setAccount] = useState("")
  const [title, setTitle] = useState("")
  const [q, setQ] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("title")
  const [sortBy, setSortBy] = useState<SortBy>("spend_today")
  const [view, setView] = useState<"cards" | "table">("cards")
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setErr("")
    try {
      const d = await apiJson(`/admin/ad-content${refresh ? "?refresh=1" : ""}`)
      if (d) setData(d)
    } catch (e: any) {
      setErr(e.message || "Không tải được dữ liệu")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = (data?.rows || []).filter((r) => {
      if (mkt && r.mkt !== mkt) return false
      if (product && r.product_name !== product) return false
      if (account && r.account_name !== account) return false
      if (title && titleOf(r) !== title) return false
      if (!needle) return true
      return [r.ad_id, r.ad_name, r.vd_code, r.campaign_id, r.campaign_name, r.post_id, pageOf(r), ...r.titles, ...r.descriptions, ...r.bodies]
        .some((s) => (s || "").toLowerCase().includes(needle))
    })
    return list.sort((a, b) => sortBy === "created_time"
      ? b.created_time.localeCompare(a.created_time)
      : b[sortBy] - a[sortBy] || b.spend_7d - a.spend_7d)
  }, [data, mkt, product, account, title, q, sortBy])

  const groups = useMemo(() => {
    if (!groupBy) return [{ key: "", rows }]
    const m = new Map<string, Row[]>()
    for (const r of rows) {
      const k = groupValue(r, groupBy)
      m.set(k, [...(m.get(k) || []), r])
    }
    const sum = (a: Row[]) => a.reduce((t, r) => t + r.spend_7d, 0)
    return [...m.entries()].map(([key, rows]) => ({ key, rows })).sort((a, b) => sum(b.rows) - sum(a.rows))
  }, [rows, groupBy])

  const totalToday = rows.reduce((t, r) => t + r.spend_today, 0)
  const distinctTitles = new Set(rows.filter((r) => r.titles.length).map(titleOf)).size
  const noTitle = rows.filter((r) => !r.titles.length).length
  const noPreview = rows.filter((r) => !r.preview).length
  const hasFilter = !!(mkt || product || account || title || q)
  const opened = openId ? (data?.rows || []).find((r) => r.ad_id === openId) || null : null
  const all = data?.rows || []

  return (
    <div style={{ padding: 16, fontSize: 13, color: "var(--fg-base, #111827)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Content ads đang chạy</h1>
          <div style={{ ...sub, fontSize: 13, marginTop: 2 }}>
            {data ? `Khách thấy gì trên Facebook. Dữ liệu lúc ${dt(data.generated_at)}, đã đọc ${data.accounts_checked} tài khoản` : "Đang đọc từ Facebook, lần đầu có thể mất khoảng 1 phút..."}
          </div>
        </div>
        <button style={btn} disabled={loading} onClick={() => load(true)}>{loading ? "Đang tải..." : "Làm mới từ Facebook"}</button>
      </div>

      {err && <div style={{ ...notice, background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{err}</div>}
      {!!data?.errors.length && (
        <div style={notice}>
          <b>Không đọc được {data.errors.length} tài khoản, ad của các tài khoản này không có trong trang:</b>{" "}
          {data.errors.map((e) => e.account).join(", ")}
        </div>
      )}
      {noPreview > 0 && <div style={notice}>{noPreview} ad chưa lấy được bản xem trước, có thể thiếu tiêu đề. Bấm "Xem trên Facebook" trong chi tiết để xem bản thật.</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Ad đang chạy" value={String(rows.length)} />
        <Stat label="Tiêu đề khác nhau" value={String(distinctTitles)} />
        <Stat label="Chưa có tiêu đề" value={String(noTitle)} warn={noTitle > 0} />
        <Stat label="Chi hôm nay" value={vnd(totalToday)} />
      </div>

      <div style={toolbar}>
        <select style={inp} aria-label="Sản phẩm" value={product} onChange={(e) => setProduct(e.target.value)}><Options rows={all} get={(r) => r.product_name} all="Mọi sản phẩm" /></select>
        <select style={inp} aria-label="Người chạy" value={mkt} onChange={(e) => setMkt(e.target.value)}><Options rows={all} get={(r) => r.mkt} all="Mọi người chạy" /></select>
        <select style={inp} aria-label="Tài khoản" value={account} onChange={(e) => setAccount(e.target.value)}><Options rows={all} get={(r) => r.account_name} all="Mọi tài khoản" /></select>
        <select style={{ ...inp, maxWidth: 260 }} aria-label="Tiêu đề" value={title} onChange={(e) => setTitle(e.target.value)}><Options rows={all} get={titleOf} all="Mọi tiêu đề" /></select>
        <input style={{ ...inp, flex: "1 1 240px", minWidth: 200 }} placeholder="Tìm chữ trong nội dung, ID, tên ad, camp, mã video" value={q} onChange={(e) => setQ(e.target.value)} />
        {hasFilter && <button style={btn} onClick={() => { setMkt(""); setProduct(""); setAccount(""); setTitle(""); setQ("") }}>Xoá lọc</button>}
      </div>
      <div style={{ ...toolbar, marginBottom: 14 }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--border-base, #d1d5db)", borderRadius: 6, overflow: "hidden" }}>
          {([["cards", "Dạng thẻ"], ["table", "Dạng bảng"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} aria-pressed={view === k} style={{ ...segBtn, ...(view === k ? { background: "#111827", color: "#fff" } : {}) }}>{l}</button>
          ))}
        </div>
        <label>Gộp theo{" "}
          <select style={inp} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <label>Sắp xếp{" "}
          <select style={inp} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="spend_today">Chi hôm nay</option>
            <option value="spend_7d">Chi 7 ngày</option>
            <option value="created_time">Mới tạo</option>
          </select>
        </label>
      </div>

      {view === "cards"
        ? groups.map((g) => (
            <section key={g.key} style={{ marginBottom: 22 }}>
              {groupBy && (
                <div style={sectionHead}>
                  <b style={{ fontSize: 14, wordBreak: "break-word" }}>{g.key}</b>
                  <span style={sub}>{g.rows.length} ad, chi hôm nay {vnd(g.rows.reduce((t, r) => t + r.spend_today, 0))}, 7 ngày {vnd(g.rows.reduce((t, r) => t + r.spend_7d, 0))}, {g.rows.reduce((t, r) => t + r.orders_7d, 0)} đơn UTM</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, alignItems: "start" }}>
                {g.rows.map((r) => <AdCard key={r.ad_id} r={r} onOpen={() => setOpenId(r.ad_id)} />)}
              </div>
            </section>
          ))
        : (
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead>
                <tr>
                  {["", "Tiêu đề", "Sản phẩm", "Người chạy", "Tài khoản", "Ad", "Camp", "Chi hôm nay", "Chi 7 ngày", "CTR 7N", "CPM 7N", "Đơn UTM 7N"].map((h, i) => (
                    <th key={i} style={{ ...th, textAlign: i >= 7 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {groupBy && (
                      <tr>
                        <td colSpan={7} style={groupTd}><b>{g.key}</b> <span style={sub}>({g.rows.length} ad)</span></td>
                        <td style={{ ...groupTd, ...right }}>{vnd(g.rows.reduce((t, r) => t + r.spend_today, 0))}</td>
                        <td style={{ ...groupTd, ...right }}>{vnd(g.rows.reduce((t, r) => t + r.spend_7d, 0))}</td>
                        <td style={groupTd} /><td style={groupTd} />
                        <td style={{ ...groupTd, ...right }}>{g.rows.reduce((t, r) => t + r.orders_7d, 0)}</td>
                      </tr>
                    )}
                    {g.rows.map((r) => {
                      const poster = r.preview?.cards[0]?.poster || r.thumbnail
                      return (
                        <tr key={r.ad_id} style={{ cursor: "pointer" }} onClick={() => setOpenId(r.ad_id)}>
                          <td style={td}>{poster && <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 44, height: 55, objectFit: "cover", borderRadius: 4, display: "block" }} />}</td>
                          <td style={{ ...td, minWidth: 240, maxWidth: 360 }}>
                            {r.titles.length ? r.titles.map((t) => <div key={t} style={{ fontWeight: 600 }}>{t}</div>) : <span style={{ color: "#b45309" }}>{NO_TITLE}</span>}
                            {r.descriptions.map((d) => <div key={d} style={sub}>{d}</div>)}
                          </td>
                          <td style={td}>{r.product_name}{r.product_code && <div style={sub}>{r.product_code}</div>}</td>
                          <td style={td}>{r.mkt}</td>
                          <td style={td}>{r.account_name}</td>
                          <td style={{ ...td, minWidth: 170 }}>
                            <div>{r.ad_name}</div>
                            <CopyId id={r.ad_id} />
                          </td>
                          <td style={{ ...td, minWidth: 210, maxWidth: 280, wordBreak: "break-word" }}>
                            {r.campaign_name}
                            <div style={sub}>NS {r.campaign_budget ? vnd(r.campaign_budget) : r.adset_budget ? `nhóm ${vnd(r.adset_budget)}` : "—"}</div>
                          </td>
                          <td style={{ ...td, ...right }}>{vnd(r.spend_today)}</td>
                          <td style={{ ...td, ...right }}>{vnd(r.spend_7d)}</td>
                          <td style={{ ...td, ...right }}>{r.ctr_7d === null ? "—" : `${r.ctr_7d.toFixed(2)}%`}</td>
                          <td style={{ ...td, ...right }}>{vnd(r.cpm_7d)}</td>
                          <td style={{ ...td, ...right }}>{r.orders_7d}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!rows.length && (
        <div style={{ ...sub, fontSize: 13, textAlign: "center", padding: 32 }}>
          {loading ? "Đang đọc từ Facebook, lần đầu có thể mất khoảng 1 phút..." : "Không có ad nào khớp bộ lọc"}
        </div>
      )}

      <div style={{ ...sub, marginTop: 10 }}>
        Thẻ dựng từ dữ liệu xem trước của Facebook theo mẫu bảng tin điện thoại, các vị trí khác như Reels hiển thị khác. Đơn UTM chỉ gồm đơn ghép được với ad, có thể thấp hơn số thật, nên không dùng để tính % chi phí.
      </div>

      {opened && <DetailModal r={opened} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border-base, #e5e7eb)", borderRadius: 8, padding: "8px 14px", minWidth: 130 }}>
      <div style={sub}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: warn ? "#b45309" : undefined }}>{value}</div>
    </div>
  )
}

const fb: Record<string, React.CSSProperties> = {
  wrap: { background: "#fff", color: "#050505", fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13, lineHeight: 1.34 },
  head: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 6px" },
  avatar: { width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flex: "0 0 36px" },
  page: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { color: "#65676b", fontSize: 12 },
  body: { padding: "0 12px 8px" },
  clamp3: { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" },
  more: { padding: 0, border: 0, background: "none", color: "#65676b", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  foot: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f0f2f5" },
  domain: { color: "#65676b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  headline: { fontWeight: 600, fontSize: 14, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  desc: { color: "#65676b", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cta: { flex: "0 0 auto", background: "#e4e6eb", borderRadius: 6, padding: "7px 10px", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" },
  ufi: { display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 12px", color: "#65676b", fontSize: 12 },
  actions: { display: "flex", justifyContent: "space-around", padding: "7px 12px", borderTop: "1px solid #ced0d4", color: "#65676b", fontSize: 12, fontWeight: 600 },
}
const cardBox: React.CSSProperties = { border: "1px solid var(--border-base, #e5e7eb)", borderRadius: 10, overflow: "hidden", background: "var(--bg-base, #fff)" }
const warnLine: React.CSSProperties = { padding: "6px 12px", background: "#fffbeb", color: "#92400e", fontSize: 12 }
const tag: React.CSSProperties = { background: "var(--bg-subtle, #f3f4f6)", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 500 }
const toolbar: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }
const sectionHead: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline", padding: "8px 12px", marginBottom: 10, background: "var(--bg-subtle, #f3f4f6)", borderRadius: 6 }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, overflowY: "auto" }
const modal: React.CSSProperties = { background: "var(--bg-base, #fff)", color: "var(--fg-base, #111827)", borderRadius: 12, padding: 18, width: "100%", maxWidth: 880, fontSize: 13 }
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 }
const th: React.CSSProperties = { padding: "6px 8px", borderBottom: "2px solid var(--border-base, #e5e7eb)", whiteSpace: "nowrap", fontWeight: 600 }
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border-base, #f3f4f6)", verticalAlign: "top" }
const groupTd: React.CSSProperties = { ...td, background: "var(--bg-subtle, #f3f4f6)", fontWeight: 600 }
const right: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" }
const sub: React.CSSProperties = { color: "var(--fg-subtle, #6b7280)", fontSize: 12 }
const inp: React.CSSProperties = { border: "1px solid var(--border-base, #d1d5db)", borderRadius: 6, padding: "5px 8px", fontSize: 13, background: "var(--bg-field, #fff)", color: "inherit" }
const btn: React.CSSProperties = { cursor: "pointer", padding: "5px 10px", border: "1px solid var(--border-base, #d1d5db)", borderRadius: 6, background: "var(--bg-subtle, #f9fafb)", color: "inherit", fontSize: 13 }
const segBtn: React.CSSProperties = { cursor: "pointer", padding: "5px 12px", border: 0, background: "transparent", color: "inherit", fontSize: 13 }
const notice: React.CSSProperties = { padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 6, marginBottom: 12 }
const link: React.CSSProperties = { color: "#2563eb" }
const idBtn: React.CSSProperties = { display: "inline-block", padding: 0, border: 0, background: "none", color: "var(--fg-subtle, #6b7280)", cursor: "pointer", fontSize: 12, textAlign: "left", wordBreak: "break-all" }

export const config = defineRouteConfig({
  label: "Content ads", rank: 4,
})

export default withRouteGuard(ContentAdsPage)
