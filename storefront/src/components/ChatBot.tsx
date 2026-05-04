"use client"

import { useState, useRef, useEffect, useCallback } from "react"

type Message = { role: "user" | "assistant"; content: string }

const QUICK_REPLIES = [
  "Sản phẩm này giá bao nhiêu?",
  "Giao hàng mất bao lâu?",
  "Có đổi trả không?",
  "Thanh toán thế nào?",
]

type Props = {
  productContext?: string
}

export default function ChatBot({ productContext: initialContext }: Props) {
  const [open, setOpen] = useState(false)
  const [productContext, setProductContext] = useState(initialContext || "")

  useEffect(() => {
    const handler = (e: Event) => setProductContext((e as CustomEvent<string>).detail || "")
    window.addEventListener("chatbot-set-context", handler)
    return () => window.removeEventListener("chatbot-set-context", handler)
  }, [])
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Xin chào! 👋 Tôi là trợ lý tư vấn của **Gia Dụng Phan Việt**. Bạn cần tư vấn gì ạ?",
    },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [unread, setUnread] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: "user", content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)

    const allMessages = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages, productContext }),
      })

      if (!res.body) throw new Error("No stream")

      let botText = ""
      setMessages(prev => [...prev, { role: "assistant", content: "" }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "))
        for (const line of lines) {
          const data = line.slice(6)
          if (data === "[DONE]") continue
          try {
            const parsed = JSON.parse(data)
            botText += parsed.text || ""
            setMessages(prev => {
              const copy = [...prev]
              copy[copy.length - 1] = { role: "assistant", content: botText }
              return copy
            })
          } catch {}
        }
      }

      if (!open) setUnread(u => u + 1)
    } catch {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Xin lỗi, có lỗi xảy ra. Vui lòng nhắn Zalo **0967 993 609** để được hỗ trợ nhé!" },
      ])
    } finally {
      setLoading(false)
    }
  }, [messages, loading, productContext, open])

  const renderText = (text: string) => {
    // Simple markdown: **bold**
    return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <>
      {/* Chat window */}
      <div
        style={{
          position: "fixed",
          bottom: 90,
          right: 20,
          width: "min(360px, calc(100vw - 32px))",
          zIndex: 9998,
          display: "flex",
          flexDirection: "column",
          borderRadius: 20,
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
          transform: open ? "scale(1) translateY(0)" : "scale(0.92) translateY(16px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "all 0.25s cubic-bezier(.34,1.56,.64,1)",
          transformOrigin: "bottom right",
        }}
      >
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#E8420A,#ff6b35)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            🤖
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>Trợ lý Phan Việt</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
              Đang hoạt động
            </div>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "#fff", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14, background: "#f8fafc", display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, minHeight: 200 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", gap: 6, alignItems: "flex-end" }}>
              {msg.role === "assistant" && (
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E8420A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, marginBottom: 2 }}>🤖</div>
              )}
              <div style={{
                maxWidth: "78%",
                padding: "9px 13px",
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                background: msg.role === "user" ? "#E8420A" : "#fff",
                color: msg.role === "user" ? "#fff" : "#1f2937",
                fontSize: 13.5,
                lineHeight: 1.55,
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                wordBreak: "break-word",
              }}>
                {msg.content === "" && loading && i === messages.length - 1 ? (
                  <span style={{ display: "flex", gap: 3, alignItems: "center", height: 18 }}>
                    {[0, 1, 2].map(d => (
                      <span key={d} style={{ width: 7, height: 7, borderRadius: "50%", background: "#cbd5e1", animation: `bounce 1s ${d * 0.2}s infinite` }} />
                    ))}
                  </span>
                ) : (
                  renderText(msg.content)
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Quick replies — only show after first message */}
        {messages.length === 1 && (
          <div style={{ padding: "8px 12px", background: "#f8fafc", display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid #e5e7eb" }}>
            {QUICK_REPLIES.map(q => (
              <button key={q} onClick={() => send(q)}
                style={{ padding: "5px 10px", borderRadius: 20, border: "1.5px solid #E8420A", background: "#fff7f5", color: "#E8420A", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ display: "flex", padding: "10px 12px", background: "#fff", borderTop: "1px solid #e5e7eb", gap: 8, alignItems: "center" }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder="Nhập câu hỏi..."
            disabled={loading}
            style={{ flex: 1, border: "1.5px solid #e5e7eb", borderRadius: 24, padding: "8px 14px", fontSize: 13.5, outline: "none", background: "#f8fafc", transition: "border 0.2s" }}
            onFocus={e => { e.currentTarget.style.borderColor = "#E8420A" }}
            onBlur={e => { e.currentTarget.style.borderColor = "#e5e7eb" }}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: input.trim() ? "#E8420A" : "#e5e7eb", color: "#fff", cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.2s" }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Chat tư vấn"
        style={{
          position: "fixed",
          bottom: 24,
          right: 84,
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: open ? "#374151" : "linear-gradient(135deg,#E8420A,#ff6b35)",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 20px rgba(232,66,10,0.45)",
          zIndex: 9998,
          transition: "all 0.25s",
        }}
      >
        {/* Pulse ring */}
        {!open && (
          <span style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid rgba(232,66,10,0.4)", animation: "contact-pulse 1.8s ease-out infinite" }} />
        )}
        {/* Unread badge */}
        {unread > 0 && !open && (
          <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {unread}
          </span>
        )}
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.25s", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {open ? (
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="white" width="22" height="22">
              <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 10H6v-2h12v2zm0-4H6V6h12v2z" />
            </svg>
          )}
        </span>
      </button>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  )
}
