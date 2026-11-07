import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback, useMemo, Fragment } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

type Row = {
  ad_id: string; ad_name: string; vd_code: string | null; created_time: string
  preview_url: string | null; ads_manager_url: string
  campaign_id: string; campaign_name: string; campaign_budget: number | null
  adset_id: string; adset_name: string; adset_budget: number | null
  account_id: string; account_name: string; mkt: string
  product_code: string | null; product_name: string
  page_id: string | null; page_name: string | null; post_id: string | null; post_url: string | null; creative_id: string | null
  titles: string[]; descriptions: string[]; bodies: string[]; cta: string | null; landing: string | null; thumbnail: string | null
  spend_today: number; spend_7d: number; ctr_7d: number | null; cpm_7d: number | null; orders_7d: number
}
type Data = { generated_at: string; accounts_checked: number; errors: { account: string; error: string }[]; rows: Row[] }
type GroupBy = "" | "title" | "product" | "account" | "mkt" | "page"
type SortBy = "spend_today" | "spend_7d" | "created_time"

const NO_TITLE = "Không đọc được tiêu đề"
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

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      title="Sao chép ID"
      style={idBtn}
      onClick={() => { navigator.clipboard?.writeText(id).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }) }}
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
      {[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "vi")).map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
    </>
  )
}

function ContentAdsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [mkt, setMkt] = useState("")
  const [product, setProduct] = useState("")
  const [account, setAccount] = useState("")
  const [hasTitle, setHasTitle] = useState("")
  const [q, setQ] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("")
  const [sortBy, setSortBy] = useState<SortBy>("spend_today")
  const [open, setOpen] = useState<string | null>(null)

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
      if (hasTitle === "yes" && !r.titles.length) return false
      if (hasTitle === "no" && r.titles.length) return false
      if (!needle) return true
      return [r.ad_id, r.ad_name, r.vd_code, r.campaign_id, r.campaign_name, r.post_id, pageOf(r), ...r.titles, ...r.descriptions, ...r.bodies]
        .some((s) => (s || "").toLowerCase().includes(needle))
    })
    return list.sort((a, b) => sortBy === "created_time"
      ? b.created_time.localeCompare(a.created_time)
      : b[sortBy] - a[sortBy] || b.spend_7d - a.spend_7d)
  }, [data, mkt, product, account, hasTitle, q, sortBy])

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

  return (
    <div style={{ padding: 16, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Content ads đang chạy</h1>
          <div style={{ color: "#6b7280", marginTop: 2 }}>
            {data ? `Dữ liệu Facebook lúc ${dt(data.generated_at)}, đã đọc ${data.accounts_checked} tài khoản` : "Đang đọc từ Facebook..."}
          </div>
        </div>
        <button style={btn} disabled={loading} onClick={() => load(true)}>{loading ? "Đang tải..." : "Làm mới từ Facebook"}</button>
      </div>

      {err && <div style={{ ...notice, background: "#fef2f2", borderColor: "#fecaca" }}>{err}</div>}
      {!!data?.errors.length && (
        <div style={notice}>
          <b>Không đọc được {data.errors.length} tài khoản, ad của các tài khoản này không có trong bảng:</b>{" "}
          {data.errors.map((e) => e.account).join(", ")}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Ad đang chạy" value={String(rows.length)} />
        <Stat label="Tiêu đề khác nhau" value={String(distinctTitles)} />
        <Stat label="Không đọc được tiêu đề" value={String(noTitle)} warn={noTitle > 0} />
        <Stat label="Chi hôm nay" value={vnd(totalToday)} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={product} onChange={(e) => setProduct(e.target.value)}><Options rows={data?.rows || []} get={(r) => r.product_name} all="Mọi sản phẩm" /></select>
        <select style={inp} value={mkt} onChange={(e) => setMkt(e.target.value)}><Options rows={data?.rows || []} get={(r) => r.mkt} all="Mọi người chạy" /></select>
        <select style={inp} value={account} onChange={(e) => setAccount(e.target.value)}><Options rows={data?.rows || []} get={(r) => r.account_name} all="Mọi tài khoản" /></select>
        <select style={inp} value={hasTitle} onChange={(e) => setHasTitle(e.target.value)}>
          <option value="">Có và không có tiêu đề</option>
          <option value="yes">Có tiêu đề</option>
          <option value="no">Không đọc được tiêu đề</option>
        </select>
        <input style={{ ...inp, minWidth: 260 }} placeholder="Tìm chữ trong nội dung, ID, tên ad, camp, mã video" value={q} onChange={(e) => setQ(e.target.value)} />
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

      <div style={{ overflowX: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              {["", "Tiêu đề và mô tả", "Sản phẩm", "Người chạy", "Tài khoản", "Ad", "Camp", "Chi hôm nay", "Chi 7 ngày", "CTR 7N", "CPM 7N", "Đơn UTM 7N", "Xem"].map((h, i) => (
                <th key={i} style={{ ...th, textAlign: i >= 7 && i <= 11 ? "right" : "left" }} title={h === "Đơn UTM 7N" ? "Chỉ tính đơn ghép được theo UTM, nên có thể thấp hơn số thật. Không dùng để tính % chi phí." : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                {groupBy && (
                  <tr>
                    <td colSpan={7} style={groupTd}><b>{g.key}</b> <span style={{ color: "#6b7280" }}>({g.rows.length} ad)</span></td>
                    <td style={{ ...groupTd, ...right }}>{vnd(g.rows.reduce((t, r) => t + r.spend_today, 0))}</td>
                    <td style={{ ...groupTd, ...right }}>{vnd(g.rows.reduce((t, r) => t + r.spend_7d, 0))}</td>
                    <td style={groupTd} /><td style={groupTd} />
                    <td style={{ ...groupTd, ...right }}>{g.rows.reduce((t, r) => t + r.orders_7d, 0)}</td>
                    <td style={groupTd} />
                  </tr>
                )}
                {g.rows.map((r) => (
                  <Fragment key={r.ad_id}>
                    <tr>
                      <td style={td}>{r.thumbnail && <img src={r.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4 }} onError={(e) => { e.currentTarget.style.display = "none" }} />}</td>
                      <td style={{ ...td, minWidth: 260, maxWidth: 380 }}>
                        {r.titles.length
                          ? r.titles.map((t) => <div key={t} style={{ fontWeight: 600 }}>{t}</div>)
                          : <span style={{ color: "#b45309" }} title="Facebook không trả tiêu đề cho ad dùng bài đăng có sẵn. Bấm Xem trước để xem bản thật.">{NO_TITLE}</span>}
                        {r.descriptions.map((d) => <div key={d} style={{ color: "#6b7280", marginTop: 2 }}>{d}</div>)}
                        <button style={linkBtn} onClick={() => setOpen(open === r.ad_id ? null : r.ad_id)}>{open === r.ad_id ? "Ẩn chi tiết" : "Chi tiết"}</button>
                      </td>
                      <td style={td}>{r.product_name}{r.product_code && <div style={sub}>{r.product_code}</div>}</td>
                      <td style={td}>{r.mkt}</td>
                      <td style={td} title={r.account_id}>{r.account_name}</td>
                      <td style={{ ...td, minWidth: 180 }}>
                        <div>{r.ad_name}</div>
                        <CopyId id={r.ad_id} />
                        <div style={sub}>{r.vd_code ? `${r.vd_code}, ` : ""}tạo {dt(r.created_time)}</div>
                      </td>
                      <td style={{ ...td, minWidth: 220, maxWidth: 300 }}>
                        <div style={{ wordBreak: "break-word" }}>{r.campaign_name}</div>
                        <CopyId id={r.campaign_id} />
                        <div style={sub}>NS {r.campaign_budget ? vnd(r.campaign_budget) : r.adset_budget ? `nhóm ${vnd(r.adset_budget)}` : "—"}</div>
                      </td>
                      <td style={{ ...td, ...right }}>{vnd(r.spend_today)}</td>
                      <td style={{ ...td, ...right }}>{vnd(r.spend_7d)}</td>
                      <td style={{ ...td, ...right }}>{r.ctr_7d === null ? "—" : `${r.ctr_7d.toFixed(2)}%`}</td>
                      <td style={{ ...td, ...right }}>{vnd(r.cpm_7d)}</td>
                      <td style={{ ...td, ...right }}>{r.orders_7d}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {r.preview_url && <div><a style={link} href={r.preview_url} target="_blank" rel="noreferrer">Xem trước</a></div>}
                        {r.post_url && <div><a style={link} href={r.post_url} target="_blank" rel="noreferrer">Bài viết</a></div>}
                        {r.landing && <div><a style={link} href={r.landing} target="_blank" rel="noreferrer">Landing</a></div>}
                        <div><a style={link} href={r.ads_manager_url} target="_blank" rel="noreferrer">Trình QLQC</a></div>
                      </td>
                    </tr>
                    {open === r.ad_id && (
                      <tr>
                        <td style={{ ...td, background: "#f9fafb" }} colSpan={13}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                            <div>
                              <b>Thân bài</b>
                              {r.bodies.length
                                ? r.bodies.map((b) => <div key={b} style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{b}</div>)
                                : <div style={{ color: "#6b7280", marginTop: 4 }}>Không đọc được</div>}
                            </div>
                            <div style={{ lineHeight: 1.7 }}>
                              <div><b>Page:</b> {pageOf(r)}{r.page_id && <> <CopyId id={r.page_id} /></>}</div>
                              <div><b>Nhóm QC:</b> {r.adset_name} <CopyId id={r.adset_id} /></div>
                              {r.post_id && <div><b>ID bài:</b> <CopyId id={r.post_id} /></div>}
                              {r.creative_id && <div><b>ID creative:</b> <CopyId id={r.creative_id} /></div>}
                              <div><b>Nút:</b> {r.cta || "—"}</div>
                              <div style={{ wordBreak: "break-all" }}><b>Landing:</b> {r.landing || "—"}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={13} style={{ ...td, textAlign: "center", color: "#6b7280", padding: 24 }}>{loading ? "Đang đọc từ Facebook, có thể mất khoảng 30 giây..." : "Không có ad nào khớp bộ lọc"}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ color: "#6b7280", marginTop: 10 }}>
        Chi phí và CTR lấy từ dữ liệu đồng bộ của hệ thống. Đơn UTM chỉ gồm đơn ghép được với ad, có thể thấp hơn số thật, nên không dùng để tính % chi phí.
      </div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 14px", minWidth: 130 }}>
      <div style={{ color: "#6b7280", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: warn ? "#b45309" : undefined }}>{value}</div>
    </div>
  )
}

const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 }
const th: React.CSSProperties = { padding: "6px 8px", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap", fontWeight: 600 }
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" }
const groupTd: React.CSSProperties = { ...td, background: "#f3f4f6", fontWeight: 600 }
const right: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" }
const sub: React.CSSProperties = { color: "#6b7280", fontSize: 12 }
const inp: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 8px", fontSize: 13 }
const btn: React.CSSProperties = { cursor: "pointer", padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 6, background: "#f9fafb", fontSize: 13 }
const notice: React.CSSProperties = { padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, marginBottom: 12 }
const link: React.CSSProperties = { color: "#2563eb" }
const linkBtn: React.CSSProperties = { display: "block", marginTop: 4, padding: 0, border: 0, background: "none", color: "#2563eb", cursor: "pointer", fontSize: 12 }
const idBtn: React.CSSProperties = { display: "block", padding: 0, border: 0, background: "none", color: "#6b7280", cursor: "pointer", fontSize: 12, textAlign: "left", wordBreak: "break-all" }

export const config = defineRouteConfig({
  label: "Content ads", rank: 4,
})

export default withRouteGuard(ContentAdsPage)
