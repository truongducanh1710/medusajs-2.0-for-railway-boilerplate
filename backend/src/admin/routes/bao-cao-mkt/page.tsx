import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../lib/api-client"
import { useCurrentPermissions } from "../../lib/use-permissions"

function fmtMoney(n: number): string {
  return n.toLocaleString("vi-VN") + "đ"
}

function fmtDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-")
  return `${parts[2]}/${parts[1]}`
}

function carePctColor(pct: number | null): string {
  if (pct === null) return "#6b7280"
  if (pct < 30) return "#16a34a"
  if (pct <= 35) return "#d97706"
  return "#dc2626"
}

const MKT_ORDER = ["KIENLB", "ANHNT", "XUANLT", "NAMDV", "DUPD", "LINHMT", "NGUYEN MAI"]

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
}

function getThisMonthRange() {
  const now = new Date(Date.now() + 7 * 3600000)
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  const to = now.toISOString().slice(0, 10)
  return { from, to }
}

export default function BaoCaoMktPage() {
  const { from: defaultFrom, to: defaultTo } = getThisMonthRange()
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [groupBy, setGroupBy] = useState<"day" | "month">("day")
  const [rows, setRows] = useState<any[]>([])
  const [summary, setSummary] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [mktNames, setMktNames] = useState<string[]>([])
  const [cronStatus, setCronStatus] = useState<any>(null)
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("bao-cao-mkt-theme") !== "light" } catch { return true }
  })
  const [activeTab, setActiveTab] = useState<"mkt" | "camp" | "spProduct" | "jobs" | "rules" | "fbaccounts" | "ai">("mkt")
  // Tab Rules
  const [rules, setRules] = useState<any[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [thresholds, setThresholds] = useState<any[]>([])
  const [ruleForm, setRuleForm] = useState<any>(null) // null=closed, {}=new, {id}=edit
  const [rulePreview, setRulePreview] = useState<any[] | null>(null)
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleLogs, setRuleLogs] = useState<Record<string, any[]>>({})
  const [ruleLogsOpen, setRuleLogsOpen] = useState<string | null>(null)
  const [ruleGuardOpen, setRuleGuardOpen] = useState(false)
  const [ruleHowOpen, setRuleHowOpen] = useState(false)
  const [ruleTemplateOpen, setRuleTemplateOpen] = useState(false)
  const [campRows, setCampRows] = useState<any[]>([])
  const [campMktFilter, setCampMktFilter] = useState<string>("")
  const [campLoading, setCampLoading] = useState(false)
  const [campDate, setCampDate] = useState(todayVN())
  const [campFrom, setCampFrom] = useState(todayVN())
  const [campTo, setCampTo] = useState(todayVN())
  const [campRangeMode, setCampRangeMode] = useState(false)

  // Tab Chi phí SP
  const [spRows, setSpRows] = useState<any[]>([])
  const [spLoading, setSpLoading] = useState(false)
  const [spMktFilter, setSpMktFilter] = useState("")
  const [spSortCol, setSpSortCol] = useState<string>("spend")
  const [spSortDir, setSpSortDir] = useState<"asc" | "desc">("desc")
  const [spFrom, setSpFrom] = useState(from)
  const [spTo, setSpTo] = useState(to)

  const { isSuper, mktCode, has } = useCurrentPermissions()

  // Tab 3 — Lịch hẹn Camp (schedules + logs)
  const [jobsSubTab, setJobsSubTab] = useState<"schedules" | "logs" | "fb-history">("schedules")
  const [schedules, setSchedules] = useState<any[]>([])
  const [schedTotal, setSchedTotal] = useState(0)
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedStatus, setSchedStatus] = useState("")
  const [schedMkt, setSchedMkt] = useState("")
  const [schedOffset, setSchedOffset] = useState(0)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const SCHED_LIMIT = 50
  const [actLogs, setActLogs] = useState<any[]>([])
  const [actLogsTotal, setActLogsTotal] = useState(0)
  const [actLogsLoading, setActLogsLoading] = useState(false)
  const [actLogsMkt, setActLogsMkt] = useState("")
  const [actLogsAction, setActLogsAction] = useState("")
  const [actLogsFrom, setActLogsFrom] = useState("")
  const [actLogsTo, setActLogsTo] = useState(todayVN())
  const [actLogsOffset, setActLogsOffset] = useState(0)
  const LOGS_LIMIT = 100

  // Tab 3 sub-tab: Lịch sử FB
  const todayStr = todayVN()
  const sevenDaysAgo = (() => { const d = new Date(Date.now() + 7 * 3600000); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) })()
  const [fbHistFrom, setFbHistFrom] = useState(sevenDaysAgo)
  const [fbHistTo, setFbHistTo] = useState(todayStr)
  const [fbHistMkt, setFbHistMkt] = useState("")
  const [fbHistActorType, setFbHistActorType] = useState("")
  const [fbHistory, setFbHistory] = useState<any[]>([])
  const [fbHistTotal, setFbHistTotal] = useState(0)
  const [fbHistOffset, setFbHistOffset] = useState(0)
  const [fbHistLoading, setFbHistLoading] = useState(false)
  const [fbHistSyncing, setFbHistSyncing] = useState(false)
  const FB_HIST_LIMIT = 100

  // Tab 4 — Tài khoản FB
  const [fbAccounts, setFbAccounts] = useState<any[]>([])
  const [fbLoading, setFbLoading] = useState(false)
  const [fbSaving, setFbSaving] = useState(false)
  const [fbNewId, setFbNewId] = useState("")
  const [fbNewName, setFbNewName] = useState("")
  const [fbNewMkt, setFbNewMkt] = useState("")
  const [fbNewNote, setFbNewNote] = useState("")
  const [fbAddError, setFbAddError] = useState("")
  const [fbEditingId, setFbEditingId] = useState<string | null>(null)
  const [fbEditName, setFbEditName] = useState("")
  const [fbEditMkt, setFbEditMkt] = useState("")
  const [fbEditNote, setFbEditNote] = useState("")
  const canControl = has("page.bao-cao.camp-control") || isSuper
  const canManageFb = has("page.bao-cao.fb-accounts") || isSuper
  const [editingBudget, setEditingBudget] = useState<string | null>(null)
  const [budgetValue, setBudgetValue] = useState<string>("")
  const [scheduleModalCamp, setScheduleModalCamp] = useState<any>(null)
  const [actingCampId, setActingCampId] = useState<string | null>(null)
  const [mobileActionCamp, setMobileActionCamp] = useState<any>(null)
  const [sortCol, setSortCol] = useState<string>("spend")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [filterStatus, setFilterStatus] = useState<string>("")

  // AI Agent state
  const [aiRecs, setAiRecs] = useState<any[]>([])
  const [aiTotal, setAiTotal] = useState(0)
  const [aiRunSummary, setAiRunSummary] = useState<any[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiTriggering, setAiTriggering] = useState(false)
  const [aiSeeding, setAiSeeding] = useState(false)
  const [aiApproving, setAiApproving] = useState<string | null>(null)
  const [aiFilterStatus, setAiFilterStatus] = useState("pending")
  const [aiFilterMkt, setAiFilterMkt] = useState("")
  const [aiFilterRunId, setAiFilterRunId] = useState("")
  const [aiOffset, setAiOffset] = useState(0)
  const AI_LIMIT = 50
  const [aiModel, setAiModel] = useState("deepseek-v4-pro")
  const [aiParallel, setAiParallel] = useState(false)
  // Sidebar log state (replaces modal)
  const [aiLogRunId, setAiLogRunId] = useState<string | null>(null)
  const [aiLogTrace, setAiLogTrace] = useState<any[]>([])
  const [aiLogRecs, setAiLogRecs] = useState<any[]>([])
  const [aiLogToolCalls, setAiLogToolCalls] = useState<any[]>([])
  const [aiLogLoading, setAiLogLoading] = useState(false)
  const [aiLogHighlight, setAiLogHighlight] = useState<string | null>(null) // campaign_id
  const [aiLogTab, setAiLogTab] = useState<"messages" | "tools" | "eval">("messages")
  // Keep old modal state for compat (unused now)
  const [aiReasoningRec, setAiReasoningRec] = useState<any | null>(null)
  const [aiReasoningTrace, setAiReasoningTrace] = useState<any[]>([])
  const [aiReasoningRecs, setAiReasoningRecs] = useState<any[]>([])
  const [aiReasoningLoading, setAiReasoningLoading] = useState(false)
  const [aiRejectNoteId, setAiRejectNoteId] = useState<string | null>(null)
  const [aiRejectNote, setAiRejectNote] = useState("")
  // Evaluation state
  const [evalRunSummary, setEvalRunSummary] = useState<any | null>(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [tagModalRec, setTagModalRec] = useState<{ id: string; campaign_name: string } | null>(null)
  const [tagLayer, setTagLayer] = useState<string>("model")
  const [tagCategory, setTagCategory] = useState<string>("")
  const [tagSeverity, setTagSeverity] = useState<string>("medium")
  const [tagNote, setTagNote] = useState<string>("")
  // Realtime heartbeat polling
  const [aiHeartbeats, setAiHeartbeats] = useState<any[]>([])
  // Insights panel
  const [aiInsights, setAiInsights] = useState<any[]>([])
  const [aiInsightStats, setAiInsightStats] = useState<any[]>([])
  const [aiShowInsights, setAiShowInsights] = useState(false)
  // Multi-model compare
  const [aiCompareMode, setAiCompareMode] = useState(false)
  const [aiCompareModels, setAiCompareModels] = useState<string[]>(["deepseek-v4-pro", "google/gemini-3.5-flash", "anthropic/claude-sonnet-4-5"])

  const ownerOf = (camp: any) => isSuper || (canControl && mktCode === camp.mkt_name)

  // Theme tokens
  const t = dark ? {
    bg: "#0f0f1a", card: "#1a1a2e", cardBorder: "#2d2d44",
    text: "#f9fafb", textMuted: "#6b7280", textSub: "#9ca3af",
    rowHover: "#111827", rowBorder: "#1f2937", thead: "#374151",
    inputBg: "#1a1a2e", inputBorder: "#374151", inputText: "#f9fafb",
    tfoot: "#111827", theadText: "#9ca3af", empty: "#374151",
    green: "#34d399", blue: "#60a5fa", purple: "#818cf8",
    red: "#f87171", amber: "#f59e0b", cronBg: "#111827",
  } : {
    bg: "#f1f5f9", card: "#ffffff", cardBorder: "#cbd5e1",
    text: "#0f172a", textMuted: "#475569", textSub: "#334155",
    rowHover: "#e2e8f0", rowBorder: "#cbd5e1", thead: "#94a3b8",
    inputBg: "#ffffff", inputBorder: "#94a3b8", inputText: "#0f172a",
    tfoot: "#e2e8f0", theadText: "#1e293b", empty: "#94a3b8",
    green: "#15803d", blue: "#1d4ed8", purple: "#6d28d9",
    red: "#b91c1c", amber: "#b45309", cronBg: "#e2e8f0",
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/admin/pancake-sync/report/mkt?from=${from}&to=${to}&group_by=${groupBy}`)
      const data = await res.json()
      setRows(data.rows ?? [])
      setSummary(data.summary ?? {})
      const names = Object.keys(data.summary ?? {})
      const sorted = [
        ...MKT_ORDER.filter(m => names.includes(m)),
        ...names.filter(m => !MKT_ORDER.includes(m) && m !== "KHÁC"),
        ...(names.includes("KHÁC") ? ["KHÁC"] : []),
      ]
      setMktNames(sorted)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [from, to, groupBy])

  const syncCost = useCallback(async () => {
    setSyncing(true)
    try {
      const today = todayVN()
      const res = await apiFetch("/admin/pancake-sync/report/mkt-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today }),
      })
      const data = await res.json()
      if (data.ok) {
        alert(`✓ Đã sync ${data.synced} campaigns cho ngày ${data.date}`)
        await fetchData()
      } else {
        alert("Lỗi sync: " + (data.error ?? "unknown"))
      }
    } catch (e: any) {
      alert("Lỗi: " + e.message)
    } finally {
      setSyncing(false)
    }
  }, [fetchData])

  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/admin/pancake-sync/report/mkt-cost-status")
      const data = await res.json()
      setCronStatus(data)
    } catch { /* ignore */ }
  }, [])

  const fetchCampData = useCallback(async (overrides?: { rangeMode?: boolean; from?: string; to?: string; date?: string }) => {
    setCampLoading(true)
    try {
      const mktParam = campMktFilter ? `&mkt=${campMktFilter}` : ""
      const useRangeMode = overrides?.rangeMode ?? campRangeMode
      const useFrom = overrides?.from ?? campFrom
      const useTo = overrides?.to ?? campTo
      const useDate = overrides?.date ?? campDate
      const url = useRangeMode
        ? `/admin/pancake-sync/report/mkt-campaign?from=${useFrom}&to=${useTo}${mktParam}`
        : `/admin/pancake-sync/report/mkt-campaign?date=${useDate}${mktParam}`
      const res = await apiFetch(url)
      const data = await res.json()
      setCampRows(data.rows ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setCampLoading(false)
    }
  }, [campDate, campFrom, campTo, campRangeMode, campMktFilter]) // overrides param bypasses stale closure for quick buttons

  const fetchSpData = useCallback(async (overrides?: { from?: string; to?: string }) => {
    const f = overrides?.from ?? spFrom
    const t2 = overrides?.to ?? spTo
    setSpLoading(true)
    try {
      const mktParam = spMktFilter ? `&mkt=${encodeURIComponent(spMktFilter)}` : ""
      const res = await apiFetch(`/admin/pancake-sync/report/mkt-product?from=${f}&to=${t2}${mktParam}`)
      const data = await res.json()
      setSpRows(data.rows ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setSpLoading(false)
    }
  }, [spFrom, spTo, spMktFilter])

  const toggleStatus = useCallback(async (camp: any) => {
    const action = camp.effective_status === "ACTIVE" ? "pause" : "activate"
    if (!confirm(`${action === "pause" ? "Tắt" : "Bật"} camp "${camp.campaign_name}"?`)) return
    setActingCampId(camp.campaign_id)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-control/toggle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: camp.campaign_id, action }),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
      await fetchCampData()
    } finally { setActingCampId(null) }
  }, [fetchCampData])

  const saveBudget = useCallback(async (camp: any) => {
    const budget = Number(budgetValue)
    if (!budget || budget < 50000) { alert("Ngân sách phải >= 50.000đ"); return }
    setActingCampId(camp.campaign_id)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-control/budget", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: camp.campaign_id, daily_budget: budget }),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
      setEditingBudget(null)
      await fetchCampData()
    } finally { setActingCampId(null) }
  }, [budgetValue, fetchCampData])

  const fetchSchedules = useCallback(async () => {
    setSchedLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(SCHED_LIMIT), offset: String(schedOffset) })
      if (schedStatus) p.set("status", schedStatus)
      if (schedMkt) p.set("mkt", schedMkt)
      else if (!isSuper && mktCode) p.set("mkt", mktCode)
      const res = await apiFetch(`/admin/pancake-sync/report/camp-control/all-schedules?${p}`)
      const data = await res.json()
      setSchedules(data.schedules ?? [])
      setSchedTotal(data.total ?? 0)
    } catch { /* ignore */ } finally { setSchedLoading(false) }
  }, [schedStatus, schedMkt, schedOffset, isSuper, mktCode])

  const fetchActLogs = useCallback(async () => {
    setActLogsLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(LOGS_LIMIT), offset: String(actLogsOffset) })
      if (actLogsMkt) p.set("mkt", actLogsMkt)
      else if (!isSuper && mktCode) p.set("mkt", mktCode)
      if (actLogsAction) p.set("action", actLogsAction)
      if (actLogsFrom) p.set("from", actLogsFrom)
      if (actLogsTo) p.set("to", actLogsTo)
      const res = await apiFetch(`/admin/pancake-sync/report/camp-control/all-logs?${p}`)
      const data = await res.json()
      setActLogs(data.logs ?? [])
      setActLogsTotal(data.total ?? 0)
    } catch { /* ignore */ } finally { setActLogsLoading(false) }
  }, [actLogsMkt, actLogsAction, actLogsFrom, actLogsTo, actLogsOffset, isSuper, mktCode])

  const fetchFbHistory = useCallback(async () => {
    setFbHistLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(FB_HIST_LIMIT), offset: String(fbHistOffset) })
      if (fbHistFrom) p.set("from", fbHistFrom)
      if (fbHistTo) p.set("to", fbHistTo)
      if (fbHistMkt) p.set("mkt", fbHistMkt)
      else if (!isSuper && mktCode) p.set("mkt", mktCode)
      if (fbHistActorType) p.set("actor_type", fbHistActorType)
      const res = await apiFetch(`/admin/pancake-sync/report/fb-activity?${p}`)
      const data = await res.json()
      setFbHistory(data.activities ?? [])
      setFbHistTotal(data.total ?? 0)
    } catch { /* ignore */ } finally { setFbHistLoading(false) }
  }, [fbHistFrom, fbHistTo, fbHistMkt, fbHistActorType, fbHistOffset, isSuper, mktCode])

  const triggerFbHistSync = useCallback(async (date?: string) => {
    setFbHistSyncing(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/fb-activity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      })
      const data = await res.json()
      alert(data.message ?? "Đang sync, chờ ~30s rồi refresh")
    } catch (e: any) { alert("Lỗi: " + e.message) } finally { setFbHistSyncing(false) }
  }, [])

  const cancelSchedule = useCallback(async (id: string) => {
    if (!confirm("Huỷ lịch hẹn này?")) return
    setCancelling(id)
    try {
      await apiFetch(`/admin/pancake-sync/report/camp-control/schedule/${id}`, { method: "DELETE" })
      await fetchSchedules()
    } finally { setCancelling(null) }
  }, [fetchSchedules])

  const fetchAiRecs = useCallback(async () => {
    setAiLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(AI_LIMIT), offset: String(aiOffset) })
      if (aiFilterStatus) p.set("status", aiFilterStatus)
      if (aiFilterMkt) p.set("mkt", aiFilterMkt)
      if (aiFilterRunId) p.set("run_id", aiFilterRunId)
      const res = await apiFetch(`/admin/pancake-sync/report/camp-ai?${p}`)
      const data = await res.json()
      setAiRecs(data.recommendations ?? [])
      setAiTotal(data.total ?? 0)
      setAiRunSummary(data.run_summary ?? [])
    } catch { /* ignore */ } finally { setAiLoading(false) }
  }, [aiFilterStatus, aiFilterMkt, aiFilterRunId, aiOffset])

  const triggerAiRun = useCallback(async () => {
    setAiTriggering(true)
    try {
      const body: any = aiCompareMode
        ? { models: aiCompareModels }
        : { model: aiModel, parallel: aiParallel || undefined }
      const res = await apiFetch("/admin/pancake-sync/report/camp-ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      alert(data.message ?? "Agent đã chạy")
    } catch (e: any) { alert("Lỗi: " + e.message) } finally { setAiTriggering(false) }
  }, [aiModel, aiParallel, aiCompareMode, aiCompareModels])

  const triggerSeedSkills = useCallback(async () => {
    if (!confirm("Seed 23 skills ban đầu vào agent_insight? Skills đã có sẽ được bỏ qua.")) return
    setAiSeeding(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-ai/seed-skills", { method: "POST" })
      const data = await res.json()
      if (data.ok) alert(`✅ Seed xong: ${data.inserted} inserted, ${data.skipped} skipped (tổng ${data.total} skills)`)
      else alert("Lỗi: " + data.error)
    } catch (e: any) { alert("Lỗi: " + e.message) } finally { setAiSeeding(false) }
  }, [])

  const fetchInsights = useCallback(async () => {
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-ai/insights?limit=50")
      const data = await res.json()
      setAiInsights(data.insights ?? [])
      setAiInsightStats(data.stats ?? [])
    } catch { /* ignore */ }
  }, [])

  const deleteInsight = useCallback(async (id: string) => {
    if (!confirm("Xóa insight này?")) return
    try {
      await apiFetch(`/admin/pancake-sync/report/camp-ai/insights?id=${id}`, { method: "DELETE" })
      await fetchInsights()
    } catch { /* ignore */ }
  }, [fetchInsights])

  const openAiLog = useCallback(async (runId: string, highlightCampaignId?: string) => {
    if (aiLogRunId === runId && !highlightCampaignId) { setAiLogRunId(null); return }
    setAiLogRunId(runId)
    setAiLogHighlight(highlightCampaignId ?? null)
    setAiLogLoading(true)
    setAiLogTrace([])
    setAiLogRecs([])
    setAiLogToolCalls([])
    try {
      const p = new URLSearchParams({ run_id: runId })
      const res = await apiFetch(`/admin/pancake-sync/report/camp-ai/reasoning?${p}`)
      const data = await res.json()
      setAiLogTrace(data.trace ?? [])
      setAiLogRecs(data.recommendations ?? [])
      setAiLogToolCalls(data.tool_calls ?? [])
    } catch { /* ignore */ } finally { setAiLogLoading(false) }
    // Fetch evaluation in parallel
    setEvalLoading(true)
    setEvalRunSummary(null)
    try {
      const r = await apiFetch(`/admin/pancake-sync/report/camp-ai/evaluation?view=run_summary&run_id=${runId}`)
      setEvalRunSummary(await r.json())
    } catch { /* ignore */ } finally { setEvalLoading(false) }
  }, [aiLogRunId])

  const refreshEval = useCallback(async () => {
    if (!aiLogRunId) return
    try {
      const r = await apiFetch(`/admin/pancake-sync/report/camp-ai/evaluation?view=run_summary&run_id=${aiLogRunId}`)
      setEvalRunSummary(await r.json())
    } catch { /* ignore */ }
  }, [aiLogRunId])

  const submitErrorTag = useCallback(async () => {
    if (!tagModalRec || !tagCategory) { alert("Cần chọn category"); return }
    try {
      const res = await apiFetch("/admin/pancake-sync/report/camp-ai/evaluation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: "rec", target_id: tagModalRec.id,
          layer: tagLayer, category: tagCategory, severity: tagSeverity, note: tagNote || undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setTagModalRec(null); setTagCategory(""); setTagNote("")
        await refreshEval()
      } else alert("Lỗi: " + (data.error ?? "unknown"))
    } catch (e: any) { alert("Lỗi: " + e.message) }
  }, [tagModalRec, tagLayer, tagCategory, tagSeverity, tagNote, refreshEval])

  const openReasoning = useCallback(async (rec: any) => {
    // Now opens sidebar instead of modal
    await openAiLog(rec.run_id, rec.campaign_id)
  }, [openAiLog])

  const approveRecWithNote = useCallback(async (id: string, decision: "approved" | "rejected", rejection_reason?: string) => {
    setAiApproving(id)
    try {
      const res = await apiFetch(`/admin/pancake-sync/report/camp-ai/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, rejection_reason }),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error ?? "unknown")); return }
      setAiRejectNoteId(null)
      setAiRejectNote("")
      await fetchAiRecs()
    } finally { setAiApproving(null) }
  }, [fetchAiRecs])

  const approveRec = useCallback(async (id: string, decision: "approved" | "rejected") => {
    await approveRecWithNote(id, decision)
  }, [approveRecWithNote])

  const fetchFbAccounts = useCallback(async () => {
    setFbLoading(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/fb-accounts")
      const data = await res.json()
      setFbAccounts(data.accounts ?? [])
    } catch { /* ignore */ } finally { setFbLoading(false) }
  }, [])

  const fbToggle = useCallback(async (acc: any) => {
    await apiFetch(`/admin/pancake-sync/fb-accounts/${acc.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !acc.active }),
    })
    await fetchFbAccounts()
  }, [fetchFbAccounts])

  const fbDelete = useCallback(async (acc: any) => {
    if (!confirm(`Xóa tài khoản ${acc.account_id}?`)) return
    await apiFetch(`/admin/pancake-sync/fb-accounts/${acc.id}`, { method: "DELETE" })
    await fetchFbAccounts()
  }, [fetchFbAccounts])

  const fbAdd = useCallback(async () => {
    setFbAddError("")
    if (!fbNewId.trim()) { setFbAddError("Nhập Account ID"); return }
    setFbSaving(true)
    try {
      const res = await apiFetch("/admin/pancake-sync/fb-accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: fbNewId.trim(), account_name: fbNewName.trim(), mkt_name: fbNewMkt.trim(), note: fbNewNote.trim() }),
      })
      const data = await res.json()
      if (data.error) { setFbAddError(data.error); return }
      setFbNewId(""); setFbNewName(""); setFbNewMkt(""); setFbNewNote("")
      await fetchFbAccounts()
    } catch (e: any) { setFbAddError(e.message) } finally { setFbSaving(false) }
  }, [fbNewId, fbNewName, fbNewMkt, fbNewNote, fetchFbAccounts])

  const fbSaveEdit = useCallback(async (acc: any) => {
    const patch: Record<string, string> = {}
    if (fbEditName !== acc.account_name) patch.account_name = fbEditName
    if (fbEditMkt !== (acc.mkt_name ?? "")) patch.mkt_name = fbEditMkt
    if (fbEditNote !== (acc.note ?? "")) patch.note = fbEditNote
    if (Object.keys(patch).length > 0) {
      await apiFetch(`/admin/pancake-sync/fb-accounts/${acc.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    }
    setFbEditingId(null)
    await fetchFbAccounts()
  }, [fbEditName, fbEditMkt, fbEditNote, fetchFbAccounts])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { if (activeTab === "camp") fetchCampData() }, [activeTab, fetchCampData])
  useEffect(() => { if (activeTab === "spProduct") fetchSpData() }, [activeTab, fetchSpData])
  useEffect(() => { if (activeTab === "jobs" && jobsSubTab === "schedules") fetchSchedules() }, [activeTab, jobsSubTab, fetchSchedules])
  useEffect(() => { if (activeTab === "jobs" && jobsSubTab === "logs") fetchActLogs() }, [activeTab, jobsSubTab, fetchActLogs])
  useEffect(() => { if (activeTab === "jobs" && jobsSubTab === "fb-history") fetchFbHistory() }, [activeTab, jobsSubTab, fetchFbHistory])
  useEffect(() => { if (activeTab === "fbaccounts" && canManageFb) fetchFbAccounts() }, [activeTab, canManageFb, fetchFbAccounts])
  useEffect(() => { if (activeTab === "ai") { fetchAiRecs(); fetchInsights() } }, [activeTab, fetchAiRecs, fetchInsights])
  useEffect(() => {
    if (activeTab !== "rules") return
    setRulesLoading(true)
    Promise.all([
      apiFetch("/admin/pancake-sync/report/care-rules").then(r => r.json()).then(r => setRules(r.rules ?? [])).catch(() => {}),
      apiFetch("/admin/pancake-sync/report/product-thresholds").then(r => r.json()).then(r => setThresholds(r.thresholds ?? [])).catch(() => {}),
    ]).finally(() => setRulesLoading(false))
  }, [activeTab])

  // Realtime heartbeat polling — chỉ active khi đang ở tab AI
  useEffect(() => {
    if (activeTab !== "ai") return
    let stopped = false
    const fetchHeartbeats = async () => {
      try {
        const res = await apiFetch("/admin/pancake-sync/report/camp-ai/heartbeat")
        const data = await res.json()
        if (!stopped) setAiHeartbeats(data.heartbeats ?? [])
      } catch { /* ignore */ }
    }
    fetchHeartbeats()
    const interval = setInterval(fetchHeartbeats, 2000)
    return () => { stopped = true; clearInterval(interval) }
  }, [activeTab])
  useEffect(() => {
    fetchCronStatus()
    const interval = setInterval(fetchCronStatus, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchCronStatus])

  const byDate: Record<string, Record<string, any>> = {}
  for (const row of rows) {
    const d = row.date
    if (!byDate[d]) byDate[d] = {}
    byDate[d][row.mkt_name] = row
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  const totalRevenue = Object.values(summary).reduce((s: number, m: any) => s + (m.revenue_total || 0), 0)
  const totalCost = Object.values(summary).reduce((s: number, m: any) => s + (m.ads_cost || 0), 0)
  const totalCarePct = totalRevenue > 0 ? Math.round(totalCost / totalRevenue * 10000) / 100 : null

  return (
    <div style={{ padding: "24px 32px", background: t.bg, minHeight: "100vh", color: t.text, transition: "background 0.2s, color 0.2s" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, whiteSpace: "nowrap" }}>COD theo MKT</h1>
          <div style={{ fontSize: 12, color: t.textMuted }}>Đơn Webcake · Chi phí Facebook Ads</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flex: "1 1 auto", justifyContent: "flex-end" }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
          <span style={{ color: t.textMuted }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)}
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
            <option value="day">Theo ngày</option>
            <option value="month">Theo tháng</option>
          </select>
          <button onClick={() => setDark(d => { const next = !d; try { localStorage.setItem("bao-cao-mkt-theme", next ? "dark" : "light") } catch {} return next })} style={{
            background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 6,
            padding: "8px 12px", cursor: "pointer", fontSize: 13, color: t.text
          }}>
            {dark ? "☀ Sáng" : "☾ Tối"}
          </button>
          <button onClick={fetchData} disabled={loading} style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
            padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, opacity: loading ? 0.6 : 1
          }}>
            {loading ? "Đang tải..." : "↻ Refresh"}
          </button>
          <button onClick={syncCost} disabled={syncing} style={{
            background: dark ? "#065f46" : "#d1fae5", color: t.green, border: `1px solid ${t.green}44`, borderRadius: 6,
            padding: "8px 16px", cursor: syncing ? "not-allowed" : "pointer", fontSize: 13, opacity: syncing ? 0.6 : 1
          }}>
            {syncing ? "Đang sync..." : "↓ Sync chi phí hôm nay"}
          </button>
        </div>
      </div>

      {/* Cron Status Bar */}
      {cronStatus && (() => {
        const s = cronStatus
        const color = s.status === "ok" ? t.green : s.status === "warning" ? t.amber : s.status === "error" ? t.red : t.textMuted
        const icon = s.status === "ok" ? "●" : s.status === "warning" ? "⚠" : s.status === "error" ? "✕" : "○"
        const label = s.status === "ok" ? "Cron đang hoạt động" : s.status === "warning" ? "Cron chậm" : s.status === "error" ? "Cron có thể bị lỗi" : "Chưa có data"
        const lastTime = s.last_updated
          ? new Date(s.last_updated).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
          : "—"
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, background: t.cronBg, borderRadius: 8, padding: "8px 16px", fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color, fontWeight: 700 }}>{icon} {label}</span>
            <span style={{ color: t.textMuted }}>Sync lần cuối: <span style={{ color: t.text }}>{lastTime}</span> ({s.minutes_ago !== null ? `${s.minutes_ago} phút trước` : "—"})</span>
            <span style={{ color: t.textMuted }}>Hôm nay: <span style={{ color: t.blue }}>{s.campaigns_today} campaigns</span> · <span style={{ color: t.purple }}>{s.accounts_with_data}/{s.accounts_active} accounts</span></span>
            {s.missing_accounts > 0 && (
              <span style={{ color: t.red }}>⚠ {s.missing_accounts} account chưa có data hôm nay</span>
            )}
          </div>
        )
      })()}

      {/* Tab toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: `1px solid ${t.cardBorder}`, overflowX: "auto", WebkitOverflowScrolling: "touch" as any, scrollbarWidth: "none" as any, msOverflowStyle: "none" as any }}>
        {([
          ["mkt", "Theo MKT"],
          ["camp", "Theo Camp"],
          ["spProduct", "Chi phí SP"],
          ["jobs", "⏰ Lịch hẹn Camp"],
          ...(has("page.bao-cao.care-rules") ? [["rules", "⚙️ Rule chăm sóc"]] : []),
          ...(canManageFb ? [["fbaccounts", "🔑 Tài khoản FB"]] : []),
          ...(isSuper ? [["ai", "🤖 AI Agent"]] : []),
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key as any)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "8px 20px", fontSize: 14, fontWeight: activeTab === key ? 700 : 400,
            color: activeTab === key ? t.blue : t.textMuted,
            borderBottom: activeTab === key ? `2px solid ${t.blue}` : "2px solid transparent",
            marginBottom: -1, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Summary cards — chỉ hiện ở tab MKT và Camp */}
      {(activeTab === "mkt" || activeTab === "camp") && <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: "10px 20px", minWidth: 150 }}>
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>Tổng COD</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: t.green }}>{fmtMoney(totalRevenue)}</div>
          {totalCost > 0 && (
            <>
              <div style={{ fontSize: 12, color: t.amber, marginTop: 2 }}>Chi phí: {fmtMoney(totalCost)}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: carePctColor(totalCarePct), marginTop: 2 }}>
                % Care: {totalCarePct !== null ? totalCarePct + "%" : "—"}
              </div>
            </>
          )}
        </div>
        {mktNames.filter(m => m !== "KHÁC").map(mkt => {
          const s = summary[mkt] || {}
          const pct = s.care_pct ?? null
          return (
            <div key={mkt} style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: "10px 20px", minWidth: 150 }}>
              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>{mkt}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.blue }}>{fmtMoney(s.revenue_total || 0)}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                <span style={{ color: t.green }}>{s.delivered || 0} giao</span>
                {" · "}
                <span style={{ color: t.blue }}>{s.new_orders || 0} chờ</span>
                {" · "}
                <span style={{ color: t.purple }}>{s.confirmed || 0} xác nhận</span>
                {" · "}
                <span style={{ color: t.red }}>{s.cancelled || 0} hủy</span>
              </div>
              <>
                <div style={{ fontSize: 11, color: t.amber, marginTop: 3 }}>Chi phí: {fmtMoney(s.ads_cost || 0)}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: carePctColor(pct), marginTop: 1 }}>
                  {pct !== null ? pct + "%" : "—"}
                </div>
              </>
            </div>
          )
        })}
      </div>}

      {/* Camp tab content */}
      {activeTab === "camp" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            {/* Quick range buttons */}
            {[
              { label: "Hôm nay", days: 0 },
              { label: "3 ngày", days: 3 },
              { label: "7 ngày", days: 7 },
            ].map(({ label, days }) => {
              const today = todayVN()
              const fromD = days === 0 ? today : (() => { const d = new Date(Date.now() + 7 * 3600000); d.setDate(d.getDate() - days + 1); return d.toISOString().slice(0, 10) })()
              const active = campRangeMode ? (campFrom === fromD && campTo === today) : (!campRangeMode && days === 0 && campDate === today)
              return (
                <button key={label} onClick={() => {
                  if (days === 0) {
                    setCampRangeMode(false); setCampDate(today)
                    fetchCampData({ rangeMode: false, date: today })
                  } else {
                    setCampRangeMode(true); setCampFrom(fromD); setCampTo(today)
                    fetchCampData({ rangeMode: true, from: fromD, to: today })
                  }
                }} style={{
                  background: active ? "#1d4ed8" : (dark ? "#374151" : "#f3f4f6"),
                  color: active ? "#fff" : t.text,
                  border: `1px solid ${active ? "#1d4ed8" : t.inputBorder}`,
                  borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: active ? 700 : 400,
                }}>
                  {label}
                </button>
              )
            })}
            <span style={{ color: t.textMuted, fontSize: 12 }}>|</span>
            {campRangeMode ? (
              <>
                <input type="date" value={campFrom} onChange={e => setCampFrom(e.target.value)}
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
                <span style={{ color: t.textMuted }}>→</span>
                <input type="date" value={campTo} onChange={e => setCampTo(e.target.value)}
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
              </>
            ) : (
              <input type="date" value={campDate} onChange={e => setCampDate(e.target.value)}
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
            )}
            <select value={campMktFilter} onChange={e => setCampMktFilter(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="">Tất cả MKT</option>
              {[...MKT_ORDER, ...mktNames.filter(m => !MKT_ORDER.includes(m) && m !== "KHÁC")].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="">Tất cả trạng thái</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAUSED">PAUSED</option>
            </select>
            <button onClick={fetchCampData} disabled={campLoading} style={{
              background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: campLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: campLoading ? 0.6 : 1
            }}>
              {campLoading ? "Đang tải..." : "↻ Refresh"}
            </button>
          </div>
          {(() => {
            const sortedCamps = [...campRows]
              .filter(r => !filterStatus || r.effective_status === filterStatus)
              .sort((a, b) => {
                const colMap: Record<string, (x: any) => number> = {
                  spend: x => Number(x.spend),
                  impressions: x => Number(x.impressions),
                  clicks: x => Number(x.clicks),
                  cpm: x => Number(x.impressions) > 0 ? Number(x.spend) / Number(x.impressions) * 1000 : 0,
                  cpc: x => Number(x.clicks) > 0 ? Number(x.spend) / Number(x.clicks) : 0,
                  cod_total: x => Number(x.cod_total),
                  care_pct: x => x.care_pct !== null ? Number(x.care_pct) : -1,
                  daily_budget: x => Number(x.daily_budget ?? 0),
                }
                const strColMap: Record<string, (x: any) => string> = {
                  effective_status: x => x.effective_status ?? "",
                  mkt_name: x => x.mkt_name ?? "",
                }
                colMap["ctr"] = x => Number(x.impressions) > 0 ? Number(x.clicks) / Number(x.impressions) * 100 : 0
                if (sortCol in strColMap) {
                  const sf = strColMap[sortCol]
                  return sortDir === "desc" ? sf(b).localeCompare(sf(a)) : sf(a).localeCompare(sf(b))
                }
                const fn = colMap[sortCol] ?? ((x: any) => Number(x.spend))
                return sortDir === "desc" ? fn(b) - fn(a) : fn(a) - fn(b)
              })
            const MKT_COLORS: Record<string, string> = {
              KIENLB: "#60a5fa", ANHNT: "#f472b6", NAMDV: "#34d399",
              XUANLT: "#fb923c", LINHMT: "#a78bfa", DUPD: "#facc15",
            }
            const mktColor = (name: string) => MKT_COLORS[name] ?? "#9ca3af"
            // Spend: đỏ nếu tiêu > 80% budget, vàng 60-80%
            const spendColor = (spd: number, budget: number) => {
              if (!budget) return t.amber
              const pct = spd / budget
              if (pct >= 0.8) return t.red
              if (pct >= 0.6) return t.amber
              return t.green
            }
            // CPM: xanh <300k, vàng 300-500k, đỏ >500k (VND)
            const cpmColor = (cpm: number | null) => {
              if (cpm === null) return t.textMuted
              if (cpm < 300000) return t.green
              if (cpm < 500000) return t.amber
              return t.red
            }
            // CPC: xanh <8k, vàng 8-15k, đỏ >15k (VND)
            const cpcColor = (cpc: number | null) => {
              if (cpc === null) return t.textMuted
              if (cpc < 8000) return t.green
              if (cpc < 15000) return t.amber
              return t.red
            }
            // CTR: xanh >5%, vàng 3-5%, đỏ <3%
            const ctrColor = (ctr: number) => {
              if (ctr >= 5) return t.green
              if (ctr >= 3) return t.amber
              return t.red
            }
            const mkSortTh = (col: string, label: string, align: "left" | "center" | "right" = "right") => (
              <th onClick={() => { if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir("desc") } }}
                style={{ padding: "10px 12px", textAlign: align, fontWeight: 600, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                {label} <span style={{ fontSize: 10, opacity: sortCol === col ? 1 : 0.4 }}>{sortCol === col ? (sortDir === "desc" ? "▼" : "▲") : "↕"}</span>
              </th>
            )
            return (
          <>
          {sortedCamps.length === 0 && !campLoading ? (
            <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>Không có dữ liệu{filterStatus ? ` trạng thái ${filterStatus}` : ""}</div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" as any }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
                {filterStatus ? `${sortedCamps.length}/${campRows.length} camp` : `${campRows.length} camp`}
                {campRangeMode && <span style={{ marginLeft: 8, color: t.amber }}>📅 Tổng {campFrom} → {campTo}</span>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 920 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${t.thead}`, color: t.theadText }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, position: "sticky", left: 0, zIndex: 2, background: dark ? t.card : "#fff", minWidth: 160, width: 160 }}>Campaign</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, position: "sticky", left: 160, zIndex: 2, background: dark ? t.card : "#fff", whiteSpace: "nowrap", cursor: "pointer", minWidth: 90, width: 90 }} onClick={() => { if (sortCol === "effective_status") setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol("effective_status"); setSortDir("asc") } }}>Status {sortCol === "effective_status" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
                    {mkSortTh("mkt_name", "MKT", "center")}
                    {mkSortTh("daily_budget", "Budget")}
                    {mkSortTh("spend", "Spend")}
                    {mkSortTh("impressions", "Impr")}
                    {mkSortTh("clicks", "Clicks")}
                    {mkSortTh("cpm", "CPM")}
                    {mkSortTh("cpc", "CPC")}
                    {mkSortTh("ctr", "CTR%")}
                    {mkSortTh("cod_total", "COD")}
                    <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Đơn</th>
                    {mkSortTh("care_pct", "% Care")}
                    {canControl && <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600 }}>⏰</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedCamps.map((row: any) => {
                    const imp = Number(row.impressions)
                    const clk = Number(row.clicks)
                    const spd = Number(row.spend)
                    const bdg = Number(row.daily_budget ?? 0)
                    const cpm = imp > 0 ? Math.round(spd / imp * 1000) : null
                    const cpc = clk > 0 ? Math.round(spd / clk) : null
                    const ctr = imp > 0 ? Math.round(clk / imp * 10000) / 100 : null
                    return (
                      <tr key={row.campaign_id} style={{ borderBottom: `1px solid ${t.rowBorder}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "10px 12px", color: t.text, minWidth: 160, width: 160, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", position: "sticky", left: 0, zIndex: 1, background: dark ? t.card : "#fff" }}
                          title={`Click để copy: ${row.campaign_name}`}
                          onClick={(e) => {
                            if (window.matchMedia("(pointer: coarse)").matches && canControl) {
                              // Mobile: mở action sheet
                              setMobileActionCamp(row)
                            } else {
                              navigator.clipboard.writeText(row.campaign_name).then(() => {
                                const el = document.createElement("div")
                                el.textContent = "✓ Đã copy"
                                Object.assign(el.style, { position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", background: "#1e293b", color: "#fff", padding: "8px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", zIndex: "9999", pointerEvents: "none" })
                                document.body.appendChild(el)
                                setTimeout(() => el.remove(), 1800)
                              })
                            }
                          }}>
                          {row.campaign_name}
                          {window.matchMedia?.("(pointer: coarse)").matches && canControl && (
                            <span style={{ marginLeft: 4, fontSize: 10, color: t.textMuted }}>⋯</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center", position: "sticky", left: 160, zIndex: 1, background: dark ? t.card : "#fff", minWidth: 90, width: 90 }}>
                          {(() => {
                            const st = row.effective_status as string | null
                            if (!st) return <span style={{ color: t.textMuted, fontSize: 11 }}>—</span>
                            const isActive = st === "ACTIVE"
                            const isPaused = st === "PAUSED"
                            const canToggle = ownerOf(row) && (isActive || isPaused)
                            const acting = actingCampId === row.campaign_id
                            const trackColor = isActive ? "#1877f2" : dark ? "#374151" : "#d1d5db"
                            const knobColor = "#ffffff"
                            return (
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <div
                                  onClick={() => canToggle && !acting && toggleStatus(row)}
                                  title={!canToggle ? (canControl ? `Camp của MKT ${row.mkt_name}` : "") : isActive ? "Click để pause" : "Click để bật"}
                                  style={{
                                    width: 36, height: 20, borderRadius: 10,
                                    background: acting ? (dark ? "#4b5563" : "#9ca3af") : trackColor,
                                    position: "relative", cursor: canToggle && !acting ? "pointer" : "default",
                                    opacity: acting ? 0.6 : canToggle ? 1 : 0.5,
                                    transition: "background 0.2s",
                                    flexShrink: 0,
                                  }}>
                                  <div style={{
                                    width: 14, height: 14, borderRadius: "50%", background: knobColor,
                                    position: "absolute", top: 3,
                                    left: isActive ? 18 : 4,
                                    transition: "left 0.2s",
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                                  }} />
                                </div>
                                <span style={{ fontSize: 10, color: isActive ? "#1877f2" : (dark ? "#6b7280" : "#9ca3af"), fontWeight: 600, minWidth: 40 }}>
                                  {acting ? "..." : isActive ? "ACTIVE" : isPaused ? "PAUSED" : st}
                                </span>
                              </div>
                            )
                          })()}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: mktColor(row.mkt_name) }}>{row.mkt_name || "KHÁC"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {editingBudget === row.campaign_id ? (
                            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                              <input type="number" min={50000} max={50000000} step={50000}
                                value={budgetValue} autoFocus
                                onChange={(e) => setBudgetValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveBudget(row); if (e.key === "Escape") setEditingBudget(null) }}
                                style={{ width: 100, background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "2px 6px", color: t.inputText, fontSize: 12 }} />
                              <button onClick={() => saveBudget(row)} disabled={actingCampId === row.campaign_id}
                                style={{ background: t.green, color: "#fff", border: "none", borderRadius: 4, padding: "2px 6px", fontSize: 11, cursor: "pointer" }}>✓</button>
                              <button onClick={() => setEditingBudget(null)}
                                style={{ background: "transparent", color: t.textMuted, border: "none", padding: "2px 4px", fontSize: 11, cursor: "pointer" }}>✕</button>
                            </span>
                          ) : (
                            <span
                              onClick={() => { if (ownerOf(row)) { setEditingBudget(row.campaign_id); setBudgetValue(String(row.daily_budget || 0)) } }}
                              title={ownerOf(row) ? "Click để sửa" : ""}
                              style={{ color: t.textMuted, cursor: ownerOf(row) ? "pointer" : "default", borderBottom: ownerOf(row) ? `1px dotted ${t.textMuted}` : "none" }}>
                              {row.daily_budget ? fmtMoney(Number(row.daily_budget)) : "—"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                          <span style={{ color: campRangeMode ? t.amber : spendColor(spd, bdg) }} title={!campRangeMode && bdg ? `${Math.round(spd/bdg*100)}% budget` : ""}>
                            {fmtMoney(spd)}
                          </span>
                          {!campRangeMode && bdg > 0 && <div style={{ fontSize: 10, color: t.textMuted }}>{Math.round(spd/bdg*100)}%</div>}
                          {campRangeMode && row.day_count > 0 && <div style={{ fontSize: 10, color: t.textMuted }}>{row.day_count}d</div>}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{imp.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{clk.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: cpmColor(cpm) }}>{cpm !== null ? fmtMoney(cpm) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: cpcColor(cpc) }}>{cpc !== null ? fmtMoney(cpc) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: ctr !== null ? ctrColor(ctr) : t.textMuted }}>
                          {ctr !== null ? ctr + "%" : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ color: t.green, fontWeight: 600 }}>{fmtMoney(Number(row.cod_total))}</div>
                          <div style={{ fontSize: 11, color: t.textMuted }}>{fmtMoney(Number(row.cod_confirmed))} xác nhận</div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontSize: 12 }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                            <span title="Xác nhận" style={{ color: t.green, fontWeight: 600 }}>✓{row.confirmed ?? 0}</span>
                            <span title="Hủy" style={{ color: t.red }}>✕{row.cancelled ?? 0}</span>
                          </div>
                          {Number(row.total_orders) > 0 && <div style={{ fontSize: 10, color: t.textMuted, textAlign: "right" }}>{row.total_orders} tổng</div>}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: carePctColor(row.care_pct !== null ? Number(row.care_pct) : null) }}>
                          {row.care_pct !== null ? Number(row.care_pct) + "%" : "—"}
                        </td>
                        {canControl && (
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <button onClick={() => setScheduleModalCamp(row)} disabled={!ownerOf(row)}
                              title={ownerOf(row) ? "Hẹn giờ + xem log" : `Camp của MKT ${row.mkt_name}`}
                              style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: ownerOf(row) ? t.amber : t.textMuted, padding: "2px 8px", borderRadius: 4, fontSize: 13, cursor: ownerOf(row) ? "pointer" : "not-allowed", opacity: ownerOf(row) ? 1 : 0.5 }}>
                              ⏰
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totSpend = sortedCamps.reduce((s: number, r: any) => s + Number(r.spend), 0)
                    const totImp = sortedCamps.reduce((s: number, r: any) => s + Number(r.impressions), 0)
                    const totClk = sortedCamps.reduce((s: number, r: any) => s + Number(r.clicks), 0)
                    const totCod = sortedCamps.reduce((s: number, r: any) => s + Number(r.cod_total), 0)
                    const totCpm = totImp > 0 ? Math.round(totSpend / totImp * 1000) : null
                    const totCpc = totClk > 0 ? Math.round(totSpend / totClk) : null
                    const totCtr = totImp > 0 ? Math.round(totClk / totImp * 10000) / 100 : null
                    const totCarePct = totCod > 0 ? Math.round(totSpend / totCod * 10000) / 100 : null
                    return (
                      <tr style={{ borderTop: `2px solid ${t.thead}`, background: t.tfoot }}>
                        <td colSpan={3} style={{ padding: "10px 12px", fontWeight: 700, color: t.text }}>TỔNG ({sortedCamps.length} camps)</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted, fontWeight: 600 }}>
                          {fmtMoney(sortedCamps.reduce((s: number, r: any) => s + Number(r.daily_budget ?? 0), 0))}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.amber, fontWeight: 700 }}>{fmtMoney(totSpend)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{totImp.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>{totClk.toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cpmColor(totCpm) }}>{totCpm !== null ? fmtMoney(totCpm) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cpcColor(totCpc) }}>{totCpc !== null ? fmtMoney(totCpc) : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: totCtr !== null ? ctrColor(totCtr) : t.textMuted }}>{totCtr !== null ? totCtr + "%" : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.green, fontWeight: 700 }}>{fmtMoney(totCod)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMuted }}>
                          {sortedCamps.reduce((s: number, r: any) => s + Number(r.delivered ?? 0), 0)}&#10003;
                          {" · "}
                          {sortedCamps.reduce((s: number, r: any) => s + Number(r.cancelled ?? 0), 0)}&#10007;
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: carePctColor(totCarePct) }}>
                          {totCarePct !== null ? totCarePct + "%" : "—"}
                        </td>
                        {canControl && <td></td>}
                      </tr>
                    )
                  })()}
                </tfoot>
              </table>
            </div>
          )}
          </>
          )})()}
        </div>
      )}

      {activeTab === "mkt" && (rows.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div>Không có dữ liệu trong khoảng thời gian này</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${t.thead}`, color: t.theadText }}>
                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>Ngày</th>
                {mktNames.map(mkt => (
                  <th key={mkt} style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", color: mkt === "KHÁC" ? t.textMuted : t.text }}>
                    {mkt}
                  </th>
                ))}
                <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: t.green }}>TỔNG</th>
              </tr>
            </thead>
            <tbody>
              {dates.map(date => {
                const dayRevenue = mktNames.reduce((s, m) => s + Number(byDate[date][m]?.revenue_total || 0), 0)
                const dayCost = mktNames.reduce((s, m) => s + Number(byDate[date][m]?.ads_cost || 0), 0)
                const dayCarePct = dayRevenue > 0 && dayCost > 0 ? Math.round(dayCost / dayRevenue * 10000) / 100 : null
                return (
                  <tr key={date} style={{ borderBottom: `1px solid ${t.rowBorder}` }}
                    onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 12px", color: t.text, fontWeight: 600 }}>
                      {groupBy === "month" ? date.slice(0, 7) : fmtDate(date)}
                    </td>
                    {mktNames.map(mkt => {
                      const cell = byDate[date][mkt]
                      const pct = cell?.care_pct ?? null
                      return (
                        <td key={mkt} style={{ padding: "10px 12px", textAlign: "right" }}>
                          {cell ? (
                            <div>
                              <div style={{ color: t.green, fontWeight: 600 }}>
                                {fmtMoney(Number(cell.revenue_total))}
                              </div>
                              <div style={{ fontSize: 11, marginTop: 2 }}>
                                <span style={{ color: t.green }}>{cell.delivered ?? 0}&#10003;</span>
                                {" · "}
                                <span style={{ color: t.blue }}>{cell.new_orders ?? 0}&#9675;</span>
                                {" · "}
                                <span style={{ color: t.purple }}>{cell.confirmed ?? 0}&#9654;</span>
                                {" · "}
                                <span style={{ color: t.red }}>{cell.cancelled ?? 0}&#10007;</span>
                              </div>
                              <div style={{ fontSize: 11, marginTop: 2 }}>
                                <span style={{ color: t.amber }}>{fmtMoney(Number(cell.ads_cost))}</span>
                                {" · "}
                                <span style={{ color: carePctColor(pct), fontWeight: 600 }}>
                                  {pct !== null ? pct + "%" : "—"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: t.empty }}>—</span>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ color: t.green, fontWeight: 700 }}>{fmtMoney(dayRevenue)}</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        <span style={{ color: t.amber }}>{fmtMoney(dayCost)}</span>
                        {" · "}
                        <span style={{ color: carePctColor(dayCarePct), fontWeight: 600 }}>
                          {dayCarePct !== null ? dayCarePct + "%" : "—"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${t.thead}`, background: t.tfoot }}>
                <td style={{ padding: "10px 12px", fontWeight: 700, color: t.text }}>TỔNG</td>
                {mktNames.map(mkt => {
                  const s = summary[mkt] || {}
                  const pct = s.care_pct ?? null
                  return (
                    <td key={mkt} style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ color: t.green, fontWeight: 700 }}>{fmtMoney(s.revenue_total || 0)}</div>
                      <div style={{ fontSize: 11, color: t.textMuted }}>{s.delivered || 0} đơn</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        <span style={{ color: t.amber }}>{fmtMoney(s.ads_cost || 0)}</span>
                        {" · "}
                        <span style={{ color: carePctColor(pct), fontWeight: 600 }}>
                          {pct !== null ? pct + "%" : "—"}
                        </span>
                      </div>
                    </td>
                  )
                })}
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  <div style={{ color: t.green, fontWeight: 700 }}>{fmtMoney(totalRevenue)}</div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    <span style={{ color: t.amber }}>{fmtMoney(totalCost)}</span>
                    {" · "}
                    <span style={{ color: carePctColor(totalCarePct), fontWeight: 600 }}>
                      {totalCarePct !== null ? totalCarePct + "%" : "—"}
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {scheduleModalCamp && (
        <ScheduleModal
          camp={scheduleModalCamp}
          onClose={() => setScheduleModalCamp(null)}
          t={t}
          onChanged={fetchCampData}
        />
      )}

      {/* Mobile action sheet */}
      {mobileActionCamp && (() => {
        const camp = mobileActionCamp
        const isActive = camp.effective_status === "ACTIVE"
        const isPaused = camp.effective_status === "PAUSED"
        const canToggle = ownerOf(camp) && (isActive || isPaused)
        const acting = actingCampId === camp.campaign_id
        return (
          <div onClick={() => setMobileActionCamp(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "flex-end" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: "100%", background: t.card, borderRadius: "16px 16px 0 0", padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {camp.campaign_name}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {/* Tắt/Bật */}
                <button disabled={!canToggle || !!acting}
                  onClick={async () => { await toggleStatus(camp); setMobileActionCamp(null) }}
                  style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "none", fontSize: 15, fontWeight: 700, cursor: canToggle ? "pointer" : "not-allowed", opacity: canToggle ? 1 : 0.4,
                    background: isActive ? "#fee2e2" : "#dcfce7", color: isActive ? "#dc2626" : "#16a34a" }}>
                  {acting ? "⏳" : isActive ? "⏸ Tắt camp" : "▶ Bật camp"}
                </button>
                {/* Ngân sách */}
                <button disabled={!ownerOf(camp)}
                  onClick={() => { setMobileActionCamp(null); setEditingBudget(camp.campaign_id); setBudgetValue(String(camp.daily_budget || 0)) }}
                  style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "none", fontSize: 15, fontWeight: 700, cursor: ownerOf(camp) ? "pointer" : "not-allowed", opacity: ownerOf(camp) ? 1 : 0.4,
                    background: dark ? "#1e3a5f" : "#dbeafe", color: dark ? "#93c5fd" : "#1d4ed8" }}>
                  💰 Ngân sách
                </button>
                {/* Hẹn giờ */}
                <button disabled={!ownerOf(camp)}
                  onClick={() => { setMobileActionCamp(null); setScheduleModalCamp(camp) }}
                  style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "none", fontSize: 15, fontWeight: 700, cursor: ownerOf(camp) ? "pointer" : "not-allowed", opacity: ownerOf(camp) ? 1 : 0.4,
                    background: dark ? "#2d2a00" : "#fef9c3", color: dark ? "#fde047" : "#a16207" }}>
                  ⏰ Hẹn giờ
                </button>
              </div>
              <button onClick={() => setMobileActionCamp(null)}
                style={{ padding: "12px 0", borderRadius: 10, border: `1px solid ${t.cardBorder}`, background: "transparent", color: t.textMuted, fontSize: 14, cursor: "pointer" }}>
                Huỷ
              </button>
            </div>
          </div>
        )
      })()}

      {/* ===== TAB CHI PHÍ SP ===== */}
      {activeTab === "spProduct" && (() => {
        const MKT_COLORS_SP: Record<string, string> = { KIENLB: "#60a5fa", ANHNT: "#f472b6", NAMDV: "#34d399", XUANLT: "#fb923c", LINHMT: "#a78bfa", DUPD: "#facc15", "NGUYEN MAI": "#e879f9" }
        const mktColor = (name: string) => MKT_COLORS_SP[(name ?? "").trim()] ?? "#9ca3af"
        const pctColor = (pct: number | null) => {
          if (pct === null) return t.textMuted
          if (pct < 30) return t.green
          if (pct <= 40) return t.amber
          return t.red
        }
        const thS: React.CSSProperties = { padding: "10px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: t.theadText, borderBottom: `2px solid ${t.cardBorder}`, whiteSpace: "nowrap", background: t.card, cursor: "pointer", userSelect: "none" }
        const tdS: React.CSSProperties = { padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${t.rowBorder}`, textAlign: "right" }

        const sorted = [...spRows].sort((a, b) => {
          const va = Number(a[spSortCol] ?? 0)
          const vb = Number(b[spSortCol] ?? 0)
          return spSortDir === "desc" ? vb - va : va - vb
        })
        const mkTh = (col: string, label: string) => (
          <th style={{ ...thS, color: spSortCol === col ? t.blue : t.theadText }}
            onClick={() => { if (spSortCol === col) setSpSortDir(d => d === "desc" ? "asc" : "desc"); else { setSpSortCol(col); setSpSortDir("desc") } }}>
            {label}{spSortCol === col ? (spSortDir === "desc" ? " ↓" : " ↑") : ""}
          </th>
        )

        const qBtnSp = (label: string, f: string, t2: string) => {
          const active = spFrom === f && spTo === t2
          return (
            <button onClick={() => { setSpFrom(f); setSpTo(t2); fetchSpData({ from: f, to: t2 }) }}
              style={{ background: active ? "#1d4ed8" : (dark ? "#374151" : "#e5e7eb"), color: active ? "#fff" : t.text, border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 400 }}>
              {label}
            </button>
          )
        }

        return (
          <div>
            {/* Controls */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
              {qBtnSp("Hôm nay", todayStr, todayStr)}
              {qBtnSp("3 ngày", (() => { const d = new Date(Date.now() + 7 * 3600000); d.setDate(d.getDate() - 2); return d.toISOString().slice(0,10) })(), todayStr)}
              {qBtnSp("7 ngày", (() => { const d = new Date(Date.now() + 7 * 3600000); d.setDate(d.getDate() - 6); return d.toISOString().slice(0,10) })(), todayStr)}
              <input type="date" value={spFrom} onChange={e => setSpFrom(e.target.value)}
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 8px", color: t.inputText, fontSize: 13 }} />
              <span style={{ color: t.textMuted }}>→</span>
              <input type="date" value={spTo} onChange={e => setSpTo(e.target.value)}
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 8px", color: t.inputText, fontSize: 13 }} />
              <select value={spMktFilter} onChange={e => setSpMktFilter(e.target.value)}
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13, cursor: "pointer" }}>
                <option value="">Tất cả MKT</option>
                {mktNames.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => fetchSpData()} disabled={spLoading} style={{
                background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
                padding: "8px 16px", cursor: spLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: spLoading ? 0.6 : 1
              }}>
                {spLoading ? "⏳ Đang tải..." : "↻ Refresh"}
              </button>
              <span style={{ fontSize: 12, color: t.textMuted }}>
                {spFrom} → {spTo} · {sorted.length} dòng
              </span>
            </div>

            {spLoading ? (
              <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>Đang tải...</div>
            ) : sorted.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>Không có dữ liệu</div>
            ) : (
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" as any }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thS, textAlign: "left", position: "sticky", left: 0, zIndex: 2, background: dark ? t.card : "#fff", minWidth: 200 }}>MKT_Sản phẩm</th>
                      {mkTh("spend", "Chi phí")}
                      {mkTh("don", "Đơn")}
                      {mkTh("chi_phi_don", "CP/đơn")}
                      {mkTh("doanh_so", "Doanh số")}
                      {mkTh("pct_ads", "% ADS")}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row, i) => {
                      const mkt = (row.mkt_name ?? "").trim()
                      const pct = row.pct_ads !== null ? Number(row.pct_ads) : null
                      return (
                        <tr key={i}
                          onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}>
                          <td style={{ padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${t.rowBorder}`, position: "sticky", left: 0, zIndex: 1, background: dark ? t.card : "#fff" }}>
                            <span style={{ fontWeight: 700, color: mktColor(mkt), marginRight: 4 }}>{mkt}</span>
                            <span style={{ color: t.text }}>{row.item_name}</span>
                          </td>
                          <td style={tdS}>{Number(row.spend).toLocaleString("vi-VN")}đ</td>
                          <td style={{ ...tdS, color: t.blue }}>{row.don}</td>
                          <td style={tdS}>{row.don > 0 ? Number(row.chi_phi_don).toLocaleString("vi-VN") + "đ" : "—"}</td>
                          <td style={tdS}>{Number(row.doanh_so).toLocaleString("vi-VN")}đ</td>
                          <td style={{ ...tdS, fontWeight: 700 }}>
                            {pct !== null ? (
                              <span style={{
                                background: pct < 30 ? (dark ? "#065f46" : "#dcfce7") : pct <= 40 ? (dark ? "#78350f" : "#fef3c7") : (dark ? "#7f1d1d" : "#fee2e2"),
                                color: pctColor(pct),
                                padding: "2px 8px", borderRadius: 4, fontSize: 12
                              }}>{pct}%</span>
                            ) : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ===== TAB 3: LỊCH HẸN CAMP ===== */}
      {activeTab === "jobs" && (() => {
        const thS: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: t.theadText, borderBottom: `2px solid ${t.cardBorder}`, whiteSpace: "nowrap", background: t.card }
        const tdS: React.CSSProperties = { padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${t.rowBorder}` }
        const MKT_COLORS_LOCAL: Record<string, string> = { KIENLB: "#60a5fa", ANHNT: "#f472b6", NAMDV: "#34d399", XUANLT: "#fb923c", LINHMT: "#a78bfa", DUPD: "#facc15" }
        const mktColor = (name: string) => MKT_COLORS_LOCAL[name] ?? "#9ca3af"
        const extractMktLocal = (campName: string) => {
          if (!campName) return "?"
          for (const p of campName.split("_").slice(1)) {
            if (/^[A-Z]{3,8}$/.test(p.trim())) return p.trim()
          }
          return "?"
        }
        const fmtDtLocal = (iso: string) => {
          if (!iso) return "—"
          return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        }
        const ActionBadge = ({ action }: { action: string }) => {
          const cfg: Record<string, { label: string; bg: string; color: string }> = {
            pause: { label: "Tắt", bg: "#fef3c7", color: "#d97706" },
            activate: { label: "Bật", bg: "#dcfce7", color: "#16a34a" },
            set_budget: { label: "Budget", bg: "#ede9fe", color: "#7c3aed" },
          }
          const c = cfg[action] ?? { label: action, bg: "#f3f4f6", color: "#374151" }
          return <span style={{ background: c.bg, color: c.color, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{c.label}</span>
        }
        const StatusBadge = ({ status }: { status: string }) => {
          const cfg: Record<string, { color: string; label: string }> = {
            pending: { color: "#2563eb", label: "Chờ duyệt" }, done: { color: "#16a34a", label: "Done" },
            failed: { color: "#dc2626", label: "Failed" }, cancelled: { color: "#6b7280", label: "Đã huỷ" },
          }
          const c = cfg[status] ?? { color: "#6b7280", label: status }
          return <span style={{ color: c.color, fontWeight: 600, fontSize: 12 }}>{c.label}</span>
        }
        return (
          <div>
            {/* Sub-tab bar */}
            <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: `1px solid ${t.cardBorder}` }}>
              {([["schedules", "⏰ Lịch hẹn giờ"], ["logs", "📋 Lịch sử hành động"], ["fb-history", "📊 Lịch sử FB"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setJobsSubTab(key)} style={{
                  background: "none", border: "none", cursor: "pointer", padding: "8px 20px", fontSize: 13, fontWeight: jobsSubTab === key ? 700 : 400,
                  color: jobsSubTab === key ? t.blue : t.textMuted,
                  borderBottom: jobsSubTab === key ? `2px solid ${t.blue}` : "2px solid transparent", marginBottom: -1,
                }}>{label}</button>
              ))}
            </div>

            {/* SCHEDULES */}
            {jobsSubTab === "schedules" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={schedStatus} onChange={e => { setSchedStatus(e.target.value); setSchedOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "7px 12px", fontSize: 13, color: t.inputText }}>
                    <option value="">Tất cả trạng thái</option>
                    <option value="pending">Pending</option>
                    <option value="done">Done</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  {(isSuper || !mktCode) && (
                    <select value={schedMkt} onChange={e => { setSchedMkt(e.target.value); setSchedOffset(0) }}
                      style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "7px 12px", fontSize: 13, color: t.inputText }}>
                      <option value="">Tất cả MKT</option>
                      {MKT_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <button onClick={fetchSchedules} disabled={schedLoading}
                    style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: schedLoading ? 0.6 : 1 }}>
                    {schedLoading ? "..." : "↻ Refresh"}
                  </button>
                  <span style={{ fontSize: 12, color: t.textMuted }}>{schedTotal} lịch hẹn</span>
                </div>
                <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thS}>Campaign</th>
                        <th style={{ ...thS, textAlign: "center" }}>MKT</th>
                        <th style={{ ...thS, textAlign: "center" }}>Hành động</th>
                        <th style={thS}>Hẹn lúc</th>
                        <th style={thS}>Thực hiện lúc</th>
                        <th style={{ ...thS, textAlign: "center" }}>Trạng thái</th>
                        <th style={thS}>Tạo bởi</th>
                        <th style={thS}>Lỗi</th>
                        {canControl && <th style={{ ...thS, textAlign: "center" }}>Huỷ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.length === 0 ? (
                        <tr><td colSpan={canControl ? 9 : 8} style={{ ...tdS, textAlign: "center", color: t.textMuted, padding: 40 }}>
                          {schedLoading ? "Đang tải..." : "Không có dữ liệu"}
                        </td></tr>
                      ) : schedules.map(s => {
                        const mkt = extractMktLocal(s.campaign_name)
                        return (
                          <tr key={s.id} onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                            <td style={{ ...tdS, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: t.text }} title={s.campaign_name}>{s.campaign_name}</td>
                            <td style={{ ...tdS, textAlign: "center", fontWeight: 700, color: mktColor(mkt) }}>{mkt}</td>
                            <td style={{ ...tdS, textAlign: "center" }}>
                              <ActionBadge action={s.action} />
                              {s.action === "set_budget" && s.payload?.daily_budget && (
                                <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>{Number(s.payload.daily_budget).toLocaleString("vi-VN")}đ</div>
                              )}
                            </td>
                            <td style={{ ...tdS, fontWeight: 600, color: s.status === "pending" ? t.blue : t.text }}>{fmtDtLocal(s.scheduled_at)}</td>
                            <td style={{ ...tdS, color: t.textMuted }}>{s.executed_at ? fmtDtLocal(s.executed_at) : "—"}</td>
                            <td style={{ ...tdS, textAlign: "center" }}><StatusBadge status={s.status} /></td>
                            <td style={{ ...tdS, color: t.textMuted, fontSize: 12 }}>{s.created_by_email?.split("@")[0]}</td>
                            <td style={{ ...tdS, color: t.red, fontSize: 12, maxWidth: 180 }}>{s.error_message ?? ""}</td>
                            {canControl && (
                              <td style={{ ...tdS, textAlign: "center" }}>
                                {s.status === "pending" && (
                                  <button onClick={() => cancelSchedule(s.id)} disabled={cancelling === s.id}
                                    style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: "pointer", opacity: cancelling === s.id ? 0.5 : 1 }}>
                                    {cancelling === s.id ? "..." : "Huỷ"}
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {schedTotal > SCHED_LIMIT && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
                    <button disabled={schedOffset === 0} onClick={() => setSchedOffset(Math.max(0, schedOffset - SCHED_LIMIT))}
                      style={{ padding: "6px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: schedOffset === 0 ? "not-allowed" : "pointer", opacity: schedOffset === 0 ? 0.4 : 1, background: t.card, color: t.text }}>← Trước</button>
                    <span style={{ fontSize: 13, color: t.textMuted, lineHeight: "34px" }}>{Math.floor(schedOffset / SCHED_LIMIT) + 1} / {Math.ceil(schedTotal / SCHED_LIMIT)}</span>
                    <button disabled={schedOffset + SCHED_LIMIT >= schedTotal} onClick={() => setSchedOffset(schedOffset + SCHED_LIMIT)}
                      style={{ padding: "6px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: schedOffset + SCHED_LIMIT >= schedTotal ? "not-allowed" : "pointer", opacity: schedOffset + SCHED_LIMIT >= schedTotal ? 0.4 : 1, background: t.card, color: t.text }}>Sau →</button>
                  </div>
                )}
              </div>
            )}

            {/* LOGS */}
            {jobsSubTab === "logs" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  {(isSuper || !mktCode) && (
                    <select value={actLogsMkt} onChange={e => { setActLogsMkt(e.target.value); setActLogsOffset(0) }}
                      style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "7px 12px", fontSize: 13, color: t.inputText }}>
                      <option value="">Tất cả MKT</option>
                      {MKT_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <select value={actLogsAction} onChange={e => { setActLogsAction(e.target.value); setActLogsOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "7px 12px", fontSize: 13, color: t.inputText }}>
                    <option value="">Tất cả hành động</option>
                    <option value="pause">Tắt camp</option>
                    <option value="activate">Bật camp</option>
                    <option value="set_budget">Chỉnh budget</option>
                  </select>
                  <input type="date" value={actLogsFrom} onChange={e => { setActLogsFrom(e.target.value); setActLogsOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, color: t.inputText }} />
                  <input type="date" value={actLogsTo} onChange={e => { setActLogsTo(e.target.value); setActLogsOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, color: t.inputText }} />
                  <button onClick={fetchActLogs} disabled={actLogsLoading}
                    style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: actLogsLoading ? 0.6 : 1 }}>
                    {actLogsLoading ? "..." : "↻ Refresh"}
                  </button>
                  <span style={{ fontSize: 12, color: t.textMuted }}>{actLogsTotal} hành động</span>
                </div>
                <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thS}>Thời gian</th>
                        <th style={{ ...thS, textAlign: "center" }}>MKT</th>
                        <th style={thS}>Campaign</th>
                        <th style={{ ...thS, textAlign: "center" }}>Hành động</th>
                        <th style={thS}>Trước</th>
                        <th style={thS}>Sau</th>
                        <th style={{ ...thS, textAlign: "center" }}>Nguồn</th>
                        <th style={thS}>Người thực hiện</th>
                        <th style={{ ...thS, textAlign: "center" }}>Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actLogs.length === 0 ? (
                        <tr><td colSpan={9} style={{ ...tdS, textAlign: "center", color: t.textMuted, padding: 40 }}>
                          {actLogsLoading ? "Đang tải..." : "Chưa có lịch sử thao tác"}
                        </td></tr>
                      ) : actLogs.map(log => {
                        const mkt = extractMktLocal(log.campaign_name)
                        const oldV = log.old_value ?? {}
                        const newV = log.new_value ?? {}
                        return (
                          <tr key={log.id} onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                            <td style={{ ...tdS, color: t.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDtLocal(log.created_at)}</td>
                            <td style={{ ...tdS, textAlign: "center", fontWeight: 700, color: mktColor(mkt) }}>{mkt}</td>
                            <td style={{ ...tdS, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: t.text }} title={log.campaign_name}>{log.campaign_name}</td>
                            <td style={{ ...tdS, textAlign: "center" }}><ActionBadge action={log.action} /></td>
                            <td style={{ ...tdS, fontSize: 12, color: t.textMuted }}>
                              {log.action === "set_budget" ? (oldV.daily_budget ? Number(oldV.daily_budget).toLocaleString("vi-VN") + "đ" : "—") : (oldV.status ?? "—")}
                            </td>
                            <td style={{ ...tdS, fontSize: 12, fontWeight: 600, color: t.text }}>
                              {log.action === "set_budget" ? (newV.daily_budget ? Number(newV.daily_budget).toLocaleString("vi-VN") + "đ" : "—") : (newV.status ?? "—")}
                            </td>
                            <td style={{ ...tdS, textAlign: "center" }}>
                              <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4,
                                background: log.source === "manual" ? "#dbeafe" : log.source === "agent" ? "#ede9fe" : "#fef3c7",
                                color: log.source === "manual" ? "#1d4ed8" : log.source === "agent" ? "#7c3aed" : "#92400e" }}>
                                {log.source === "manual" ? "Manual" : log.source === "agent" ? "🤖 AI" : "Auto"}
                              </span>
                            </td>
                            <td style={{ ...tdS, fontSize: 12, color: t.textMuted }}>{log.user_email?.split("@")[0]}</td>
                            <td style={{ ...tdS, textAlign: "center" }}>
                              {log.success
                                ? <span style={{ color: "#16a34a", fontSize: 16 }}>✓</span>
                                : <span style={{ color: "#dc2626", fontSize: 16 }} title={log.fb_response?.error?.message}>✗</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {actLogsTotal > LOGS_LIMIT && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
                    <button disabled={actLogsOffset === 0} onClick={() => setActLogsOffset(Math.max(0, actLogsOffset - LOGS_LIMIT))}
                      style={{ padding: "6px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: actLogsOffset === 0 ? "not-allowed" : "pointer", opacity: actLogsOffset === 0 ? 0.4 : 1, background: t.card, color: t.text }}>← Trước</button>
                    <span style={{ fontSize: 13, color: t.textMuted, lineHeight: "34px" }}>{Math.floor(actLogsOffset / LOGS_LIMIT) + 1} / {Math.ceil(actLogsTotal / LOGS_LIMIT)}</span>
                    <button disabled={actLogsOffset + LOGS_LIMIT >= actLogsTotal} onClick={() => setActLogsOffset(actLogsOffset + LOGS_LIMIT)}
                      style={{ padding: "6px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: actLogsOffset + LOGS_LIMIT >= actLogsTotal ? "not-allowed" : "pointer", opacity: actLogsOffset + LOGS_LIMIT >= actLogsTotal ? 0.4 : 1, background: t.card, color: t.text }}>Sau →</button>
                  </div>
                )}
              </div>
            )}

            {/* FB HISTORY */}
            {jobsSubTab === "fb-history" && (
              <div>
                {/* Toolbar */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
                  <input type="date" value={fbHistFrom} onChange={e => { setFbHistFrom(e.target.value); setFbHistOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
                  <span style={{ color: t.textMuted }}>→</span>
                  <input type="date" value={fbHistTo} onChange={e => { setFbHistTo(e.target.value); setFbHistOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
                  {(isSuper || !mktCode) && (
                    <select value={fbHistMkt} onChange={e => { setFbHistMkt(e.target.value); setFbHistOffset(0) }}
                      style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
                      <option value="">Tất cả MKT</option>
                      {MKT_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <select value={fbHistActorType} onChange={e => { setFbHistActorType(e.target.value); setFbHistOffset(0) }}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
                    <option value="">Tất cả người thao tác</option>
                    <option value="human">Marketer (tay)</option>
                    <option value="rule">Quy tắc FB</option>
                    <option value="meta">Meta tự động</option>
                  </select>
                  <button onClick={fetchFbHistory} disabled={fbHistLoading}
                    style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontSize: 13, color: t.text, opacity: fbHistLoading ? 0.6 : 1 }}>
                    {fbHistLoading ? "..." : "↻ Refresh"}
                  </button>
                  {isSuper && (
                    <button onClick={() => triggerFbHistSync()} disabled={fbHistSyncing}
                      style={{ background: dark ? "#065f46" : "#dcfce7", color: t.green, border: `1px solid ${t.green}44`, borderRadius: 6, padding: "7px 14px", cursor: fbHistSyncing ? "not-allowed" : "pointer", fontSize: 13, opacity: fbHistSyncing ? 0.6 : 1 }}>
                      {fbHistSyncing ? "Đang sync..." : "↓ Sync hôm qua"}
                    </button>
                  )}
                  <span style={{ fontSize: 12, color: t.textMuted }}>{fbHistTotal} hoạt động</span>
                </div>

                {/* Table */}
                {fbHistLoading ? (
                  <div style={{ color: t.textMuted, textAlign: "center", padding: 40 }}>Đang tải...</div>
                ) : fbHistory.length === 0 ? (
                  <div style={{ color: t.textMuted, textAlign: "center", padding: 60, fontSize: 14 }}>
                    Chưa có dữ liệu. Bấm "Sync hôm qua" để pull lần đầu.
                  </div>
                ) : (
                  <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: t.thead }}>
                          {["Thời gian", "Campaign", "MKT", "Người thao tác", "Loại", "Thay đổi"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: t.theadText, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fbHistory.map((row: any) => {
                          const ts = new Date(row.event_time).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                          const actorColor = row.actor_type === "human" ? t.green : row.actor_type === "rule" ? t.amber : t.textMuted
                          const actorLabel = row.actor_type === "human" ? "👤" : row.actor_type === "rule" ? "🤖 Quy tắc" : "⚙ Meta"
                          const isStatus = row.event_type === "update_campaign_run_status"
                          const oldV = row.old_value?.value ?? "—"
                          const newV = row.new_value?.value ?? "—"
                          return (
                            <tr key={row.id}
                              onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                              onMouseLeave={e => (e.currentTarget.style.background = "")}>
                              <td style={{ padding: "8px 12px", color: t.textMuted, whiteSpace: "nowrap" }}>{ts}</td>
                              <td style={{ padding: "8px 12px", maxWidth: 260 }}>
                                <div style={{ color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.campaign_name}</div>
                                <div style={{ color: t.textMuted, fontSize: 11, fontFamily: "monospace" }}>{row.campaign_id?.slice(0, 18)}</div>
                              </td>
                              <td style={{ padding: "8px 12px", color: t.purple, fontWeight: 600 }}>{row.mkt_name}</td>
                              <td style={{ padding: "8px 12px" }}>
                                <span style={{ color: actorColor, fontWeight: row.actor_type === "human" ? 600 : 400 }}>{actorLabel}</span>
                                <div style={{ color: t.textMuted, fontSize: 11 }}>{row.actor_name}</div>
                              </td>
                              <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                                <span style={{ color: isStatus ? t.blue : t.amber, fontSize: 12 }}>
                                  {isStatus ? "Trạng thái" : "Ngân sách"}
                                </span>
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <span style={{ color: t.red, fontSize: 12 }}>{String(oldV)}</span>
                                <span style={{ color: t.textMuted, margin: "0 6px" }}>→</span>
                                <span style={{ color: t.green, fontSize: 12, fontWeight: 600 }}>{String(newV)}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {fbHistTotal > FB_HIST_LIMIT && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
                    <button disabled={fbHistOffset === 0} onClick={() => setFbHistOffset(Math.max(0, fbHistOffset - FB_HIST_LIMIT))}
                      style={{ padding: "6px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: "pointer", background: t.card, color: t.text }}>← Trước</button>
                    <span style={{ fontSize: 13, color: t.textMuted, lineHeight: "34px" }}>{Math.floor(fbHistOffset / FB_HIST_LIMIT) + 1} / {Math.ceil(fbHistTotal / FB_HIST_LIMIT)}</span>
                    <button disabled={fbHistOffset + FB_HIST_LIMIT >= fbHistTotal} onClick={() => setFbHistOffset(fbHistOffset + FB_HIST_LIMIT)}
                      style={{ padding: "6px 16px", border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: "pointer", background: t.card, color: t.text }}>Sau →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ===== TAB 4: TÀI KHOẢN FB (manager only) ===== */}
      {activeTab === "fbaccounts" && canManageFb && (() => {
        const inputS: React.CSSProperties = { background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13, width: "100%" }
        const thS: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: t.theadText, borderBottom: `2px solid ${t.cardBorder}`, whiteSpace: "nowrap", background: t.card }
        const tdS: React.CSSProperties = { padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${t.rowBorder}`, verticalAlign: "middle" }
        return (
          <div>
            <div style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 4 }}>Tài khoản Facebook Ads</h2>
              <div style={{ fontSize: 12, color: t.textMuted }}>Danh sách ad accounts dùng để pull chi phí MKT. Token FB: env <code style={{ background: t.cronBg, padding: "1px 5px", borderRadius: 3 }}>FB_ACCESS_TOKEN</code></div>
            </div>

            {/* Form thêm mới */}
            <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 12 }}>+ Thêm tài khoản mới</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1.5fr 2fr auto", gap: 10, alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>Account ID *</div>
                  <input style={inputS} placeholder="act_853668... hoặc số" value={fbNewId} onChange={e => setFbNewId(e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>Tên tài khoản</div>
                  <input style={inputS} placeholder="PHV - Ads298..." value={fbNewName} onChange={e => setFbNewName(e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>MKT phụ trách</div>
                  <select style={{ ...inputS, cursor: "pointer" }} value={fbNewMkt} onChange={e => setFbNewMkt(e.target.value)}>
                    <option value="">-- Tự động --</option>
                    {MKT_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>Ghi chú</div>
                  <input style={inputS} placeholder="FULLVIA_ANHTD..." value={fbNewNote} onChange={e => setFbNewNote(e.target.value)} />
                </div>
                <button onClick={fbAdd} disabled={fbSaving}
                  style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: fbSaving ? 0.6 : 1, whiteSpace: "nowrap" }}>
                  {fbSaving ? "..." : "Thêm"}
                </button>
              </div>
              {fbAddError && <div style={{ color: t.red, fontSize: 12, marginTop: 8 }}>{fbAddError}</div>}
            </div>

            {/* Danh sách accounts */}
            {fbLoading ? (
              <div style={{ color: t.textMuted, textAlign: "center", padding: 40 }}>Đang tải...</div>
            ) : fbAccounts.length === 0 ? (
              <div style={{ color: t.textMuted, textAlign: "center", padding: 40 }}>Chưa có tài khoản nào.</div>
            ) : (
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={thS}>Trạng thái</th>
                      <th style={thS}>Account ID</th>
                      <th style={thS}>Tên tài khoản</th>
                      <th style={thS}>MKT phụ trách</th>
                      <th style={thS}>Camp hôm nay</th>
                      <th style={thS}>Ghi chú</th>
                      <th style={thS}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fbAccounts.map(acc => {
                      const isEditing = fbEditingId === acc.id
                      return (
                        <tr key={acc.id} style={{ opacity: acc.active ? 1 : 0.5 }}
                          onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}>
                          <td style={tdS}>
                            <button onClick={() => fbToggle(acc)} style={{
                              background: acc.active ? (dark ? "#065f46" : "#dcfce7") : t.card,
                              color: acc.active ? t.green : t.textMuted,
                              border: `1px solid ${acc.active ? t.green + "44" : t.cardBorder}`,
                              borderRadius: 12, padding: "3px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600,
                            }}>
                              {acc.active ? "● Bật" : "○ Tắt"}
                            </button>
                          </td>
                          <td style={{ ...tdS, color: t.blue, fontFamily: "monospace" }}>{acc.account_id}</td>
                          <td style={tdS}>
                            {isEditing
                              ? <input style={{ ...inputS, width: 200 }} value={fbEditName} onChange={e => setFbEditName(e.target.value)} />
                              : <span style={{ color: t.text }}>{acc.account_name || <span style={{ color: t.textMuted }}>—</span>}</span>}
                          </td>
                          <td style={tdS}>
                            {isEditing
                              ? <select style={{ ...inputS, width: "auto", cursor: "pointer" }} value={fbEditMkt} onChange={e => setFbEditMkt(e.target.value)}>
                                  <option value="">Tự động</option>
                                  {MKT_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                              : <span style={{ color: acc.mkt_name ? t.purple : t.textMuted, fontWeight: acc.mkt_name ? 600 : 400 }}>{acc.mkt_name || "Tự động"}</span>}
                          </td>
                          <td style={{ ...tdS, textAlign: "center" }}>
                            {(() => {
                              const daysSince = acc.last_spend_date
                                ? Math.floor((Date.now() - new Date(acc.last_spend_date).getTime()) / 86400000)
                                : null
                              const warn = acc.active && (daysSince === null || daysSince >= 3)
                              return (
                                <div>
                                  <span style={{ fontWeight: 600, color: acc.active_camps_today > 0 ? t.green : t.textMuted }}>
                                    {acc.active_camps_today > 0 ? `${acc.active_camps_today} camp` : "—"}
                                  </span>
                                  {warn && (
                                    <div style={{ fontSize: 10, color: t.amber, marginTop: 2 }}>
                                      {daysSince === null ? "⚠ Chưa có data" : `⚠ Không có data ${daysSince}d`}
                                    </div>
                                  )}
                                  {!warn && acc.last_spend_date && (
                                    <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>{fmtDate(acc.last_spend_date)}</div>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                          <td style={tdS}>
                            {isEditing
                              ? <input style={{ ...inputS, width: 180 }} value={fbEditNote} onChange={e => setFbEditNote(e.target.value)} />
                              : <span style={{ color: t.textMuted }}>{acc.note || "—"}</span>}
                          </td>
                          <td style={{ ...tdS, display: "flex", gap: 6 }}>
                            {isEditing ? (
                              <>
                                <button onClick={() => fbSaveEdit(acc)} style={{ background: dark ? "#065f46" : "#dcfce7", color: t.green, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Lưu</button>
                                <button onClick={() => setFbEditingId(null)} style={{ background: t.card, color: t.textMuted, border: `1px solid ${t.cardBorder}`, borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Hủy</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => { setFbEditingId(acc.id); setFbEditName(acc.account_name ?? ""); setFbEditMkt(acc.mkt_name ?? ""); setFbEditNote(acc.note ?? "") }}
                                  style={{ background: dark ? "#1e3a5f" : "#dbeafe", color: t.blue, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Sửa</button>
                                <button onClick={() => fbDelete(acc)} style={{ background: dark ? "#3b0d0d" : "#fee2e2", color: t.red, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Xóa</button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* Tab 5 — AI Agent */}
      {activeTab === "ai" && (() => {
        const actionLabel: Record<string, string> = {
          pause: "Tắt camp",
          activate: "Bật camp",
          set_budget: "Đổi ngân sách",
          no_action: "Không cần xử lý",
        }
        const actionColor: Record<string, string> = {
          pause: t.red,
          activate: t.green,
          set_budget: t.amber,
          no_action: t.textMuted,
        }
        const statusColor: Record<string, string> = {
          pending: t.amber,
          approved: t.green,
          rejected: t.red,
          auto_executed: t.blue,
        }
        return (
          <div>
            {/* Toolbar */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
              <select value={aiFilterStatus} onChange={e => { setAiFilterStatus(e.target.value); setAiOffset(0) }}
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
                <option value="">Tất cả trạng thái</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
                <option value="rejected">Đã từ chối</option>
                <option value="auto_executed">Tự động</option>
                <option value="superseded">Đã thay thế</option>
                <option value="expired">Hết hạn</option>
              </select>
              <select value={aiFilterMkt} onChange={e => { setAiFilterMkt(e.target.value); setAiOffset(0) }}
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
                <option value="">Tất cả MKT</option>
                {MKT_ORDER.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={fetchAiRecs} disabled={aiLoading}
                style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontSize: 13, color: t.text, opacity: aiLoading ? 0.6 : 1 }}>
                {aiLoading ? "Đang tải..." : "↻ Refresh"}
              </button>
              {isSuper && (
                <>
                  <select value={aiModel} onChange={e => setAiModel(e.target.value)}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, padding: "6px 10px", color: t.inputText, fontSize: 13, maxWidth: 240 }}>
                    <optgroup label="DeepSeek (direct API, rẻ hơn)">
                      <option value="deepseek-v4-flash">DeepSeek V4 Flash (~$0.14/1M) — nhanh</option>
                      <option value="deepseek-v4-pro">DeepSeek V4 Pro ($0.87/1M) — reasoning</option>
                    </optgroup>
                    <optgroup label="Google (mạnh)">
                      <option value="google/gemini-3.5-flash">Gemini 3.5 Flash ($1.5/$9) — mới nhất</option>
                      <option value="google/gemini-2.5-pro-preview">Gemini 2.5 Pro</option>
                      <option value="google/gemini-2.5-flash-preview">Gemini 2.5 Flash</option>
                    </optgroup>
                    <optgroup label="Anthropic">
                      <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5 (nhanh)</option>
                      <option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5</option>
                    </optgroup>
                    <optgroup label="OpenAI">
                      <option value="openai/gpt-4o-mini">GPT-4o Mini (rẻ)</option>
                      <option value="openai/gpt-4o">GPT-4o</option>
                    </optgroup>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: t.textMuted, userSelect: "none" }}>
                    <input type="checkbox" checked={aiParallel} onChange={e => setAiParallel(e.target.checked)} disabled={aiCompareMode} />
                    Song song theo MKT
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: dark ? "#c084fc" : "#7c3aed", userSelect: "none", fontWeight: 600 }}>
                    <input type="checkbox" checked={aiCompareMode} onChange={e => setAiCompareMode(e.target.checked)} />
                    🏁 Compare 3 models
                  </label>
                  <button onClick={triggerAiRun} disabled={aiTriggering}
                    style={{ background: aiCompareMode ? "#7c3aed" : "#1d4ed8", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", cursor: aiTriggering ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: aiTriggering ? 0.6 : 1 }}>
                    {aiTriggering ? "Đang chạy..." : aiCompareMode ? "🏁 Chạy Compare" : "▶ Chạy AI ngay"}
                  </button>
                  <button onClick={() => setAiShowInsights(s => !s)}
                    style={{ background: aiShowInsights ? (dark ? "#4c1d95" : "#ede9fe") : "transparent", color: dark ? "#c084fc" : "#7c3aed", border: `1px solid ${dark ? "#7c3aed" : "#c4b5fd"}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    💡 Insights ({aiInsights.length})
                  </button>
                  {isSuper && (
                    <button onClick={triggerSeedSkills} disabled={aiSeeding}
                      style={{ background: "transparent", color: dark ? "#34d399" : "#059669", border: `1px solid ${dark ? "#059669" : "#6ee7b7"}`, borderRadius: 6, padding: "6px 12px", cursor: aiSeeding ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: aiSeeding ? 0.6 : 1 }}>
                      {aiSeeding ? "Đang seed..." : "🌱 Seed Skills"}
                    </button>
                  )}
                </>
              )}
              <span style={{ color: t.textMuted, fontSize: 12 }}>{aiTotal} recommendations</span>
            </div>

            {/* Realtime heartbeat banner */}
            {aiHeartbeats.length > 0 && (
              <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {aiHeartbeats.map((hb: any) => {
                  const isActive = hb.phase !== "done" && hb.phase !== "error" && hb.stale_seconds < 120
                  const isError = hb.phase === "error"
                  const isDone = hb.phase === "done"
                  const phaseIcon = isError ? "❌" : isDone ? "✅" : hb.phase === "evaluator" ? "📊" : hb.phase === "reflection" ? "🔁" : "🔵"
                  const phaseColor = isError ? "#dc2626" : isDone ? "#16a34a" : "#3b82f6"
                  const bg = isError ? (dark ? "#3b0d0d" : "#fef2f2") : isDone ? (dark ? "#052e16" : "#f0fdf4") : (dark ? "#0c1f3a" : "#dbeafe")
                  return (
                    <div key={hb.run_id} style={{ background: bg, border: `1px solid ${phaseColor}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: dark ? "#e2e8f0" : "#1e293b", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16 }}>{phaseIcon}</span>
                      <span style={{ fontWeight: 600 }}>{hb.model}{hb.mkt ? ` · ${hb.mkt}` : ""}</span>
                      <span style={{ color: phaseColor, fontWeight: 600, textTransform: "uppercase", fontSize: 10 }}>{hb.phase}</span>
                      {!isDone && !isError && <span style={{ background: phaseColor, color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>iter {hb.iteration}/30</span>}
                      <span style={{ color: dark ? "#94a3b8" : "#64748b", flex: 1, minWidth: 200 }}>{hb.last_action}</span>
                      <span style={{ color: dark ? "#94a3b8" : "#64748b", fontSize: 11 }}>
                        {hb.recs_so_far ?? 0} recs · {hb.tokens_used ?? 0} tokens · {hb.runtime_seconds}s
                        {isActive && hb.stale_seconds > 30 && <span style={{ color: "#d97706", marginLeft: 6 }}>⏳ {hb.stale_seconds}s stale</span>}
                      </span>
                      {hb.error && <div style={{ width: "100%", color: "#dc2626", fontSize: 11, marginTop: 4 }}>Error: {hb.error}</div>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Insights panel — skills agent học được */}
            {aiShowInsights && (
              <div style={{ marginBottom: 14, background: dark ? "#1a0a2e" : "#faf5ff", border: `1px solid ${dark ? "#7c3aed" : "#c4b5fd"}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: dark ? "#c084fc" : "#7c3aed" }}>💡 AI Insights — skills học từ data ({aiInsights.length})</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {aiInsightStats.slice(0, 5).map((s: any, i: number) => (
                      <span key={i} style={{ fontSize: 11, color: dark ? "#94a3b8" : "#64748b" }}>
                        {s.category}: <b style={{ color: dark ? "#c084fc" : "#7c3aed" }}>{s.count}</b> ({s.agent_model?.split("/").pop()?.slice(0, 10)})
                      </span>
                    ))}
                  </div>
                </div>
                {aiInsights.length === 0 ? (
                  <div style={{ color: dark ? "#94a3b8" : "#64748b", fontSize: 12, textAlign: "center", padding: 20 }}>
                    Chưa có insights. Chạy agent → agent sẽ tự save_insight các pattern học được.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
                    {aiInsights.map((ins: any) => {
                      const catColor: Record<string, string> = { diagnosis: "#dc2626", opportunity: "#16a34a", pattern: "#3b82f6", warning: "#d97706" }
                      const c = catColor[ins.category] ?? "#94a3b8"
                      return (
                        <div key={ins.id} style={{ background: dark ? "#0f172a" : "#fff", border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <span style={{ background: c, color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{ins.category}</span>
                            {ins.scope?.mkt && <span style={{ fontSize: 10, color: dark ? "#94a3b8" : "#64748b" }}>{ins.scope.mkt}{ins.scope.product ? ` · ${ins.scope.product}` : ""}</span>}
                            <button onClick={() => deleteInsight(ins.id)}
                              style={{ background: "transparent", border: "none", color: dark ? "#64748b" : "#94a3b8", cursor: "pointer", fontSize: 11, marginLeft: "auto" }}>✕</button>
                          </div>
                          <div style={{ fontSize: 12, color: dark ? "#e2e8f0" : "#1e293b", lineHeight: 1.5 }}>{ins.insight}</div>
                          <div style={{ fontSize: 10, color: dark ? "#64748b" : "#94a3b8" }}>
                            {ins.agent_model?.split("/").pop()} · {new Date(ins.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {ins.applied_count > 0 && <span> · applied {ins.applied_count}x</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Run summary cards + Compare Report */}
            {aiRunSummary.length > 0 && (() => {
              // Detect compare groups: runs within 2h of each other with different models
              const sorted = [...aiRunSummary].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              const TWO_HOURS = 2 * 60 * 60 * 1000
              const latestTime = sorted[0] ? new Date(sorted[0].created_at).getTime() : 0
              const compareGroup = sorted.filter(r => latestTime - new Date(r.created_at).getTime() < TWO_HOURS && r.agent_model)
              const isCompareRun = compareGroup.length > 1 && new Set(compareGroup.map(r => r.agent_model)).size > 1
              const MODEL_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4"]
              return (
                <div style={{ marginBottom: 14 }}>
                  {/* Compare Report Table */}
                  {isCompareRun && (
                    <div style={{ background: dark ? "#0d0d1a" : "#f5f3ff", border: `1px solid ${dark ? "#4c1d95" : "#c4b5fd"}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: dark ? "#c084fc" : "#7c3aed", marginBottom: 10 }}>🏁 So sánh {compareGroup.length} models — cùng lần chạy</div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${dark ? "#4c1d95" : "#c4b5fd"}` }}>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: dark ? "#94a3b8" : "#64748b", fontWeight: 600 }}>Chỉ số</th>
                              {compareGroup.map((run: any, idx: number) => (
                                <th key={run.run_id} style={{ padding: "6px 10px", textAlign: "center", color: MODEL_COLORS[idx % MODEL_COLORS.length], fontWeight: 700 }}>
                                  {run.agent_model?.split("/").pop()?.replace("deepseek-", "DS-")?.replace("gemini-", "Gem-")?.replace("claude-", "Cl-")?.slice(0, 18) ?? run.agent_model ?? "?"}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { label: "Tổng camps phân tích", key: "total" },
                              { label: "Actionable (không phải no_action)", key: "actionable" },
                              { label: "Chờ duyệt (pending)", key: "pending" },
                              { label: "Đã duyệt", key: "approved" },
                              { label: "Đã từ chối", key: "rejected" },
                              { label: "Tự động thực thi", key: "auto_executed" },
                            ].map(({ label, key }) => {
                              const vals = compareGroup.map((r: any) => Number(r[key] ?? 0))
                              const maxVal = Math.max(...vals)
                              return (
                                <tr key={key} style={{ borderBottom: `1px solid ${dark ? "#1e1b4b" : "#ede9fe"}` }}>
                                  <td style={{ padding: "6px 10px", color: dark ? "#94a3b8" : "#64748b" }}>{label}</td>
                                  {compareGroup.map((run: any, idx: number) => {
                                    const val = Number(run[key] ?? 0)
                                    const isBest = val === maxVal && maxVal > 0
                                    return (
                                      <td key={run.run_id} style={{ padding: "6px 10px", textAlign: "center", fontWeight: isBest ? 700 : 400, color: isBest ? MODEL_COLORS[idx % MODEL_COLORS.length] : (dark ? "#e2e8f0" : "#1e293b") }}>
                                        {val}{isBest && key !== "pending" && key !== "rejected" ? " ★" : ""}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {compareGroup.map((run: any, idx: number) => (
                          <button key={run.run_id} onClick={() => { setAiFilterRunId(aiFilterRunId === run.run_id ? "" : run.run_id); setAiOffset(0) }}
                            style={{ background: aiFilterRunId === run.run_id ? MODEL_COLORS[idx % MODEL_COLORS.length] : "transparent", color: aiFilterRunId === run.run_id ? "#fff" : MODEL_COLORS[idx % MODEL_COLORS.length], border: `1px solid ${MODEL_COLORS[idx % MODEL_COLORS.length]}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                            {aiFilterRunId === run.run_id ? "✓ " : ""}Xem recs {run.agent_model?.split("/").pop()?.slice(0, 14)}
                          </button>
                        ))}
                        <button onClick={() => { setAiFilterRunId(""); setAiOffset(0) }}
                          style={{ background: "transparent", color: dark ? "#64748b" : "#94a3b8", border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11 }}>
                          Xem tất cả
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Run cards */}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {sorted.slice(0, 8).map((run: any, idx: number) => {
                      const ts = new Date(run.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      const isActive = aiFilterRunId === run.run_id
                      const inCompare = isCompareRun && compareGroup.some((r: any) => r.run_id === run.run_id)
                      const modelColor = inCompare ? MODEL_COLORS[compareGroup.findIndex((r: any) => r.run_id === run.run_id) % MODEL_COLORS.length] : (dark ? "#a78bfa" : "#7c3aed")
                      return (
                        <div key={run.run_id}
                          style={{ background: isActive ? (dark ? "#1e3a5f" : "#dbeafe") : t.card, border: `2px solid ${inCompare ? modelColor + "66" : (isActive ? t.blue : t.cardBorder)}`, borderRadius: 8, padding: "10px 16px", cursor: "pointer", minWidth: 160 }}>
                          <div style={{ fontSize: 11, color: t.textMuted }}>{ts} · <span style={{ color: modelColor, fontWeight: 600 }}>{run.agent_model?.split("/").pop()?.slice(0, 16) ?? ""}</span></div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1 }}
                              onClick={() => { setAiFilterRunId(isActive ? "" : run.run_id); setAiOffset(0) }}>
                              {run.total} camps
                            </span>
                            <button onClick={() => openAiLog(run.run_id)}
                              title="Xem AI log"
                              style={{ background: aiLogRunId === run.run_id ? (dark ? "#4c1d95" : "#ede9fe") : "transparent", border: `1px solid ${aiLogRunId === run.run_id ? "#7c3aed" : t.cardBorder}`, borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 11, color: dark ? "#a78bfa" : "#7c3aed" }}>
                              🧠
                            </button>
                          </div>
                          <div style={{ fontSize: 11, marginTop: 2 }}>
                            <span style={{ color: t.amber }}>{run.pending} chờ</span>
                            {" · "}
                            <span style={{ color: t.green }}>{run.approved} duyệt</span>
                            {" · "}
                            <span style={{ color: t.red }}>{run.rejected} từ chối</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Split view: recommendations + AI log sidebar */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {/* LEFT: Recommendations table */}
            <div style={{ flex: aiLogRunId ? "0 0 55%" : "1 1 100%", minWidth: 0, transition: "flex 0.2s" }}>
            {aiLoading ? (
              <div style={{ color: t.textMuted, textAlign: "center", padding: 40 }}>Đang tải...</div>
            ) : aiRecs.length === 0 ? (
              <div style={{ color: t.textMuted, textAlign: "center", padding: 60, fontSize: 14 }}>
                Chưa có recommendations. Bấm "Chạy AI ngay" để bắt đầu.
              </div>
            ) : (
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: t.thead }}>
                      {["Thời gian", "Campaign", "MKT", "Action đề xuất", "Lý do", "KPI cũ", "Giá trị mới", "Trạng thái", ""].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: t.theadText, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aiRecs.map((rec: any) => {
                      const ts = new Date(rec.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      const isPending = rec.status === "pending"
                      const isActing = aiApproving === rec.id
                      const oldVal = rec.old_value ? Object.entries(rec.old_value).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"
                      const newVal = rec.suggested_value ? Object.entries(rec.suggested_value).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"
                      return (
                        <tr key={rec.id}
                          onMouseEnter={e => (e.currentTarget.style.background = t.rowHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}>
                          <td style={{ padding: "8px 12px", color: t.textMuted, whiteSpace: "nowrap" }}>{ts}</td>
                          <td style={{ padding: "8px 12px", maxWidth: 220 }}>
                            <div style={{ color: t.text, fontWeight: 500 }}>{rec.campaign_name}</div>
                            <div style={{ color: t.textMuted, fontSize: 11, fontFamily: "monospace" }}>{rec.campaign_id?.slice(0, 16)}</div>
                          </td>
                          <td style={{ padding: "8px 12px", color: t.purple, fontWeight: 600 }}>{rec.mkt_name}</td>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            <span style={{ color: actionColor[rec.action] ?? t.text, fontWeight: 600 }}>
                              {actionLabel[rec.action] ?? rec.action}
                            </span>
                            {rec.confidence && (
                              <span style={{ fontSize: 10, color: t.textMuted, marginLeft: 4 }}>({rec.confidence})</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px", color: t.textSub, maxWidth: 280 }}>{rec.reason}</td>
                          <td style={{ padding: "8px 12px", color: t.textMuted, fontSize: 11 }}>{oldVal}</td>
                          <td style={{ padding: "8px 12px", color: rec.suggested_value ? t.amber : t.textMuted, fontSize: 11 }}>{newVal}</td>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            <span style={{ color: statusColor[rec.status] ?? t.textMuted, fontWeight: 600 }}>
                              {rec.status === "pending" ? "Chờ duyệt" : rec.status === "approved" ? "Đã duyệt" : rec.status === "rejected" ? "Từ chối" : rec.status === "auto_executed" ? "Tự động" : rec.status}
                            </span>
                            {rec.approved_by && (
                              <div style={{ fontSize: 11, color: t.textMuted }}>{rec.approved_by}</div>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                              {isPending && (isSuper || canControl) ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button onClick={() => approveRec(rec.id, "approved")} disabled={isActing}
                                    style={{ background: dark ? "#065f46" : "#dcfce7", color: t.green, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600, opacity: isActing ? 0.5 : 1 }}>
                                    {isActing ? "..." : "✓ Duyệt"}
                                  </button>
                                  {aiRejectNoteId === rec.id ? (
                                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                      <input value={aiRejectNote} onChange={e => setAiRejectNote(e.target.value)}
                                        placeholder="Lý do từ chối..."
                                        style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "3px 8px", color: t.inputText, fontSize: 12, width: 160 }} />
                                      <button onClick={() => approveRecWithNote(rec.id, "rejected", aiRejectNote || undefined)} disabled={isActing}
                                        style={{ background: dark ? "#3b0d0d" : "#fee2e2", color: t.red, border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>
                                        Xác nhận
                                      </button>
                                      <button onClick={() => { setAiRejectNoteId(null); setAiRejectNote("") }}
                                        style={{ background: "transparent", border: "none", color: t.textMuted, cursor: "pointer", fontSize: 12 }}>✕</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => { setAiRejectNoteId(rec.id); setAiRejectNote("") }} disabled={isActing}
                                      style={{ background: dark ? "#3b0d0d" : "#fee2e2", color: t.red, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12, opacity: isActing ? 0.5 : 1 }}>
                                      {isActing ? "..." : "✕ Từ chối"}
                                    </button>
                                  )}
                                </div>
                              ) : null}
                              {rec.run_id && (
                                <button onClick={() => openReasoning(rec)}
                                  style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: t.textMuted }}>
                                  🧠 AI nghĩ gì
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {aiTotal > AI_LIMIT && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                <button disabled={aiOffset === 0} onClick={() => setAiOffset(o => Math.max(0, o - AI_LIMIT))}
                  style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: t.text }}>
                  ← Trước
                </button>
                <span style={{ color: t.textMuted, fontSize: 13, padding: "6px 0" }}>
                  {aiOffset + 1}–{Math.min(aiOffset + AI_LIMIT, aiTotal)} / {aiTotal}
                </span>
                <button disabled={aiOffset + AI_LIMIT >= aiTotal} onClick={() => setAiOffset(o => o + AI_LIMIT)}
                  style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: t.text }}>
                  Sau →
                </button>
              </div>
            )}
            </div>{/* end left column */}

            {/* RIGHT: AI Log Sidebar */}
            {aiLogRunId && (
              <div style={{ flex: "0 0 44%", minWidth: 0, background: dark ? "#0d0d1a" : "#f8fafc", border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, borderRadius: 10, overflow: "hidden", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
                {/* Sidebar header */}
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: dark ? "#a78bfa" : "#7c3aed" }}>🧠 AI Log</span>
                    <span style={{ fontSize: 11, color: dark ? "#64748b" : "#94a3b8", marginLeft: 8 }}>{aiLogRunId.slice(0, 8)}...</span>
                  </div>
                  <button onClick={() => setAiLogRunId(null)}
                    style={{ background: "transparent", border: "none", color: dark ? "#64748b" : "#94a3b8", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
                </div>

                {/* Sub-tabs */}
                <div style={{ display: "flex", borderBottom: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, flexShrink: 0 }}>
                  {(["messages", "tools", "eval"] as const).map(tab => (
                    <button key={tab} onClick={() => setAiLogTab(tab)}
                      style={{ flex: 1, padding: "7px 4px", background: aiLogTab === tab ? (dark ? "#1a1a2e" : "#fff") : "transparent", border: "none", borderBottom: aiLogTab === tab ? `2px solid #7c3aed` : "2px solid transparent", cursor: "pointer", fontSize: 11, fontWeight: 600, color: aiLogTab === tab ? (dark ? "#a78bfa" : "#7c3aed") : dark ? "#64748b" : "#94a3b8" }}>
                      {tab === "messages" ? "💬 Messages" : tab === "tools" ? "🔧 Tool Calls" : "📊 Eval"}
                    </button>
                  ))}
                </div>

                {/* Sidebar body */}
                <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                  {aiLogLoading ? (
                    <div style={{ color: dark ? "#64748b" : "#94a3b8", textAlign: "center", padding: 40, fontSize: 13 }}>Đang tải...</div>
                  ) : aiLogTab === "messages" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {aiLogTrace.length === 0 && <div style={{ color: dark ? "#64748b" : "#94a3b8", textAlign: "center", padding: 40, fontSize: 13 }}>Không có trace. Hãy chạy agent trước.</div>}
                      {aiLogTrace.map((msg: any, i: number) => {
                        const role = msg.role
                        const bgMap: Record<string, string> = {
                          system: dark ? "#1e293b" : "#f1f5f9",
                          user: dark ? "#1e3a5f" : "#dbeafe",
                          assistant: dark ? "#052e16" : "#f0fdf4",
                          tool: dark ? "#2d1f4e" : "#faf5ff",
                        }
                        const labelColor: Record<string, string> = { system: "#94a3b8", user: "#60a5fa", assistant: "#4ade80", tool: "#c084fc" }
                        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)
                        const isHighlighted = aiLogHighlight && (
                          (typeof msg.content === "string" && msg.content.includes(aiLogHighlight)) ||
                          msg.tool_calls?.some((tc: any) => (tc.function?.arguments ?? "").includes(aiLogHighlight))
                        )
                        return (
                          <div key={i} style={{ background: isHighlighted ? (dark ? "#1c2d1a" : "#f0fdf4") : (bgMap[role] ?? bgMap.assistant), borderRadius: 6, padding: "8px 10px", border: isHighlighted ? "1px solid #16a34a" : "1px solid transparent" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: labelColor[role] ?? "#94a3b8", marginBottom: 4, letterSpacing: 1, textTransform: "uppercase" }}>{role}</div>
                            {msg.tool_calls?.map((tc: any, j: number) => (
                              <details key={j} style={{ marginBottom: 4 }}>
                                <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: dark ? "#c084fc" : "#7c3aed" }}>
                                  🔧 {tc.function?.name}()
                                </summary>
                                <pre style={{ fontSize: 10, color: dark ? "#cbd5e1" : "#475569", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "4px 0 0", background: dark ? "#0f172a" : "#f8fafc", borderRadius: 4, padding: 6 }}>
                                  {(() => { try { return JSON.stringify(JSON.parse(tc.function?.arguments ?? "{}"), null, 2) } catch { return tc.function?.arguments ?? "" } })()}
                                </pre>
                              </details>
                            ))}
                            {content && (
                              <pre style={{ fontSize: 11, color: dark ? "#e2e8f0" : "#1e293b", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, fontFamily: "inherit", lineHeight: 1.5 }}>
                                {content.length > 1500 ? content.slice(0, 1500) + "\n… [truncated]" : content}
                              </pre>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : aiLogTab === "tools" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {aiLogToolCalls.length === 0 && <div style={{ color: dark ? "#64748b" : "#94a3b8", textAlign: "center", padding: 40, fontSize: 13 }}>Không có tool calls.</div>}
                      {aiLogToolCalls.map((tc: any, i: number) => {
                        const ts = tc.ts ? new Date(tc.ts).toLocaleTimeString("vi-VN") : ""
                        const isHighlighted = aiLogHighlight && JSON.stringify(tc.args ?? {}).includes(aiLogHighlight)
                        return (
                          <div key={i} style={{ background: isHighlighted ? (dark ? "#1c2d1a" : "#f0fdf4") : (dark ? "#1a1a2e" : "#fff"), border: `1px solid ${isHighlighted ? "#16a34a" : (dark ? "#2d2d44" : "#e2e8f0")}`, borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: dark ? "#c084fc" : "#7c3aed" }}>🔧 {tc.name}</span>
                              <span style={{ fontSize: 10, color: dark ? "#64748b" : "#94a3b8" }}>{ts}</span>
                            </div>
                            <details>
                              <summary style={{ cursor: "pointer", fontSize: 10, color: dark ? "#94a3b8" : "#64748b" }}>args</summary>
                              <pre style={{ fontSize: 10, color: dark ? "#cbd5e1" : "#475569", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "4px 0 0", background: dark ? "#0f172a" : "#f8fafc", borderRadius: 4, padding: 6 }}>
                                {JSON.stringify(tc.args, null, 2)}
                              </pre>
                            </details>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    /* Eval tab */
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* Reasoning steps summary */}
                      {evalRunSummary?.steps?.length > 0 && (
                        <div style={{ background: dark ? "#1a1a2e" : "#fff", border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, borderRadius: 6, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: dark ? "#94a3b8" : "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>📊 Reasoning</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {evalRunSummary.steps.map((s: any) => (
                              <span key={s.step_type} style={{ fontSize: 11, color: dark ? "#cbd5e1" : "#475569" }}>
                                <b>{s.step_type}</b>: {s.n} ({(s.tokens || 0).toLocaleString()} tok)
                              </span>
                            ))}
                          </div>
                          {evalRunSummary.tool_stats?.length > 0 && (
                            <div style={{ marginTop: 6, fontSize: 10, color: dark ? "#94a3b8" : "#64748b" }}>
                              Top tools: {evalRunSummary.tool_stats.slice(0, 5).map((t: any) => `${t.tool_name}(${t.n})`).join(", ")}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Agreement summary */}
                      {evalRunSummary?.recs?.length > 0 && (() => {
                        const agree = evalRunSummary.recs.filter((r: any) => r.agreement === "agree").length
                        const disagree = evalRunSummary.recs.filter((r: any) => r.agreement === "disagree").length
                        const missed = evalRunSummary.recs.filter((r: any) => r.agreement === "agent_missed").length
                        const extra = evalRunSummary.recs.filter((r: any) => r.agreement === "agent_extra").length
                        const noData = evalRunSummary.recs.filter((r: any) => r.agreement === "no_marketer_action" || !r.agreement).length
                        return (
                          <div style={{ background: dark ? "#1a1a2e" : "#fff", border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: dark ? "#94a3b8" : "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>🎯 Agent vs Marketer (6h sau rec)</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ background: dark ? "#052e16" : "#f0fdf4", color: "#16a34a", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>✓ Agree: {agree}</span>
                              <span style={{ background: dark ? "#3b0d0d" : "#fef2f2", color: "#dc2626", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>✗ Disagree: {disagree}</span>
                              <span style={{ background: dark ? "#2d1f00" : "#fffbeb", color: "#d97706", borderRadius: 4, padding: "3px 8px", fontSize: 11 }}>⚠ Missed: {missed}</span>
                              <span style={{ background: dark ? "#1e3a5f" : "#eff6ff", color: "#2563eb", borderRadius: 4, padding: "3px 8px", fontSize: 11 }}>+ Extra: {extra}</span>
                              <span style={{ background: dark ? "#1e293b" : "#f8fafc", color: dark ? "#94a3b8" : "#64748b", borderRadius: 4, padding: "3px 8px", fontSize: 11 }}>– No data: {noData}</span>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Run-level tags */}
                      {evalRunSummary?.run_tags?.length > 0 && (
                        <div style={{ background: dark ? "#3b0d0d" : "#fef2f2", border: `1px solid #dc2626`, borderRadius: 6, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", marginBottom: 4 }}>🏷 Run errors</div>
                          {evalRunSummary.run_tags.map((t: any) => (
                            <div key={t.id} style={{ fontSize: 11, color: dark ? "#fca5a5" : "#7f1d1d" }}>
                              [{t.layer}/{t.category}] {t.note}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Per-rec list with agreement + tag button */}
                      {evalRunSummary?.recs?.map((r: any) => {
                        const agreeColor = r.agreement === "agree" ? "#16a34a" :
                                           r.agreement === "disagree" ? "#dc2626" :
                                           r.agreement === "agent_missed" ? "#d97706" :
                                           r.agreement === "agent_extra" ? "#2563eb" : "#94a3b8"
                        const agreeLabel = r.agreement === "agree" ? "✓ Agree" :
                                          r.agreement === "disagree" ? `✗ Disagree (marketer: ${r.marketer_action})` :
                                          r.agreement === "agent_missed" ? `⚠ Agent missed (marketer: ${r.marketer_action})` :
                                          r.agreement === "agent_extra" ? "+ Agent extra" : "– No marketer action"
                        return (
                          <div key={r.id} style={{ background: dark ? "#1a1a2e" : "#fff", border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: dark ? "#e2e8f0" : "#1e293b", marginBottom: 2 }}>{r.campaign_name}</div>
                                <div style={{ fontSize: 10, color: dark ? "#94a3b8" : "#64748b" }}>
                                  [{r.action}] · {r.confidence} · {r.status}
                                </div>
                                <div style={{ fontSize: 11, color: agreeColor, marginTop: 4, fontWeight: 600 }}>{agreeLabel}</div>
                                {r.error_tag_count > 0 && (
                                  <div style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>🏷 {r.error_tag_count} error tag(s)</div>
                                )}
                              </div>
                              <button onClick={() => setTagModalRec({ id: r.id, campaign_name: r.campaign_name })}
                                style={{ background: "transparent", border: `1px solid ${dark ? "#dc2626" : "#fca5a5"}`, color: "#dc2626", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
                                🏷 Tag error
                              </button>
                            </div>
                          </div>
                        )
                      })}

                      {/* Fallback: legacy reflection display when no eval data */}
                      {aiLogRecs.length === 0 && !evalRunSummary && <div style={{ color: dark ? "#64748b" : "#94a3b8", textAlign: "center", padding: 40, fontSize: 13 }}>Không có dữ liệu eval.</div>}

                      {/* Summary badges */}
                      {aiLogRecs.length > 0 && (() => {
                        const passed = aiLogRecs.filter((r: any) => r.reflection_passed === true).length
                        const failed = aiLogRecs.filter((r: any) => r.reflection_passed === false).length
                        const noEval = aiLogRecs.filter((r: any) => r.reflection_passed === null || r.reflection_passed === undefined).length
                        const retried = aiLogRecs.filter((r: any) => (r.validation_retries ?? 0) > 0).length
                        return (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                            <span style={{ background: dark ? "#052e16" : "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>✓ Pass: {passed}</span>
                            <span style={{ background: dark ? "#3b0d0d" : "#fef2f2", color: "#dc2626", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>✗ Fail: {failed}</span>
                            {noEval > 0 && <span style={{ background: dark ? "#1e293b" : "#f8fafc", color: dark ? "#94a3b8" : "#64748b", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>⏳ Chưa eval: {noEval}</span>}
                            {retried > 0 && <span style={{ background: dark ? "#2d1f00" : "#fffbeb", color: "#d97706", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>↩ Retry: {retried}</span>}
                          </div>
                        )
                      })()}

                      {aiLogRecs.map((r: any) => {
                        const passed = r.reflection_passed
                        const isHighlighted = aiLogHighlight === r.campaign_id
                        return (
                          <div key={r.id} style={{ background: isHighlighted ? (dark ? "#1c2d1a" : "#f0fdf4") : (dark ? "#1a1a2e" : "#fff"), border: `1px solid ${isHighlighted ? "#16a34a" : passed === true ? "#16a34a" : passed === false ? "#dc2626" : (dark ? "#2d2d44" : "#e2e8f0")}`, borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: dark ? "#e2e8f0" : "#1e293b", marginBottom: 4 }}>{r.campaign_name}</div>
                            <div style={{ fontSize: 10, color: dark ? "#94a3b8" : "#64748b", marginBottom: 4 }}>
                              [{r.action}] — confidence: {r.confidence}
                              {(r.validation_retries ?? 0) > 0 && <span style={{ color: "#d97706", marginLeft: 6 }}>↩ {r.validation_retries}x retry</span>}
                            </div>
                            <div style={{ fontSize: 11, color: passed === true ? "#16a34a" : passed === false ? "#dc2626" : dark ? "#64748b" : "#94a3b8", marginBottom: r.reflection_notes ? 4 : 0 }}>
                              {passed === true ? "✓ Evaluator PASSED" : passed === false ? "✗ Evaluator FAILED" : "⏳ Chưa evaluate"}
                            </div>
                            {r.reflection_notes && <div style={{ fontSize: 10, color: dark ? "#cbd5e1" : "#475569", fontStyle: "italic" }}>{r.reflection_notes}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>{/* end split-view flex */}
          </div>
        )
      })()}

      {/* Error Tag Modal */}
      {tagModalRec && (
        <div onClick={() => setTagModalRec(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: dark ? "#0f172a" : "#fff", borderRadius: 10, padding: 20, width: 460, maxWidth: "90vw", border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: dark ? "#e2e8f0" : "#1e293b", marginBottom: 4 }}>🏷 Tag lỗi recommendation</div>
            <div style={{ fontSize: 11, color: dark ? "#94a3b8" : "#64748b", marginBottom: 12 }}>{tagModalRec.campaign_name}</div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: dark ? "#cbd5e1" : "#475569", marginBottom: 4 }}>Tầng lỗi</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { v: "model", label: "🤖 Model" },
                  { v: "architecture", label: "🏗 Kiến trúc" },
                  { v: "code", label: "💻 Code" },
                  { v: "data", label: "📊 Data" },
                  { v: "skill", label: "🧠 Skill" },
                ].map(o => (
                  <button key={o.v} onClick={() => setTagLayer(o.v)}
                    style={{ background: tagLayer === o.v ? "#7c3aed" : "transparent", color: tagLayer === o.v ? "#fff" : (dark ? "#cbd5e1" : "#475569"), border: `1px solid ${tagLayer === o.v ? "#7c3aed" : (dark ? "#2d2d44" : "#e2e8f0")}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: dark ? "#cbd5e1" : "#475569", marginBottom: 4 }}>Category</div>
              <input type="text" value={tagCategory} onChange={e => setTagCategory(e.target.value)}
                list="error-category-list"
                placeholder="hallucination, missing_context, wrong_tool, bad_logic..."
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, background: dark ? "#1a1a2e" : "#fff", color: dark ? "#e2e8f0" : "#1e293b", fontSize: 12 }} />
              <datalist id="error-category-list">
                <option value="hallucination" />
                <option value="missing_context" />
                <option value="wrong_tool" />
                <option value="bad_logic" />
                <option value="ignored_skill" />
                <option value="wrong_threshold" />
                <option value="data_outdated" />
                <option value="bug" />
              </datalist>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: dark ? "#cbd5e1" : "#475569", marginBottom: 4 }}>Mức độ</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["low", "medium", "high", "critical"].map(s => (
                  <button key={s} onClick={() => setTagSeverity(s)}
                    style={{ background: tagSeverity === s ? "#dc2626" : "transparent", color: tagSeverity === s ? "#fff" : (dark ? "#cbd5e1" : "#475569"), border: `1px solid ${tagSeverity === s ? "#dc2626" : (dark ? "#2d2d44" : "#e2e8f0")}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: dark ? "#cbd5e1" : "#475569", marginBottom: 4 }}>Ghi chú</div>
              <textarea value={tagNote} onChange={e => setTagNote(e.target.value)} rows={3}
                placeholder="Mô tả cụ thể agent sai gì..."
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, background: dark ? "#1a1a2e" : "#fff", color: dark ? "#e2e8f0" : "#1e293b", fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setTagModalRec(null)}
                style={{ background: "transparent", border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, color: dark ? "#cbd5e1" : "#475569", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
                Hủy
              </button>
              <button onClick={submitErrorTag}
                style={{ background: "#dc2626", border: "none", color: "#fff", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                🏷 Lưu tag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB RULES ===== */}
      {activeTab === "rules" && (() => {
        const R_METRICS = [
          { value: "spend",            label: "Spend",         unit: "đ"   },
          { value: "cpr_real",         label: "CPR thực",      unit: "đ"   },
          { value: "orders_real",      label: "Số đơn thực",   unit: "đơn" },
          { value: "orders_delivered", label: "Đơn giao thành công", unit: "đơn" },
          { value: "cpm",              label: "CPM",           unit: "đ"   },
          { value: "ctr",              label: "CTR",           unit: "%"   },
        ]
        const R_ACTIONS = [
          { value: "pause",          icon: "⏸", label: "Tắt camp",          tone: "#ef4444" },
          { value: "activate",       icon: "▶️", label: "Bật camp",          tone: "#22c55e" },
          { value: "set_budget_pct", icon: "📉", label: "Budget ±%",         tone: "#3b82f6" },
          { value: "set_budget_abs", icon: "💰", label: "Budget cố định",    tone: "#3b82f6" },
          { value: "notify",         icon: "🔔", label: "Chỉ thông báo",     tone: "#f59e0b" },
        ]
        const emptyForm = {
          name: "", rule_mode: "manual", scope_type: "all", scope_value: "",
          conditions: [{ metric: "cpr_real", op: ">", value: 300000 }],
          condition_logic: "AND", product_key: "", time_window: "today",
          action: "pause", action_payload: {}, check_schedule: "hourly",
          min_spend: 200000, cooldown_hours: 12,
        }

        const saveRule = async () => {
          if (!ruleForm?.name?.trim()) return alert("Cần nhập tên rule")
          setRuleSaving(true)
          try {
            const isEdit = !!ruleForm.id
            const url = isEdit ? `/admin/pancake-sync/report/care-rules/${ruleForm.id}` : "/admin/pancake-sync/report/care-rules"
            const method = isEdit ? "PATCH" : "POST"
            await apiFetch(url, { method, body: JSON.stringify(ruleForm) })
            const r = await apiFetch("/admin/pancake-sync/report/care-rules").then(res => res.json())
            setRules(r.rules ?? [])
            setRuleForm(null); setRulePreview(null)
          } catch (e: any) { alert(e.message) }
          finally { setRuleSaving(false) }
        }
        const toggleRule = async (rule: any) => {
          await apiFetch(`/admin/pancake-sync/report/care-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }).catch(() => {})
          setRules((prev: any[]) => prev.map((r: any) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
        }
        const deleteRule = async (id: string) => {
          if (!confirm("Xóa rule này?")) return
          await apiFetch(`/admin/pancake-sync/report/care-rules/${id}`, { method: "DELETE" }).catch(() => {})
          setRules((prev: any[]) => prev.filter((r: any) => r.id !== id))
        }
        const previewRule = async () => {
          if (!ruleForm) return
          setRulePreviewLoading(true)
          try {
            const r = await apiFetch("/admin/pancake-sync/report/care-rules/preview", { method: "POST", body: JSON.stringify(ruleForm) }).then(res => res.json())
            setRulePreview(r.affected_camps ?? [])
          } catch { setRulePreview([]) }
          finally { setRulePreviewLoading(false) }
        }
        const loadRuleLogs = async (ruleId: string) => {
          if (ruleLogsOpen === ruleId) { setRuleLogsOpen(null); return }
          const r = await apiFetch(`/admin/pancake-sync/report/care-rules/${ruleId}/logs?limit=20`).then(res => res.json()).catch(() => ({ logs: [] }))
          setRuleLogs((prev: any) => ({ ...prev, [ruleId]: r.logs ?? [] }))
          setRuleLogsOpen(ruleId)
        }
        const logLabel: Record<string, string> = {
          pause: "⏸ Tắt", activate: "▶ Bật", set_budget: "💰 Budget", notify: "🔔 Notify",
          not_matched: "— Không khớp", below_min_spend: "⏭ Min spend",
          skipped_cooldown: "⏭ Cooldown", blocked_permission: "🚫 Blocked",
        }

        const activeCount = rules.filter((r: any) => r.enabled).length
        const todayTriggers = rules.reduce((s: number, r: any) => s + (r.trigger_count_today ?? 0), 0)
        const pausedCamps = rules.reduce((s: number, r: any) => s + (r.paused_camps_today ?? 0), 0)

        // shared style helpers
        const card = { background: t.card, border: `1px solid ${dark ? "#2d2d44" : "#e2e8f0"}`, borderRadius: 12 }
        const inputSt = { width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${dark ? "#374151" : "#cbd5e1"}`, background: dark ? "#111827" : "#fff", color: t.text, fontSize: 13, outline: "none" }
        const selSt = { ...inputSt }

        const scopeLabel = (rule: any) => {
          if (rule.scope_type === "all") return "🌐 Tất cả camp"
          if (rule.scope_type === "product") return `📦 SP: ${rule.scope_value}`
          return `🔤 Camp chứa "${rule.scope_value}"`
        }
        const actionInfo = (v: string) => R_ACTIONS.find(a => a.value === v) ?? { icon: "⚡", label: v, tone: t.blue }
        const metricLabel = (v: string) => R_METRICS.find(m => m.value === v)?.label ?? v

        const RULE_TEMPLATES = [
          {
            group: "🛑 Cắt lỗ", id: "T1", icon: "🛑",
            name: "Tắt camp đốt tiền không ra đơn",
            desc: "Spend > 400k trong 2 ngày nhưng 0 đơn thực → Tắt camp",
            form: { name: "T1 — Tắt camp đốt tiền 0 đơn", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "spend", op: ">", value: 400000 }, { metric: "orders_real", op: "<=", value: 0 }], condition_logic: "AND", product_key: "", time_window: "2d", action: "pause", action_payload: {}, check_schedule: "every_4h", min_spend: 400000, cooldown_hours: 24 },
          },
          {
            group: "🛑 Cắt lỗ", id: "T2", icon: "🛑",
            name: "Tắt camp CPR quá cao",
            desc: "CPR thực > 300k AND spend > 500k (hôm nay) → Tắt camp",
            form: { name: "T2 — Tắt camp CPR cao", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "cpr_real", op: ">", value: 300000 }, { metric: "spend", op: ">", value: 500000 }], condition_logic: "AND", product_key: "", time_window: "today", action: "pause", action_payload: {}, check_schedule: "every_4h", min_spend: 300000, cooldown_hours: 12 },
          },
          {
            group: "🛑 Cắt lỗ", id: "T3", icon: "📉",
            name: "Giảm budget camp chậm",
            desc: "CPR thực > 250k AND đơn thực < 3 (hôm nay) → Giảm budget -30%",
            form: { name: "T3 — Giảm budget camp CPR cao", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "cpr_real", op: ">", value: 250000 }, { metric: "orders_real", op: "<", value: 3 }], condition_logic: "AND", product_key: "", time_window: "today", action: "set_budget_pct", action_payload: { pct: -30 }, check_schedule: "every_4h", min_spend: 200000, cooldown_hours: 12 },
          },
          {
            group: "📈 Scale", id: "T4", icon: "📈",
            name: "Tăng budget camp ngon",
            desc: "CPR thực < 150k AND đơn thực > 5 (2 ngày) → Tăng budget +20%",
            form: { name: "T4 — Tăng budget camp ngon", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "cpr_real", op: "<", value: 150000 }, { metric: "orders_real", op: ">", value: 5 }], condition_logic: "AND", product_key: "", time_window: "2d", action: "set_budget_pct", action_payload: { pct: 20 }, check_schedule: "every_4h", min_spend: 200000, cooldown_hours: 24 },
          },
          {
            group: "📈 Scale", id: "T5", icon: "🔔",
            name: "Báo camp ngon để scale tay",
            desc: "CPR thực < 120k AND đơn thực > 5 (hôm nay) → Thông báo Telegram",
            form: { name: "T5 — Báo camp ngon (scale tay)", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "cpr_real", op: "<", value: 120000 }, { metric: "orders_real", op: ">", value: 5 }], condition_logic: "AND", product_key: "", time_window: "today", action: "notify", action_payload: {}, check_schedule: "every_4h", min_spend: 100000, cooldown_hours: 8 },
          },
          {
            group: "🎬 Creative", id: "T7", icon: "🎬",
            name: "Tắt video CTR thấp",
            desc: "CTR < 1% AND spend > 200k (hôm nay) → Tắt camp (video không hút)",
            form: { name: "T7 — Tắt video CTR thấp", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "ctr", op: "<", value: 1 }, { metric: "spend", op: ">", value: 200000 }], condition_logic: "AND", product_key: "", time_window: "today", action: "pause", action_payload: {}, check_schedule: "every_4h", min_spend: 200000, cooldown_hours: 12 },
          },
          {
            group: "🎬 Creative", id: "T8", icon: "🔔",
            name: "Báo CPM tăng bất thường",
            desc: "CPM > 500k (hôm nay) → Thông báo Telegram (audience bão hòa)",
            form: { name: "T8 — Báo CPM tăng bất thường", rule_mode: "manual", scope_type: "all", scope_value: "", conditions: [{ metric: "cpm", op: ">", value: 500000 }], condition_logic: "AND", product_key: "", time_window: "today", action: "notify", action_payload: {}, check_schedule: "hourly", min_spend: 100000, cooldown_hours: 6 },
          },
        ]

        return (
          <div style={{ paddingBottom: 60 }}>

            {/* ── Header row ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: t.text }}>⚙️ Rule chăm sóc camp tự động</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>Tự động hóa quản lý camp dựa trên đơn thực Pancake POS</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Template dropdown */}
                <div style={{ position: "relative" }}>
                  <button onClick={() => setRuleTemplateOpen(o => !o)}
                    style={{ background: dark ? "#1e293b" : "#f1f5f9", color: t.text, border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 9, padding: "10px 16px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    📋 Dùng template {ruleTemplateOpen ? "▲" : "▼"}
                  </button>
                  {ruleTemplateOpen && (
                    <>
                    <div onClick={() => setRuleTemplateOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
                    <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 340, background: dark ? "#1a1a2e" : "#fff", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 12, boxShadow: "0 16px 40px rgba(0,0,0,0.35)", zIndex: 60, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px 6px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: t.textMuted }}>Chọn template để tự điền form</div>
                      {(["🛑 Cắt lỗ", "📈 Scale", "🎬 Creative"] as const).map(group => (
                        <div key={group}>
                          <div style={{ padding: "6px 14px 4px", fontSize: 10.5, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", borderTop: `1px solid ${dark ? "#1f2937" : "#f1f5f9"}` }}>{group}</div>
                          {RULE_TEMPLATES.filter(tp => tp.group === group).map(tp => (
                            <button key={tp.id} onClick={() => { setRuleForm({ ...tp.form }); setRulePreview(null); setRuleTemplateOpen(false) }}
                              style={{ display: "flex", alignItems: "flex-start", gap: 10, width: "100%", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", transition: "background .12s" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = dark ? "#111827" : "#f8fafc" }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none" }}>
                              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{tp.icon}</span>
                              <div>
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>{tp.id} — {tp.name}</div>
                                <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>{tp.desc}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ))}
                      <div style={{ padding: "10px 14px", borderTop: `1px solid ${dark ? "#1f2937" : "#f1f5f9"}`, fontSize: 11, color: t.textMuted }}>
                        💡 Sau khi chọn, điều chỉnh phạm vi (tất cả camp / camp cụ thể) rồi bấm <b style={{ color: t.text }}>Lưu &amp; Bật</b>
                      </div>
                    </div>
                    </>
                  )}
                </div>
                <button onClick={() => { setRuleForm({ ...emptyForm }); setRulePreview(null) }}
                  style={{ background: t.blue, color: "#fff", border: "none", borderRadius: 9, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 4px 14px rgba(59,130,246,0.35)" }}>
                  + Tạo mới
                </button>
              </div>
            </div>

            {/* ── Hướng dẫn collapsible ── */}
            <div style={{ marginBottom: 16 }}>
              <button onClick={() => setRuleHowOpen(o => !o)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: dark ? "rgba(59,130,246,0.08)" : "#eff6ff", border: `1px solid ${dark ? "rgba(59,130,246,0.25)" : "#bfdbfe"}`, borderRadius: ruleHowOpen ? "12px 12px 0 0" : 12, padding: "11px 16px", cursor: "pointer" }}>
                <span style={{ fontSize: 15 }}>💡</span>
                <span style={{ fontWeight: 600, fontSize: 13, color: dark ? "#93c5fd" : "#1d4ed8" }}>Rule chăm sóc hoạt động như thế nào?</span>
                <span style={{ marginLeft: "auto", color: dark ? "#60a5fa" : "#3b82f6", fontSize: 12 }}>{ruleHowOpen ? "Thu gọn ▲" : "Xem hướng dẫn ▼"}</span>
              </button>
              {ruleHowOpen && (
                <div style={{ background: dark ? "rgba(59,130,246,0.05)" : "#f0f7ff", border: `1px solid ${dark ? "rgba(59,130,246,0.2)" : "#bfdbfe"}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: "16px 20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
                    {[
                      { step: "1", icon: "🎯", title: "Chọn phạm vi", body: "Rule áp dụng cho tất cả camp của bạn, hoặc chỉ camp chứa tên SP cụ thể (VD: \"CHẢO VÀNG HẤP\"), hoặc camp chứa từ khoá bất kỳ." },
                      { step: "2", icon: "📊", title: "Đặt điều kiện", body: "Dạng A: Bạn tự chọn ngưỡng (CPR thực, Spend, Đơn thực, CPM, CTR). Dạng B: Hệ thống tự tính theo CPR mục tiêu sản phẩm trong Pancake." },
                      { step: "3", icon: "⚡", title: "Chọn hành động", body: "Tắt camp / Bật camp / Giảm-tăng budget % / Đặt budget cố định / Chỉ gửi Telegram để bạn quyết định tay." },
                      { step: "4", icon: "⏱️", title: "Tần suất & Guard", body: "Chọn kiểm tra hằng giờ, mỗi 4h, hoặc sáng 7h. Guard: bỏ qua camp chưa đủ spend, cooldown tránh trigger liên tục." },
                    ].map(s => (
                      <div key={s.step} style={{ display: "flex", gap: 12 }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: t.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0, marginTop: 1 }}>{s.step}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: t.text, marginBottom: 4 }}>{s.icon} {s.title}</div>
                          <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>{s.body}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: dark ? "rgba(245,158,11,0.1)" : "#fffbeb", border: `1px solid ${dark ? "rgba(245,158,11,0.25)" : "#fde68a"}`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: dark ? "#fcd34d" : "#92400e", display: "flex", gap: 8 }}>
                    <span>⚠️</span>
                    <span><b>Lưu ý quan trọng:</b> Dùng nút <b>🔍 Xem thử</b> trước khi bật rule thật — hệ thống sẽ hiện danh sách camp nào sẽ bị ảnh hưởng ngay lúc đó. Rule chỉ áp dụng cho camp của chính bạn (theo MKT code đăng nhập).</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Stat cards ── */}
            <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
              {[
                { v: rules.length,  k: "Tổng số rule",          color: t.text },
                { v: activeCount,   k: "Đang chạy",             color: t.green },
                { v: todayTriggers, k: "Lượt kích hoạt hôm nay", color: t.text },
                { v: pausedCamps,   k: "Camp đã tắt tự động",   color: "#f87171" },
              ].map(({ v, k, color }) => (
                <div key={k} style={{ ...card, padding: "13px 18px", flex: "1 1 120px", minWidth: 120 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "ui-monospace,monospace", color, letterSpacing: "-0.02em" }}>{v}</div>
                  <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>{k}</div>
                </div>
              ))}
            </div>

            {/* ── Template showcase (hiện khi chưa có rule) ── */}
            {!rulesLoading && rules.length === 0 && !ruleForm && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>📋 Gợi ý — bắt đầu từ template phổ biến</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {RULE_TEMPLATES.map(tp => (
                    <button key={tp.id} onClick={() => { setRuleForm({ ...tp.form }); setRulePreview(null) }}
                      style={{ ...card, padding: "13px 15px", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12, transition: "border-color .15s, background .15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = t.blue; (e.currentTarget as HTMLElement).style.background = dark ? "#1a2744" : "#eff6ff" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = dark ? "#2d2d44" : "#e2e8f0"; (e.currentTarget as HTMLElement).style.background = t.card }}>
                      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{tp.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: dark ? "#2a3a52" : "#f1f5f9", color: t.textMuted }}>{tp.id}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>{tp.name}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.45 }}>{tp.desc}</div>
                        <div style={{ marginTop: 7, fontSize: 11, color: t.blue, fontWeight: 600 }}>Dùng template này →</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Rule cards ── */}
            {rulesLoading && <div style={{ color: t.textMuted, padding: 20 }}>Đang tải...</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rules.map((rule: any) => {
                const ai = actionInfo(rule.action)
                const isB = rule.rule_mode === "smart_product"
                return (
                  <div key={rule.id} style={{
                    ...card, padding: "16px 18px",
                    opacity: rule.enabled ? 1 : 0.72,
                    transition: "border-color .15s",
                  }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px 18px", alignItems: "center" }}>
                      {/* left */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{rule.name}</span>
                          {/* mode badge */}
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, border: "1px solid",
                            ...(isB
                              ? { background: "rgba(168,85,247,0.15)", color: "#d8b4fe", borderColor: "rgba(168,85,247,0.3)" }
                              : { background: dark ? "#2a3a52" : "#f1f5f9", color: dark ? "#cdd9ec" : "#475569", borderColor: dark ? "#3a4a63" : "#cbd5e1" })
                          }}>
                            {isB ? "🧠 Dạng B · Smart" : "⚡ Dạng A · Thủ công"}
                          </span>
                        </div>
                        {/* meta chips */}
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                          {/* scope chip */}
                          <span style={{ fontSize: 12, padding: "4px 9px", borderRadius: 7, background: dark ? "#233044" : "#f1f5f9", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, color: t.textSub }}>
                            {scopeLabel(rule)}
                          </span>
                          <span style={{ color: t.textMuted, fontSize: 12 }}>→</span>
                          {/* action chip */}
                          <span style={{ fontSize: 12, padding: "4px 9px", borderRadius: 7, background: ai.tone + "20", border: `1px solid ${ai.tone}38`, color: ai.tone }}>
                            {ai.icon} {ai.label}
                          </span>
                          {/* conditions inline */}
                          {!isB && (rule.conditions ?? []).length > 0 && (
                            <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, color: t.textMuted }}>
                              {(rule.conditions as any[]).map((c: any, i: number) => (
                                <span key={i}>
                                  {i > 0 && <span style={{ color: t.blue, fontWeight: 700, margin: "0 4px" }}>{rule.condition_logic}</span>}
                                  <b style={{ color: t.textSub }}>{metricLabel(c.metric)}</b>{" "}{c.op}{" "}
                                  <b style={{ color: t.textSub }}>{["spend","cpr_real","cpm"].includes(c.metric) ? `${Math.round(Number(c.value)/1000)}k` : c.value}{c.metric === "ctr" ? "%" : ""}</b>
                                </span>
                              ))}
                            </span>
                          )}
                          {isB && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, color: t.textMuted }}>Theo <b>Learning</b> + ngưỡng CPR mục tiêu SP</span>}
                        </div>
                      </div>

                      {/* right */}
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        {/* last triggered */}
                        <div style={{ textAlign: "right", minWidth: 80 }}>
                          <div style={{ fontSize: 12, color: t.text, fontWeight: 600, fontFamily: "ui-monospace,monospace" }}>
                            {rule.last_triggered_at ? new Date(rule.last_triggered_at).toLocaleString("vi-VN", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—"}
                          </div>
                          <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 1 }}>
                            {(rule.trigger_count ?? 0) > 0 ? `Đã chạy ${rule.trigger_count} lần` : "Chưa kích hoạt"}
                          </div>
                        </div>
                        {/* divider */}
                        <div style={{ width: 1, height: 26, background: dark ? "#2d3748" : "#e2e8f0" }} />
                        {/* toggle */}
                        <div onClick={() => toggleRule(rule)} style={{ width: 40, height: 23, borderRadius: 999, background: rule.enabled ? "#22c55e" : (dark ? "#36465f" : "#cbd5e1"), position: "relative", cursor: "pointer", transition: "background .18s", flexShrink: 0 }}>
                          <div style={{ position: "absolute", top: 2.5, left: rule.enabled ? "auto" : 2.5, right: rule.enabled ? 2.5 : "auto", width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.4)", transition: "all .18s" }} />
                        </div>
                        {/* divider */}
                        <div style={{ width: 1, height: 26, background: dark ? "#2d3748" : "#e2e8f0" }} />
                        {/* icon buttons */}
                        <div style={{ display: "flex", gap: 3 }}>
                          {[
                            { title: "Xem logs", ico: "📊", action: () => loadRuleLogs(rule.id) },
                            { title: "Sửa rule", ico: "✏️", action: () => { setRuleForm({ ...rule }); setRulePreview(null) } },
                            { title: "Xóa rule", ico: "🗑️", action: () => deleteRule(rule.id), danger: true },
                          ].map(btn => (
                            <button key={btn.ico} onClick={btn.action} title={btn.title} style={{
                              width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center",
                              background: "transparent", border: `1px solid ${btn.danger ? "transparent" : "transparent"}`,
                              cursor: "pointer", fontSize: 14, color: btn.danger ? "#f87171" : t.textMuted,
                              transition: "background .14s",
                            }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = dark ? "#1f2937" : "#f1f5f9" }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                            >{btn.ico}</button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* logs panel */}
                    {ruleLogsOpen === rule.id && (
                      <div style={{ marginTop: 12, borderTop: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, paddingTop: 12 }}>
                        {!(ruleLogs[rule.id]?.length) && <div style={{ color: t.textMuted, fontSize: 12 }}>Chưa có log nào</div>}
                        {(ruleLogs[rule.id] ?? []).map((l: any) => (
                          <div key={l.id} style={{ display: "flex", gap: 10, fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${dark ? "#1f2937" : "#f1f5f9"}`, alignItems: "center" }}>
                            <span style={{ minWidth: 110, color: t.textMuted, fontFamily: "ui-monospace,monospace", fontSize: 11 }}>{new Date(l.created_at).toLocaleString("vi-VN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" })}</span>
                            <span style={{ minWidth: 90, color: t.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.campaign_name?.slice(0, 22)}</span>
                            <span style={{ color: l.matched ? t.green : t.textMuted, fontWeight: 600 }}>{logLabel[l.action_taken] ?? l.action_taken}</span>
                            {l.metrics_snapshot?.cpr_real && <span style={{ color: t.textMuted }}>CPR: <b style={{ color: "#fcd34d" }}>{Math.round(l.metrics_snapshot.cpr_real/1000)}k</b></span>}
                            {l.metrics_snapshot?.spend && <span style={{ color: t.textMuted }}>Spend: {Math.round(l.metrics_snapshot.spend/1000)}k</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ── Drawer overlay ── */}
            {ruleForm !== null && (
              <>
                <div onClick={() => { setRuleForm(null); setRulePreview(null) }}
                  style={{ position: "fixed", inset: 0, background: "rgba(7,12,22,0.55)", backdropFilter: "blur(2px)", zIndex: 40 }} />
                <div style={{
                  position: "fixed", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "94vw",
                  background: dark ? "#0f172a" : "#fff", borderLeft: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`,
                  boxShadow: "-24px 0 60px rgba(0,0,0,0.45)", zIndex: 50,
                  display: "flex", flexDirection: "column",
                }}>
                  {/* drawer head */}
                  <div style={{ padding: "18px 22px", borderBottom: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, display: "flex", alignItems: "center", gap: 12, background: dark ? "linear-gradient(180deg,#16213a,#0f172a)" : "#fafafa", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17, color: t.text }}>{ruleForm.id ? "✏️ Sửa rule" : "➕ Tạo rule mới"}</div>
                    <button onClick={() => { setRuleForm(null); setRulePreview(null) }}
                      style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: t.textMuted, fontSize: 20, lineHeight: 1, borderRadius: 6, padding: "2px 6px" }}>✕</button>
                  </div>

                  {/* drawer body */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "4px 22px 24px" }}>

                    {/* Rule name */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Tên rule <span style={{ color: t.blue }}>*</span></div>
                      <input value={ruleForm.name ?? ""} onChange={e => setRuleForm((f: any) => ({ ...f, name: e.target.value }))}
                        placeholder="VD: Tắt chảo vàng CPR cao" style={inputSt} />
                    </div>

                    {/* Mode cards */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Chế độ rule</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          { id: "manual",        icon: "⚡", tag: "Dạng A · Tự đặt ngưỡng",      sub: "Bạn tự thiết lập điều kiện kích hoạt. Kiểm soát hoàn toàn." },
                          { id: "smart_product", icon: "🧠", tag: "Dạng B · Smart (Learning)",    sub: "Hệ thống tự tính theo learning curve + CPR mục tiêu SP." },
                        ].map(m => {
                          const sel = (ruleForm.rule_mode ?? "manual") === m.id
                          return (
                            <button key={m.id} onClick={() => setRuleForm((f: any) => ({ ...f, rule_mode: m.id }))}
                              style={{ textAlign: "left", background: sel ? (dark ? "rgba(59,130,246,0.14)" : "#eff6ff") : (dark ? "#1e293b" : "#f8fafc"), border: `1.5px solid ${sel ? t.blue : (dark ? "#2d3748" : "#e2e8f0")}`, borderRadius: 12, padding: 14, cursor: "pointer", position: "relative", transition: "border-color .15s" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, display: "flex", alignItems: "center", gap: 7 }}><span style={{ fontSize: 16 }}>{m.icon}</span>{m.tag}</div>
                              <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6, lineHeight: 1.4 }}>{m.sub}</div>
                              <div style={{ position: "absolute", top: 12, right: 12, width: 18, height: 18, borderRadius: "50%", background: sel ? t.blue : "transparent", border: `1.5px solid ${sel ? t.blue : (dark ? "#3a4a63" : "#cbd5e1")}`, display: "grid", placeItems: "center", fontSize: 11, color: "#fff" }}>{sel ? "✓" : ""}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Scope */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Phạm vi áp dụng</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { id: "all",                label: "🌐 Tất cả camp",       sub: "Áp dụng cho mọi camp đang chạy" },
                          { id: "product",            label: "📦 Camp chứa tên SP",  sub: "Lọc theo từ khoá tên sản phẩm trong tên camp" },
                          { id: "campaign_name_like", label: "🔤 Camp chứa chữ",     sub: "Lọc camp theo từ khoá bất kỳ" },
                        ].map(s => {
                          const sel = (ruleForm.scope_type ?? "all") === s.id
                          return (
                            <button key={s.id} onClick={() => setRuleForm((f: any) => ({ ...f, scope_type: s.id }))}
                              style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", background: sel ? (dark ? "rgba(59,130,246,0.14)" : "#eff6ff") : (dark ? "#1e293b" : "#f8fafc"), border: `1px solid ${sel ? t.blue : (dark ? "#2d3748" : "#e2e8f0")}`, borderRadius: 9, cursor: "pointer", textAlign: "left", transition: "border-color .14s" }}>
                              <div style={{ width: 17, height: 17, borderRadius: "50%", border: `1.5px solid ${sel ? t.blue : (dark ? "#3a4a63" : "#cbd5e1")}`, flexShrink: 0, display: "grid", placeItems: "center" }}>
                                {sel && <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.blue }} />}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{s.label}</div>
                                <div style={{ fontSize: 11.5, color: t.textMuted }}>{s.sub}</div>
                              </div>
                              {sel && s.id !== "all" && (
                                <input value={ruleForm.scope_value ?? ""} onClick={e => e.stopPropagation()}
                                  onChange={e => setRuleForm((f: any) => ({ ...f, scope_value: e.target.value }))}
                                  placeholder={s.id === "product" ? "VD: CHẢO VÀNG HẤP" : "VD: NỒI CHIÊN"}
                                  style={{ ...inputSt, width: 190, fontSize: 12 }} />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Conditions — Dạng A */}
                    {(ruleForm.rule_mode ?? "manual") === "manual" && (
                      <div style={{ marginTop: 20 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Điều kiện kích hoạt</div>
                        <div style={{ background: dark ? "#1e293b" : "#f8fafc", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 12, padding: 13 }}>
                          {(ruleForm.conditions ?? []).map((cond: any, i: number) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 64px 1fr 32px", gap: 7, alignItems: "center", marginBottom: 8 }}>
                              <select value={cond.metric} onChange={e => setRuleForm((f: any) => ({ ...f, conditions: f.conditions.map((c: any, j: number) => j===i?{...c,metric:e.target.value}:c) }))} style={{ ...selSt, padding: "8px 10px", fontSize: 12.5 }}>
                                {R_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                              <select value={cond.op} onChange={e => setRuleForm((f: any) => ({ ...f, conditions: f.conditions.map((c: any, j: number) => j===i?{...c,op:e.target.value}:c) }))} style={{ ...selSt, padding: "8px 6px", fontSize: 12.5, textAlign: "center" }}>
                                {[">",">=","<","<=","=="].map(op => <option key={op} value={op}>{op}</option>)}
                              </select>
                              <div style={{ position: "relative" }}>
                                <input type="number" value={cond.value} onChange={e => setRuleForm((f: any) => ({ ...f, conditions: f.conditions.map((c: any, j: number) => j===i?{...c,value:Number(e.target.value)}:c) }))} style={{ ...inputSt, padding: "8px 10px", fontSize: 12.5 }} />
                                {["spend","cpr_real","cpm"].includes(cond.metric) && (
                                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: t.textMuted, pointerEvents: "none" }}>đ</span>
                                )}
                              </div>
                              <button onClick={() => setRuleForm((f: any) => ({ ...f, conditions: f.conditions.filter((_: any, j: number) => j!==i) }))}
                                disabled={(ruleForm.conditions?.length ?? 0) <= 1}
                                style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, background: dark ? "#233044" : "#f1f5f9", color: "#f87171", cursor: "pointer", display: "grid", placeItems: "center", opacity: (ruleForm.conditions?.length ?? 0) <= 1 ? 0.3 : 1 }}>×</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                            <button onClick={() => setRuleForm((f: any) => ({ ...f, conditions: [...(f.conditions??[]), { metric: "spend", op: ">", value: 200000 }] }))}
                              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1px dashed ${dark ? "#3a4a63" : "#94a3b8"}`, color: t.blue, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              + Thêm điều kiện
                            </button>
                            {(ruleForm.conditions?.length ?? 0) > 1 && (
                              <div style={{ display: "inline-flex", background: dark ? "#233044" : "#f1f5f9", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 7, padding: 2 }}>
                                {["AND","OR"].map(logic => (
                                  <button key={logic} onClick={() => setRuleForm((f: any) => ({ ...f, condition_logic: logic }))}
                                    style={{ border: "none", background: ruleForm.condition_logic === logic ? t.blue : "transparent", color: ruleForm.condition_logic === logic ? "#fff" : t.textMuted, padding: "4px 11px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                    {logic}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Product selector — Dạng B */}
                    {(ruleForm.rule_mode ?? "manual") === "smart_product" && (
                      <div style={{ marginTop: 20 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Sản phẩm theo dõi</div>
                        <select value={ruleForm.product_key ?? ""} onChange={e => setRuleForm((f: any) => ({ ...f, product_key: e.target.value }))} style={selSt}>
                          <option value="">-- Chọn sản phẩm --</option>
                          {thresholds.map((th: any) => <option key={th.product_key} value={th.product_key}>{th.product_label} — CPR mục tiêu: {Math.round(th.target_cpr/1000)}k</option>)}
                        </select>
                        {ruleForm.product_key && (() => {
                          const th = thresholds.find((x: any) => x.product_key === ruleForm.product_key)
                          return th ? (
                            <div style={{ marginTop: 10, background: dark ? "#1e293b" : "#f8fafc", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 9, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{ fontSize: 24 }}>📦</span>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13.5, color: t.text }}>{th.product_label}</div>
                                <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>CPR mục tiêu: <b style={{ color: "#86efac", fontFamily: "ui-monospace,monospace" }}>{Math.round(th.target_cpr/1000)}k</b> · Nguồn: Pancake POS</div>
                              </div>
                            </div>
                          ) : null
                        })()}
                      </div>
                    )}

                    {/* Action grid */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Hành động khi điều kiện thỏa</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {R_ACTIONS.map(a => {
                          const sel = (ruleForm.action ?? "pause") === a.value
                          return (
                            <button key={a.value} onClick={() => setRuleForm((f: any) => ({ ...f, action: a.value }))}
                              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, background: sel ? (dark ? "rgba(59,130,246,0.14)" : "#eff6ff") : (dark ? "#1e293b" : "#f8fafc"), border: `1.5px solid ${sel ? t.blue : (dark ? "#2d3748" : "#e2e8f0")}`, borderRadius: 10, padding: "11px 12px", cursor: "pointer", transition: "border-color .14s, background .14s" }}>
                              <span style={{ fontSize: 17 }}>{a.icon}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{a.label}</span>
                            </button>
                          )
                        })}
                      </div>
                      {(ruleForm.action === "set_budget_pct" || ruleForm.action === "set_budget_abs") && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>{ruleForm.action === "set_budget_pct" ? "Thay đổi % (âm = giảm, VD: -30)" : "Budget mới (đ)"}</div>
                          <input type="number" value={ruleForm.action === "set_budget_pct" ? (ruleForm.action_payload?.pct ?? -30) : (ruleForm.action_payload?.daily_budget ?? 300000)}
                            onChange={e => setRuleForm((f: any) => ({ ...f, action_payload: f.action === "set_budget_pct" ? { pct: Number(e.target.value) } : { daily_budget: Number(e.target.value) } }))}
                            style={inputSt} />
                        </div>
                      )}
                    </div>

                    {/* Time window */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Cửa sổ dữ liệu</div>
                      <div style={{ display: "flex", background: dark ? "#1e293b" : "#f1f5f9", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 9, padding: 3, gap: 3 }}>
                        {[{ id:"today",label:"Hôm nay"},{id:"2d",label:"2 ngày"},{id:"3d",label:"3 ngày"},{id:"7d",label:"7 ngày"}].map(w => (
                          <button key={w.id} onClick={() => setRuleForm((f: any) => ({ ...f, time_window: w.id }))}
                            style={{ flex: 1, border: "none", background: ruleForm.time_window === w.id ? (dark ? "#2a3a52" : "#fff") : "transparent", color: ruleForm.time_window === w.id ? t.text : t.textMuted, padding: "7px 0", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: ruleForm.time_window === w.id ? "0 1px 2px rgba(0,0,0,.2)" : "none" }}>
                            {w.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Check frequency */}
                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 8 }}>Tần suất kiểm tra</div>
                      <div style={{ display: "flex", background: dark ? "#1e293b" : "#f1f5f9", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 9, padding: 3, gap: 3 }}>
                        {[{ id:"hourly",label:"Hằng giờ"},{id:"every_4h",label:"Mỗi 4h"},{id:"daily_7h",label:"Sáng 7h"}].map(f => (
                          <button key={f.id} onClick={() => setRuleForm((fr: any) => ({ ...fr, check_schedule: f.id }))}
                            style={{ flex: 1, border: "none", background: ruleForm.check_schedule === f.id ? (dark ? "#2a3a52" : "#fff") : "transparent", color: ruleForm.check_schedule === f.id ? t.text : t.textMuted, padding: "7px 0", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: ruleForm.check_schedule === f.id ? "0 1px 2px rgba(0,0,0,.2)" : "none" }}>
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Guard settings — collapsible */}
                    <div style={{ marginTop: 20 }}>
                      <button onClick={() => setRuleGuardOpen(o => !o)}
                        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", background: dark ? "#1e293b" : "#f8fafc", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 9, padding: "12px 14px", cursor: "pointer", transition: "border-color .14s" }}>
                        <span style={{ fontSize: 13 }}>⚙️</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Guard settings</span>
                        <span style={{ fontSize: 11.5, color: t.textMuted, marginLeft: 6 }}>Min spend · Cooldown</span>
                        <span style={{ marginLeft: "auto", color: t.textMuted, transform: ruleGuardOpen ? "rotate(90deg)" : "none", transition: "transform .18s", display: "inline-block" }}>▶</span>
                      </button>
                      {ruleGuardOpen && (
                        <div style={{ padding: "14px 4px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Min spend (đ)</div>
                            <input type="number" value={ruleForm.min_spend ?? 200000} onChange={e => setRuleForm((f: any) => ({ ...f, min_spend: Number(e.target.value) }))} style={inputSt} />
                            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>Bỏ qua camp chưa đủ spend</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Cooldown (giờ)</div>
                            <input type="number" value={ruleForm.cooldown_hours ?? 12} onChange={e => setRuleForm((f: any) => ({ ...f, cooldown_hours: Number(e.target.value) }))} style={inputSt} />
                            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>Không kích hoạt lại trong N giờ</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Dry-run result */}
                    {rulePreview !== null && (
                      <div style={{ marginTop: 20, border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, background: "linear-gradient(180deg,rgba(245,158,11,0.07),rgba(245,158,11,0.02))", overflow: "hidden" }}>
                        <div style={{ padding: "13px 15px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(245,158,11,0.18)" }}>
                          <span style={{ fontSize: 17 }}>🔍</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#fcd34d" }}>Kết quả xem thử</span>
                          <span style={{ fontSize: 12, color: t.textMuted, marginLeft: "auto" }}>
                            {rulePreview.length === 0 ? "Không có camp nào khớp" : `${rulePreview.length} camp sẽ bị ảnh hưởng`}
                          </span>
                        </div>
                        {rulePreview.length > 0 && (
                          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
                            {rulePreview.map((c: any) => (
                              <div key={c.campaign_id} style={{ background: dark ? "#1e293b" : "#fff", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, borderRadius: 9, padding: "11px 13px", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>{c.campaign_name}</div>
                                  <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 3 }}>
                                    Hành động: <span style={{ color: "#fcd34d", fontWeight: 600 }}>{actionInfo(ruleForm.action).icon} {actionInfo(ruleForm.action).label}</span>
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 16 }}>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, fontWeight: 600, color: "#fcd34d" }}>{c.metrics.cpr_real ? Math.round(c.metrics.cpr_real/1000)+"k" : "—"}</div>
                                    <div style={{ fontSize: 10, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>CPR thực</div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, fontWeight: 600, color: t.text }}>{Math.round((c.metrics.spend??0)/1000)}k</div>
                                    <div style={{ fontSize: 10, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Spend</div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, fontWeight: 600, color: t.text }}>{c.metrics.orders_real??0}</div>
                                    <div style={{ fontSize: 10, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Đơn thực</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ padding: "10px 15px 13px", fontSize: 11.5, color: t.textMuted, display: "flex", alignItems: "center", gap: 7 }}>
                          <span>⚠️</span><span>Đây chỉ là mô phỏng dựa trên dữ liệu hiện tại. Rule chưa được lưu.</span>
                        </div>
                      </div>
                    )}

                    <div style={{ height: 8 }} />
                  </div>

                  {/* drawer footer */}
                  <div style={{ padding: "14px 22px", borderTop: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, display: "flex", alignItems: "center", gap: 10, background: dark ? "#0b1220" : "#f8fafc", flexShrink: 0 }}>
                    <button onClick={previewRule} disabled={rulePreviewLoading}
                      style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid rgba(245,158,11,.3)", background: "rgba(245,158,11,.1)", color: "#fcd34d", borderRadius: 9, padding: "9px 15px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      {rulePreviewLoading ? "⏳ Đang xem..." : "🔍 Xem thử"}
                    </button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => { setRuleForm(null); setRulePreview(null) }}
                      style={{ background: dark ? "#1e293b" : "#f1f5f9", border: `1px solid ${dark ? "#2d3748" : "#e2e8f0"}`, color: t.text, borderRadius: 9, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      Hủy
                    </button>
                    <button onClick={saveRule} disabled={ruleSaving}
                      style={{ background: t.blue, color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", cursor: ruleSaving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: ruleSaving ? 0.7 : 1, boxShadow: "0 4px 14px rgba(37,99,235,0.35)" }}>
                      {ruleSaving ? "Đang lưu..." : ruleForm.id ? "✅ Lưu thay đổi" : "✅ Lưu & Bật"}
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>
        )
      })()}

    </div>
  )
}

function ScheduleModal({ camp, onClose, t, onChanged }: { camp: any; onClose: () => void; t: any; onChanged: () => void }) {
  const [action, setAction] = useState<"pause" | "activate" | "set_budget">("pause")
  const [scheduledAt, setScheduledAt] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [budget, setBudget] = useState<string>(String(camp.daily_budget || 500000))
  const [schedules, setSchedules] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reload = useCallback(async () => {
    const [sr, lr] = await Promise.all([
      apiFetch(`/admin/pancake-sync/report/camp-control/schedule?campaign_id=${camp.campaign_id}`).then(r => r.json()).catch(() => ({ schedules: [] })),
      apiFetch(`/admin/pancake-sync/report/camp-control/log?campaign_id=${camp.campaign_id}&limit=10`).then(r => r.json()).catch(() => ({ logs: [] })),
    ])
    setSchedules(sr.schedules || [])
    setLogs(lr.logs || [])
  }, [camp.campaign_id])

  useEffect(() => { reload() }, [reload])

  const submit = async () => {
    setSubmitting(true)
    try {
      const payload: any = { campaign_id: camp.campaign_id, action, scheduled_at: new Date(scheduledAt).toISOString() }
      if (action === "set_budget") payload.payload = { daily_budget: Number(budget) }
      const res = await apiFetch("/admin/pancake-sync/report/camp-control/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
      await reload()
      await onChanged()
    } finally { setSubmitting(false) }
  }

  const cancel = async (id: string) => {
    if (!confirm("Huỷ schedule này?")) return
    const res = await apiFetch(`/admin/pancake-sync/report/camp-control/schedule/${id}`, { method: "DELETE" })
    const data = await res.json()
    if (!res.ok) { alert("Lỗi: " + (data.error || "unknown")); return }
    await reload()
  }

  const fmtTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: 20, maxWidth: 720, width: "92%", maxHeight: "90vh", overflow: "auto", color: t.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>⏰ Hẹn giờ thao tác</div>
            <div style={{ fontSize: 12, color: t.textMuted, maxWidth: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.campaign_name}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.text, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ background: t.cronBg, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: t.text }}>Tạo schedule mới</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={action} onChange={e => setAction(e.target.value as any)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "6px 10px", color: t.inputText, fontSize: 13 }}>
              <option value="pause">⏸ Tắt camp</option>
              <option value="activate">▶ Bật camp</option>
              <option value="set_budget">💰 Đổi ngân sách</option>
            </select>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "6px 10px", color: t.inputText, fontSize: 13 }} />
            {action === "set_budget" && (
              <input type="number" min={50000} step={50000} value={budget} onChange={e => setBudget(e.target.value)}
                placeholder="Ngân sách mới"
                style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, padding: "6px 10px", color: t.inputText, fontSize: 13, width: 130 }} />
            )}
            <button onClick={submit} disabled={submitting}
              style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 13, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "..." : "Tạo"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6 }}>Cron chạy mỗi phút — sai số tối đa 1 phút</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Schedules ({schedules.length})</div>
          {schedules.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textMuted, padding: 12, textAlign: "center" }}>Chưa có schedule nào</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {schedules.map((s: any) => {
                const color = s.status === "done" ? t.green : s.status === "failed" ? t.red : s.status === "cancelled" ? t.textMuted : t.amber
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: t.cronBg, borderRadius: 4, fontSize: 12 }}>
                    <span style={{ background: color + "22", color, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600 }}>{s.status}</span>
                    <span style={{ color: t.text, minWidth: 80 }}>
                      {s.action === "pause" ? "⏸ Tắt" : s.action === "activate" ? "▶ Bật" : `💰 ${(s.payload?.daily_budget ?? 0).toLocaleString("vi-VN")}đ`}
                    </span>
                    <span style={{ color: t.textMuted, flex: 1 }}>{fmtTime(s.scheduled_at)}</span>
                    <span style={{ color: t.textMuted, fontSize: 10 }}>{s.created_by_email}</span>
                    {s.status === "pending" && (
                      <button onClick={() => cancel(s.id)} style={{ background: "transparent", border: "none", color: t.red, cursor: "pointer", fontSize: 14 }}>✕</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Lịch sử thao tác ({logs.length})</div>
          {logs.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textMuted, padding: 12, textAlign: "center" }}>Chưa có thao tác nào</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {logs.map((l: any) => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", fontSize: 11 }}>
                  <span style={{ color: l.success ? t.green : t.red }}>{l.success ? "✓" : "✗"}</span>
                  <span style={{ color: t.text, minWidth: 80 }}>
                    {l.action === "pause" ? "⏸ Tắt" : l.action === "activate" ? "▶ Bật" : `💰 ${(l.new_value?.daily_budget ?? 0).toLocaleString("vi-VN")}đ`}
                  </span>
                  <span style={{ color: t.textMuted, fontSize: 10 }}>{l.source}</span>
                  <span style={{ color: t.textMuted, flex: 1 }}>{fmtTime(l.created_at)}</span>
                  <span style={{ color: t.textMuted, fontSize: 10 }}>{l.user_email}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Doanh số MKT",
})
