"use client"

import { useState } from "react"

const CONTACTS = [
  {
    key: "phone",
    href: "tel:0967993609",
    label: "0967 993 609",
    title: "Gọi điện",
    bg: "#22c55e",
    shadow: "rgba(34,197,94,0.45)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C9.61 21 3 14.39 3 6a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z" />
      </svg>
    ),
  },
  {
    key: "zalo",
    href: "https://zalo.me/4385628039049498170",
    label: "Zalo",
    title: "Chat Zalo",
    bg: "#0068FF",
    shadow: "rgba(0,104,255,0.40)",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" width="22" height="22">
        <rect width="48" height="48" rx="12" fill="#0068FF" />
        <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial">Z</text>
      </svg>
    ),
  },
  {
    key: "messenger",
    href: "https://m.me/61577385524644",
    label: "Messenger",
    title: "Facebook",
    bg: "linear-gradient(135deg,#0668E1 0%,#9B59B6 100%)",
    shadow: "rgba(90,80,200,0.40)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.829 1.35 5.355 3.464 7.04V22l3.154-1.737A10.46 10.46 0 0 0 12 20.518c5.523 0 10-4.145 10-9.259C22 6.145 17.523 2 12 2zm1.007 12.47-2.548-2.718-4.971 2.718 5.467-5.8 2.613 2.718 4.906-2.718-5.467 5.8z" />
      </svg>
    ),
  },
]

export default function FloatingContact() {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 10,
      }}
    >
      {/* Contact buttons — animate in/out */}
      {CONTACTS.map((c, i) => (
        <div
          key={c.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            transform: open ? "translateY(0) scale(1)" : "translateY(16px) scale(0.8)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: `all 0.22s cubic-bezier(.34,1.56,.64,1) ${i * 55}ms`,
          }}
        >
          {/* Tooltip label */}
          <span
            style={{
              background: "rgba(17,24,39,0.88)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              padding: "5px 10px",
              borderRadius: 8,
              whiteSpace: "nowrap",
              boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
              letterSpacing: 0.2,
            }}
          >
            {c.label}
          </span>

          {/* Icon button */}
          <a
            href={c.href}
            target={c.key !== "phone" ? "_blank" : undefined}
            rel="noopener noreferrer"
            title={c.title}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: c.bg,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 4px 16px ${c.shadow}`,
              flexShrink: 0,
              textDecoration: "none",
              transition: "transform 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.12)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
          >
            {c.icon}
          </a>
        </div>
      ))}

      {/* Main toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Đóng liên hệ" : "Liên hệ ngay"}
        style={{
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: open ? "#374151" : "#E8420A",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: open
            ? "0 4px 20px rgba(55,65,81,0.45)"
            : "0 4px 20px rgba(232,66,10,0.50)",
          transition: "all 0.25s",
          position: "relative",
        }}
      >
        {/* Pulse ring — only when closed */}
        {!open && (
          <span
            style={{
              position: "absolute",
              inset: -4,
              borderRadius: "50%",
              border: "2px solid rgba(232,66,10,0.45)",
              animation: "contact-pulse 1.8s ease-out infinite",
            }}
          />
        )}

        {/* Icon: chat → X */}
        <span
          style={{
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform 0.25s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {open ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 10H6v-2h12v2zm0-4H6V6h12v2z" />
            </svg>
          )}
        </span>
      </button>

      {/* Keyframe for pulse */}
      <style>{`
        @keyframes contact-pulse {
          0% { transform: scale(1); opacity: 0.8; }
          70% { transform: scale(1.5); opacity: 0; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
