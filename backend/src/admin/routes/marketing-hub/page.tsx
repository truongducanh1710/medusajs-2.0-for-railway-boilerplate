import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState } from "react"
import { MH_TOKENS_CSS } from "../../components/marketing-hub/tokens"
import { VideoSection, type VideoRow } from "../../components/marketing-hub/video-section"
import { FbContentSection, type FbPrefill } from "../../components/marketing-hub/fb-content-section"
import { HieuQuaSection } from "../../components/marketing-hub/hieu-qua-section"

/**
 * Marketing Hub — gộp 3 mảng vào 1 route, chia tab cấp 1 (giống bao-cao-mkt):
 *   Nguyên liệu Video | Đăng Facebook | Hiệu quả Video
 * Bấm "Đăng FB" từ tab Video → chuyển sang tab Facebook + prefill (cùng trang, không reload).
 */
const MarketingHubPage = () => {
  const [section, setSection] = useState<"video" | "fb" | "hieuqua">("video")
  const [prefill, setPrefill] = useState<FbPrefill>(null)

  const onDangFB = (row: VideoRow) => {
    setPrefill({ videoId: row.id, driveUrl: row.link || "", sp: row.sp, vd: row.vdCode })
    setSection("fb")
  }

  const tabs = [
    { id: "video", label: "Nguyên liệu Video" },
    { id: "fb", label: "Đăng Facebook" },
    { id: "hieuqua", label: "Hiệu quả Video" },
  ] as const

  return (
    <div className="mh-scope" style={{ background: "var(--bg)", margin: -24, minHeight: "calc(100vh - 56px)" }}>
      <style>{MH_TOKENS_CSS}</style>

      {/* Tab cấp 1 — section switcher */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--border)", background: "var(--bg-card)", paddingLeft: 20, gap: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSection(t.id as any)}
            style={{
              padding: "13px 20px", background: "none", border: "none", cursor: "pointer",
              fontSize: 14, fontWeight: section === t.id ? 700 : 500,
              color: section === t.id ? "var(--accent)" : "var(--text-2)",
              borderBottom: section === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -2, whiteSpace: "nowrap",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {section === "video"   && <VideoSection onDangFB={onDangFB} />}
      {section === "fb"      && <FbContentSection prefill={prefill} initialTab="dangbai" />}
      {section === "hieuqua" && <HieuQuaSection />}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Marketing Hub" })

export default MarketingHubPage
