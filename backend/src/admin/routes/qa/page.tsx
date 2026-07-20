import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

// ── Kiểu dữ liệu ────────────────────────────────────────────────────────────
type Criterion = { key: "c1" | "c2" | "c3" | "c4" | "c5" | "c6"; label: string; max: number; hint: string }
type Staff = { email: string; name: string; team: string; role: string }
type DailyNote = {
  id: string; employee_email: string; dept: string; note_date: string
  label: string; content: string; is_fatal: boolean; fatal_kind: string | null; created_by: string
}
type WeeklyScore = {
  id?: string; employee_email: string; dept: string; week_key: string; month_key?: string
  c1: number; c2: number; c3: number; c4: number; c5: number; c6: number
  fatal_flag: boolean; total: number; comment: string | null
}
type Meta = { staff: Staff[]; criteria: Record<string, Criterion[]>; dept_labels: Record<string, string>; current_week: string }
type SummaryPerson = {
  employee_email: string; name: string; dept: string
  weeks: Record<string, number>; months: Record<string, { avg: number; weeks: number }>
  overall: number; grade: string; bonus: number; tone: "good" | "warn" | "bad"
}
type Summary = { all_weeks: string[]; all_months: string[]; people: SummaryPerson[] }

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayVN(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}
// Dải 7 ngày (Thứ 2..CN) của tuần chứa `date`.
function weekDays(date: string): string[] {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  const monday = new Date(d.getTime() - dow * 86400_000)
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400_000).toISOString().slice(0, 10))
}
const LABEL_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  good: { dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50" },
  warn: { dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50" },
  error: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
  info: { dot: "bg-gray-400", text: "text-gray-600", bg: "bg-gray-50" },
}
const TONE_STYLE: Record<string, string> = {
  good: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
}
function gradeBadge(total: number, fatal: boolean): { label: string; cls: string } {
  if (fatal) return { label: "Lỗi liệt", cls: TONE_STYLE.bad }
  if (total >= 90) return { label: "Xuất sắc · 100%", cls: TONE_STYLE.good }
  if (total >= 80) return { label: "Khá · 90%", cls: TONE_STYLE.good }
  if (total >= 70) return { label: "TB · 75%", cls: TONE_STYLE.warn }
  return { label: "Không đạt · 50%", cls: TONE_STYLE.bad }
}

function QaPage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [tab, setTab] = useState<"notes" | "score" | "summary">("notes")
  const [dept, setDept] = useState<string>("van_don")
  const [err, setErr] = useState<string>("")

  useEffect(() => {
    apiJson("/admin/qa/meta").then(setMeta).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="p-6 text-red-600">Lỗi tải trang QA: {err}</div>
  if (!meta) return <div className="p-6 text-gray-500">Đang tải…</div>

  const criteria = meta.criteria[dept] || []

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Đánh giá QA — Sale &amp; Vận Đơn</h1>
          <p className="text-sm text-gray-500">Ghi chú theo ngày · Chấm điểm theo tuần · Tổng hợp điểm trung bình theo thời gian.</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border">
          {Object.entries(meta.dept_labels).map(([k, v]) => (
            <button key={k} onClick={() => setDept(k)}
              className={`px-4 py-1.5 text-sm ${dept === k ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b">
        {([["notes", "📝 Ghi chú ngày"], ["score", "⭐ Chấm điểm tuần"], ["summary", "📈 Tổng hợp"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "notes" && <NotesTab dept={dept} staff={meta.staff} />}
      {tab === "score" && <ScoreTab dept={dept} staff={meta.staff} criteria={criteria} currentWeek={meta.current_week} />}
      {tab === "summary" && <SummaryTab dept={dept} deptLabel={meta.dept_labels[dept]} />}
    </div>
  )
}

// ── TAB 1: Ghi chú ngày ──────────────────────────────────────────────────────
function NotesTab({ dept, staff }: { dept: string; staff: Staff[] }) {
  const [date, setDate] = useState(todayVN())
  const [notes, setNotes] = useState<DailyNote[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ employee_email: "", label: "info", content: "", is_fatal: false, fatal_kind: "fake_status" })

  const days = weekDays(date)
  const load = useCallback(() => {
    setLoading(true)
    apiJson(`/admin/qa/daily-notes?dept=${dept}&from=${days[0]}&to=${days[6]}`)
      .then((r) => setNotes(r.notes || [])).finally(() => setLoading(false))
  }, [dept, days[0], days[6]])
  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!form.employee_email || !form.content.trim()) return
    await apiJson("/admin/qa/daily-notes", "POST", {
      ...form, dept, note_date: date,
      fatal_kind: form.is_fatal ? form.fatal_kind : null,
    })
    setForm({ ...form, content: "", is_fatal: false })
    load()
  }
  const remove = async (id: string) => {
    await apiJson(`/admin/qa/daily-notes/${id}`, "DELETE")
    load()
  }

  const nameByEmail = useMemo(() => Object.fromEntries(staff.map((s) => [s.email, s.name])), [staff])
  const notesByEmpDay = useMemo(() => {
    const m: Record<string, Record<string, DailyNote[]>> = {}
    for (const n of notes) ((m[n.employee_email] ||= {})[n.note_date] ||= []).push(n)
    return m
  }, [notes])
  const empsWithNotes = Object.keys(notesByEmpDay)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-gray-50 p-3">
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Ngày ghi chú</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Nhân sự</span>
          <select value={form.employee_email} onChange={(e) => setForm({ ...form, employee_email: e.target.value })} className="min-w-48 rounded border px-2 py-1.5">
            <option value="">— chọn —</option>
            {staff.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Nhãn</span>
          <select value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="rounded border px-2 py-1.5">
            <option value="good">+ Tốt</option>
            <option value="warn">! Lưu ý</option>
            <option value="error">✕ Lỗi</option>
            <option value="info">· Ghi chú</option>
          </select>
        </label>
        <label className="flex-1 text-sm" style={{ minWidth: 240 }}>
          <span className="mb-1 block text-gray-500">Sự việc</span>
          <input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="VD: Ngâm 3 đơn quá 24h chưa xử lý…" className="w-full rounded border px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-red-700">
          <input type="checkbox" checked={form.is_fatal} onChange={(e) => setForm({ ...form, is_fatal: e.target.checked })} />
          Lỗi liệt
        </label>
        {form.is_fatal && (
          <select value={form.fatal_kind} onChange={(e) => setForm({ ...form, fatal_kind: e.target.value })} className="rounded border px-2 py-1.5 text-sm">
            <option value="fake_status">Trạng thái ảo</option>
            <option value="wrong_cod">Sai COD</option>
          </select>
        )}
        <button onClick={submit} disabled={!form.employee_email || !form.content.trim()}
          className="rounded bg-gray-900 px-4 py-1.5 text-sm text-white disabled:opacity-40">Thêm</button>
      </div>

      <p className="mb-2 text-xs text-gray-500">
        Nhật ký tuần {days[0]} → {days[6]} {loading && "· đang tải…"}
      </p>

      {empsWithNotes.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-400">Chưa có ghi chú nào trong tuần này.</div>
      )}

      <div className="space-y-3">
        {empsWithNotes.map((email) => (
          <div key={email} className="overflow-hidden rounded-lg border">
            <div className="border-b bg-gray-50 px-3 py-2 text-sm font-medium">{nameByEmail[email] || email}</div>
            <div className="grid grid-cols-2 gap-px bg-gray-100 md:grid-cols-7">
              {days.map((d) => {
                const dayNotes = notesByEmpDay[email][d] || []
                return (
                  <div key={d} className="min-h-16 bg-white p-2">
                    <div className="mb-1 text-[11px] text-gray-400">{d.slice(5)}</div>
                    {dayNotes.map((n) => {
                      const st = LABEL_STYLE[n.label] || LABEL_STYLE.info
                      return (
                        <div key={n.id} className={`group mb-1 rounded px-1.5 py-1 text-xs ${st.bg} ${n.is_fatal ? "ring-1 ring-red-400" : ""}`}>
                          <div className="flex items-start gap-1">
                            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} />
                            <span className={`flex-1 ${st.text}`}>
                              {n.is_fatal && <span className="font-semibold text-red-700">🛑 </span>}
                              {n.content}
                            </span>
                            <button onClick={() => remove(n.id)} className="hidden text-gray-300 hover:text-red-500 group-hover:block">✕</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TAB 2: Chấm điểm tuần ─────────────────────────────────────────────────────
function ScoreTab({ dept, staff, criteria, currentWeek }: { dept: string; staff: Staff[]; criteria: Criterion[]; currentWeek: string }) {
  const [week, setWeek] = useState(currentWeek)
  const [rows, setRows] = useState<Record<string, WeeklyScore>>({})
  const [saving, setSaving] = useState<string>("")
  const maxTotal = criteria.reduce((s, c) => s + c.max, 0)

  const load = useCallback(() => {
    apiJson(`/admin/qa/weekly-scores?dept=${dept}&week_key=${week}`).then((r) => {
      const map: Record<string, WeeklyScore> = {}
      for (const s of r.scores || []) map[s.employee_email] = s
      setRows(map)
    })
  }, [dept, week])
  useEffect(() => { load() }, [load])

  const getRow = (email: string): WeeklyScore =>
    rows[email] || { employee_email: email, dept, week_key: week, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, fatal_flag: false, total: 0, comment: "" }

  const setCell = (email: string, patch: Partial<WeeklyScore>) => {
    setRows((prev) => {
      const cur = prev[email] || getRow(email)
      return { ...prev, [email]: { ...cur, ...patch } }
    })
  }
  const rowTotal = (r: WeeklyScore) => r.fatal_flag ? 0 : criteria.reduce((s, c) => s + (Number((r as any)[c.key]) || 0), 0)

  const save = async (email: string) => {
    setSaving(email)
    const r = getRow(email)
    try {
      const res = await apiJson("/admin/qa/weekly-scores", "POST", { ...r, dept, week_key: week })
      setRows((prev) => ({ ...prev, [email]: res.score }))
    } finally { setSaving("") }
  }

  const prevWeek = () => setWeek(shiftWeek(week, -1))
  const nextWeek = () => setWeek(shiftWeek(week, 1))

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button onClick={prevWeek} className="rounded border px-2 py-1 text-sm hover:bg-gray-50">←</button>
        <span className="rounded bg-gray-100 px-3 py-1 text-sm font-medium">Tuần {week}</span>
        <button onClick={nextWeek} className="rounded border px-2 py-1 text-sm hover:bg-gray-50">→</button>
        <span className="ml-2 text-xs text-gray-400">Điền điểm từng tiêu chí (tối đa {maxTotal}đ) rồi bấm Lưu từng dòng.</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2">Nhân sự</th>
              {criteria.map((c) => (
                <th key={c.key} className="px-2 py-2 text-center" title={c.hint}>{c.label}<div className="font-normal normal-case text-gray-400">/{c.max}</div></th>
              ))}
              <th className="px-2 py-2 text-center">Lỗi liệt</th>
              <th className="px-2 py-2 text-center">Tổng</th>
              <th className="px-2 py-2 text-center">Xếp loại</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const r = getRow(s.email)
              const total = rowTotal(r)
              const badge = gradeBadge(total, r.fatal_flag)
              return (
                <tr key={s.email} className="border-t">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">{s.name}</td>
                  {criteria.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-center">
                      <input type="number" min={0} max={c.max} value={(r as any)[c.key] ?? 0}
                        disabled={r.fatal_flag}
                        onChange={(e) => setCell(s.email, { [c.key]: Math.max(0, Math.min(c.max, Number(e.target.value) || 0)) } as any)}
                        className="w-14 rounded border px-1 py-1 text-center tabular-nums disabled:bg-gray-100" />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={r.fatal_flag} onChange={(e) => setCell(s.email, { fatal_flag: e.target.checked })} />
                  </td>
                  <td className="px-2 py-2 text-center font-semibold tabular-nums">{total}</td>
                  <td className="px-2 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span></td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => save(s.email)} disabled={saving === s.email}
                      className="rounded bg-gray-900 px-3 py-1 text-xs text-white disabled:opacity-40">
                      {saving === s.email ? "…" : rows[s.email]?.id ? "Cập nhật" : "Lưu"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">🛑 Bật "Lỗi liệt" → điểm tuần về 0 tự động (trạng thái ảo / sai COD theo quy định BGĐ).</p>
    </div>
  )
}

// ── TAB 3: Tổng hợp theo thời gian ────────────────────────────────────────────
function SummaryTab({ dept, deptLabel }: { dept: string; deptLabel: string }) {
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiJson(`/admin/qa/summary?dept=${dept}&year=${year}`).then(setData).finally(() => setLoading(false))
  }, [dept, year])

  if (loading || !data) return <div className="p-6 text-sm text-gray-500">Đang tổng hợp…</div>

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm">
          <span className="mr-2 text-gray-500">Năm</span>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded border px-2 py-1">
            {[0, 1].map((d) => { const y = new Date().getFullYear() - d; return <option key={y} value={y}>{y}</option> })}
          </select>
        </label>
        <span className="text-xs text-gray-400">{deptLabel} · điểm tháng = trung bình các tuần có chấm · điểm kỳ = trung bình các tháng.</span>
      </div>

      {data.people.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-400">Chưa có điểm QA nào cho {deptLabel} trong năm {year}.</div>
      )}

      {data.people.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase text-gray-500">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left">Nhân sự</th>
                {data.all_months.map((m) => <th key={m} className="px-2 py-2 text-center">{m.slice(5)}/{m.slice(2, 4)}</th>)}
                <th className="px-3 py-2 text-center">TB kỳ</th>
                <th className="px-3 py-2 text-center">Xếp loại · Thưởng</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.employee_email} className="border-t">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">{p.name}</td>
                  {data.all_months.map((m) => {
                    const cell = p.months[m]
                    return (
                      <td key={m} className="px-2 py-2 text-center tabular-nums">
                        {cell ? <span title={`${cell.weeks} tuần`} className={scoreColor(cell.avg)}>{cell.avg}</span> : <span className="text-gray-300">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-center text-base font-bold tabular-nums">{p.overall || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_STYLE[p.tone]}`}>{p.grade} · {p.bonus}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function scoreColor(v: number): string {
  if (v >= 90) return "font-semibold text-green-700"
  if (v >= 80) return "text-green-600"
  if (v >= 70) return "text-amber-600"
  return "font-semibold text-red-600"
}
// Dịch ISO week key ±n tuần.
function shiftWeek(weekKey: string, delta: number): string {
  const [y, w] = weekKey.split("-W").map(Number)
  const firstThursday = new Date(Date.UTC(y, 0, 4))
  const thursday = new Date(firstThursday.getTime() + ((w - 1) + delta) * 7 * 86400_000)
  const date = new Date(thursday)
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const ft = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - ft.getTime()) / 86400_000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export const config = defineRouteConfig({ label: "Đánh giá QA", rank: 20 })

export default withRouteGuard(QaPage)
