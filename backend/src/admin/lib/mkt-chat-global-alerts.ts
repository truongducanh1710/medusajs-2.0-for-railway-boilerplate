type MktChatNotification = {
  id: string
  channel_id: string
  channel_name: string
  message_id: string
  sender: string
  sender_name: string
  preview: string
  source?: string
  created_at: string
  read?: boolean
}

type MktChatGlobalAlertState = {
  started: boolean
  es: EventSource | null
  retryTimer: number | null
  repeatTimer: number | null
  repeatCount: number
  unread: number
  audioContext: AudioContext | null
  pendingSound: boolean
  lastPath: string
  listenersInstalled: boolean
  telegramAlertSent: boolean
}

declare global {
  interface Window {
    __mktChatGlobalAlert?: MktChatGlobalAlertState
    __mktChatGlobalAlertHistoryPatched?: boolean
  }
}

const MENTION_SOUND_REPEAT_MS = 20_000
const MENTION_SOUND_REPEAT_LIMIT = 8
const TELEGRAM_ALERT_AT_REPEAT_COUNT = 3
const MKT_CHAT_PENDING_JUMP_KEY = "mkt-chat:pending-jump"

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function isMktChatRoute() {
  return window.location.pathname.replace(/\/+$/, "") === "/app/mkt-chat"
}

function shouldRunGlobalAlert() {
  const path = window.location.pathname
  return path.startsWith("/app") && !isMktChatRoute()
}

function soundEnabled() {
  return localStorage.getItem("mkt-chat:sound") !== "0"
}

function repeatSoundEnabled() {
  return localStorage.getItem("mkt-chat:repeat-sound") !== "0"
}

function emitMentionTone(ctx: AudioContext) {
  const now = ctx.currentTime
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.34, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15)
  gain.connect(ctx.destination)

  ;[
    { freq: 1046.5, start: 0 },
    { freq: 1318.5, start: 0.13 },
    { freq: 1174.7, start: 0.36 },
    { freq: 1568, start: 0.5 },
    { freq: 2093, start: 0.66 },
  ].forEach(({ freq, start }) => {
    const osc = ctx.createOscillator()
    const startAt = now + start
    osc.type = "triangle"
    osc.frequency.setValueAtTime(freq, startAt)
    osc.connect(gain)
    osc.start(startAt)
    osc.stop(startAt + 0.18)
  })

  window.setTimeout(() => gain.disconnect(), 1300)
}

function getState(): MktChatGlobalAlertState {
  if (!window.__mktChatGlobalAlert) {
    window.__mktChatGlobalAlert = {
      started: false,
      es: null,
      retryTimer: null,
      repeatTimer: null,
      repeatCount: 0,
      unread: 0,
      audioContext: null,
      pendingSound: false,
      lastPath: window.location.pathname,
      listenersInstalled: false,
      telegramAlertSent: false,
    }
  }
  return window.__mktChatGlobalAlert
}

function sendTelegramAlert() {
  fetch("/admin/mkt-chat/notifications/telegram-alert", {
    method: "POST",
    credentials: "include",
  }).catch(() => {})
}

function clearRepeatTimer(state = getState()) {
  if (state.repeatTimer !== null) {
    window.clearTimeout(state.repeatTimer)
    state.repeatTimer = null
  }
}

function stopReminder(state = getState()) {
  clearRepeatTimer(state)
  state.repeatCount = 0
  state.pendingSound = false
  state.telegramAlertSent = false
}

function playMentionSound(force = false) {
  if ((!force && !soundEnabled()) || !isBrowser()) return false
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextCtor) return false
  const state = getState()
  const ctx = state.audioContext || new AudioContextCtor()
  state.audioContext = ctx

  const play = () => {
    state.pendingSound = false
    emitMentionTone(ctx)
    return true
  }

  if (ctx.state === "suspended") {
    state.pendingSound = true
    ctx.resume().then(() => {
      if (ctx.state === "running") play()
    }).catch(() => {})
    return false
  }

  return play()
}

function unlockAudio() {
  if (!isBrowser()) return
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextCtor) return
  const state = getState()
  const ctx = state.audioContext || new AudioContextCtor()
  state.audioContext = ctx

  const markUnlocked = () => {
    if (ctx.state === "running" && state.pendingSound && soundEnabled()) {
      playMentionSound(true)
    }
  }

  if (ctx.state === "suspended") {
    ctx.resume().then(markUnlocked).catch(() => {})
    return
  }
  markUnlocked()
}

function scheduleReminder(state = getState()) {
  clearRepeatTimer(state)
  if (!shouldRunGlobalAlert() || !soundEnabled() || !repeatSoundEnabled() || state.unread <= 0) {
    if (state.unread <= 0) state.repeatCount = 0
    return
  }

  state.repeatTimer = window.setTimeout(() => {
    state.repeatTimer = null
    if (!shouldRunGlobalAlert() || state.repeatCount >= MENTION_SOUND_REPEAT_LIMIT) return
    state.repeatCount += 1
    playMentionSound()
    if (!state.telegramAlertSent && state.repeatCount >= TELEGRAM_ALERT_AT_REPEAT_COUNT) {
      state.telegramAlertSent = true
      sendTelegramAlert()
    }
    scheduleReminder(state)
  }, MENTION_SOUND_REPEAT_MS)
}

function escapeText(value: string) {
  return String(value || "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] || ch))
}

function removeToast(id: string) {
  document.getElementById(id)?.remove()
}

function openNotification(notification: MktChatNotification) {
  stopReminder()
  sessionStorage.setItem(MKT_CHAT_PENDING_JUMP_KEY, JSON.stringify({
    channel_id: notification.channel_id,
    message_id: notification.message_id,
  }))
  window.location.href = "/app/mkt-chat"
}

function showToast(notification: MktChatNotification) {
  if (!isBrowser() || isMktChatRoute()) return
  const id = `mkt-chat-global-toast-${notification.id}`
  removeToast(id)

  const wrap = document.createElement("button")
  wrap.id = id
  wrap.type = "button"
  wrap.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "width:320px",
    "max-width:calc(100vw - 32px)",
    "border:1px solid #d1d5db",
    "border-radius:10px",
    "background:#ffffff",
    "box-shadow:0 18px 45px rgba(15,23,42,.22)",
    "padding:12px 14px",
    "text-align:left",
    "cursor:pointer",
    "font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "color:#111827",
  ].join(";")
  wrap.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-weight:800">@</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:12px;font-weight:800;margin-bottom:2px">${escapeText(notification.sender_name || notification.sender)} tag ban</div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">#${escapeText(notification.channel_name)}${notification.source === "thread" ? " - thread" : ""}</div>
        <div style="font-size:12px;line-height:1.35;color:#374151;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeText(notification.preview)}</div>
      </div>
      <span data-close="1" style="padding:0 4px;color:#6b7280;font-size:18px;line-height:18px">x</span>
    </div>
  `
  wrap.addEventListener("click", event => {
    if ((event.target as HTMLElement).dataset.close === "1") {
      event.stopPropagation()
      removeToast(id)
      return
    }
    openNotification(notification)
  })
  document.body.appendChild(wrap)
  window.setTimeout(() => removeToast(id), 12_000)
}

function handleNotification(notification?: MktChatNotification) {
  if (!notification?.id || !shouldRunGlobalAlert()) return
  const state = getState()
  state.unread += 1
  state.repeatCount = 0
  showToast(notification)
  playMentionSound()
  scheduleReminder(state)
}

function loadUnreadCount(): Promise<boolean> {
  if (!shouldRunGlobalAlert()) return Promise.resolve(false)
  return fetch("/admin/mkt-chat/notifications", { credentials: "include" })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data) return false
      const state = getState()
      state.unread = Number(data.unread_count || 0)
      if (state.unread <= 0) stopReminder(state)
      else scheduleReminder(state)
      return true
    })
    .catch(() => false)
}

function closeConnection(state = getState()) {
  if (state.es) {
    state.es.close()
    state.es = null
  }
  if (state.retryTimer !== null) {
    window.clearTimeout(state.retryTimer)
    state.retryTimer = null
  }
  stopReminder(state)
  state.started = false
}

function openEventStream(state = getState()) {
  if (!shouldRunGlobalAlert() || state.es) return

  const es = new EventSource("/admin/mkt-chat/events")
  state.es = es

  es.addEventListener("mention.notification.created", (event: MessageEvent) => {
    const data = JSON.parse(event.data || "{}")
    handleNotification(data.notification as MktChatNotification | undefined)
  })

  es.addEventListener("mention.notifications.read", () => {
    const current = getState()
    current.unread = 0
    stopReminder(current)
  })

  es.onerror = () => {
    const current = getState()
    current.es?.close()
    current.es = null
    current.started = false
    if (current.retryTimer !== null) window.clearTimeout(current.retryTimer)
    current.retryTimer = window.setTimeout(connect, 5000)
  }
}

function connect() {
  if (!shouldRunGlobalAlert()) {
    closeConnection()
    return
  }

  const state = getState()
  if (state.es || state.started) return
  state.started = true

  loadUnreadCount().then(canConnect => {
    const current = getState()
    if (!canConnect || !shouldRunGlobalAlert()) {
      current.started = false
      return
    }
    openEventStream(current)
  })
}
function installNavigationWatcher() {
  if (window.__mktChatGlobalAlertHistoryPatched) return
  window.__mktChatGlobalAlertHistoryPatched = true

  const notify = () => window.setTimeout(() => {
    const state = getState()
    if (state.lastPath === window.location.pathname) return
    state.lastPath = window.location.pathname
    if (shouldRunGlobalAlert()) connect()
    else closeConnection(state)
  }, 0)

  ;(["pushState", "replaceState"] as const).forEach(method => {
    const original = history[method]
    history[method] = function patchedHistoryMethod(...args: any[]) {
      const result = original.apply(this, args as any)
      notify()
      return result
    } as any
  })

  window.addEventListener("popstate", notify)
  window.addEventListener("storage", event => {
    if (event.key !== "mkt-chat:sound" && event.key !== "mkt-chat:repeat-sound") return
    const state = getState()
    if (!soundEnabled() || !repeatSoundEnabled()) stopReminder(state)
    else scheduleReminder(state)
  })
}

export function ensureMktChatGlobalMentionAlerts() {
  if (!isBrowser()) return
  const state = getState()
  installNavigationWatcher()
  if (!state.listenersInstalled) {
    state.listenersInstalled = true
    window.addEventListener("pointerdown", unlockAudio, { passive: true })
    window.addEventListener("keydown", unlockAudio)
  }
  if (shouldRunGlobalAlert()) connect()
}