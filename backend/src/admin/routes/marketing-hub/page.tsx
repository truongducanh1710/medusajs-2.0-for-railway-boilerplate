import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState } from "react"
import { VideoSection, type VideoRow } from "../../components/marketing-hub/video-section"
import { FbContentSection, type FbPrefill } from "../../components/marketing-hub/fb-content-section"
import { HieuQuaSection } from "../../components/marketing-hub/hieu-qua-section"
import { QuanLyPageTab } from "../../components/marketing-hub/quan-ly-page-tab"
import { AudienceTab } from "../../components/marketing-hub/audience-tab"
import { useCurrentPermissions } from "../../lib/use-permissions"

const MarketingHubPage = () => {
  const [section, setSection] = useState<"video" | "fb" | "hieuqua" | "quanly" | "audience">("video")
  const [prefill, setPrefill] = useState<FbPrefill>(null)
  const { isSuper, mktCode, has } = useCurrentPermissions()
  const canAudience = isSuper || has("page.fb-content.post")

  const onDangFB = (row: VideoRow) => {
    setPrefill({ videoId: row.id, driveUrl: row.link || "", sp: row.sp, vd: row.vdCode })
    setSection("fb")
  }

  const tabs = [
    { id: "video",    label: "Nguyên liệu Video" },
    { id: "fb",       label: "Đăng Facebook" },
    { id: "hieuqua",  label: "Hiệu quả Video" },
    { id: "quanly",   label: "🗂 Quản lý Page" },
    ...(canAudience ? [{ id: "audience", label: "🎯 Tệp đối tượng" }] : []),
  ] as const

  return (
    <div style={{ background: "#F4F5F9", margin: -24, minHeight: "calc(100vh - 56px)" }}>
      {/* Tab cấp 1 */}
      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", background: "#FFFFFF", paddingLeft: 20, gap: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSection(t.id as any)}
            style={{
              padding: "13px 20px", background: "none", border: "none", cursor: "pointer",
              fontSize: 14, fontWeight: section === t.id ? 700 : 500,
              color: section === t.id ? "#1877F2" : "#4B5563",
              borderBottom: section === t.id ? "2px solid #1877F2" : "2px solid transparent",
              marginBottom: -1, whiteSpace: "nowrap",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {section === "video"   && <VideoSection onDangFB={onDangFB} />}
      {section === "fb"      && <FbContentSection prefill={prefill} initialTab="dangbai" />}
      {section === "hieuqua" && <HieuQuaSection />}
      {section === "quanly"  && <div style={{ padding: 20 }}><QuanLyPageTab /></div>}
      {section === "audience" && <div style={{ padding: 20 }}><AudienceTab isAdmin={isSuper} mktCode={mktCode} /></div>}
    </div>
  )
}

export const config = defineRouteConfig({ label: "Marketing Hub" })

export default MarketingHubPage
