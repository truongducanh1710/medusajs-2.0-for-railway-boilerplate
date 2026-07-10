"use client"

import { useState } from "react"
import { apiJson } from "../../lib/api-client"
import { withRouteGuard } from "../../components/route-guard"

const STEPS = [
  { id: "scrape", label: "Extension đọc dữ liệu từ 1688" },
  { id: "ai", label: "AI viết nội dung tiếng Việt" },
  { id: "create", label: "Tạo sản phẩm trong Medusa" },
  { id: "page", label: "Sinh landing page" },
]

type StepState = "pending" | "active" | "done" | "error"

function Import1688Page() {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<Record<string, StepState>>({
    scrape: "pending", ai: "pending", create: "pending", page: "pending",
  })
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ productId: string; title: string; thumbnail?: string; handle?: string } | null>(null)

  function setStep(id: string, state: StepState) {
    setSteps((prev) => ({ ...prev, [id]: state }))
  }

  async function handleImport() {
    if (!url.trim() || !url.includes("1688.com")) {
      setError("Nhập link sản phẩm 1688.com hợp lệ")
      return
    }
    setError("")
    setResult(null)
    setLoading(true)
    setSteps({ scrape: "pending", ai: "pending", create: "pending", page: "pending" })

    // Hướng dẫn dùng extension
    setStep("scrape", "active")

    // Nếu gọi từ trang admin (không có extension), gọi thẳng API với chỉ URL
    // Backend sẽ báo lỗi nếu thiếu data — user cần dùng extension
    try {
      setStep("scrape", "done")
      setStep("ai", "active")

      const data = await apiJson("/admin/1688-import", "POST", {
        url: url.trim(),
        title: "", // placeholder — extension sẽ điền đầy đủ
        description: "",
        images: [],
        specs: {},
        price: "",
      })

      setStep("ai", "done")
      setStep("create", "done")
      setStep("page", "done")
      setResult(data)
    } catch (err: any) {
      setStep("ai", "error")
      setError(err.message || "Lỗi không xác định")
    } finally {
      setLoading(false)
    }
  }

  const stepColor: Record<StepState, string> = {
    pending: "#d1d5db",
    active: "#3b82f6",
    done: "#10b981",
    error: "#ef4444",
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px", fontFamily: "-apple-system, sans-serif" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 6 }}>
          🛍️ Import sản phẩm từ 1688
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>
          Dùng kèm <strong>Chrome Extension "Phan Viet - Import 1688"</strong> để lấy đầy đủ ảnh &amp; thông số.
          Sau khi bấm import trên extension, sản phẩm sẽ tự động xuất hiện trong danh sách.
        </p>
      </div>

      {/* Extension guide */}
      <div style={{
        background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8,
        padding: "14px 16px", marginBottom: 24, fontSize: 13, color: "#1e40af",
        lineHeight: 1.7
      }}>
        <strong>Cách dùng:</strong>
        <ol style={{ paddingLeft: 20, margin: "6px 0 0" }}>
          <li>Mở trang sản phẩm trên 1688.com trong Chrome</li>
          <li>Bấm icon extension <strong>Phan Viet</strong> trên thanh toolbar</li>
          <li>Nhập Backend URL + API Key → bấm <strong>Phân tích &amp; Tạo sản phẩm</strong></li>
          <li>Đợi ~30 giây, sản phẩm draft sẽ xuất hiện tại đây</li>
        </ol>
      </div>

      {/* Manual test form */}
      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
            URL sản phẩm 1688 (test không có extension)
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://detail.1688.com/offer/123456789.html"
            style={{
              width: "100%", padding: "9px 12px", border: "1px solid #d1d5db",
              borderRadius: 7, fontSize: 13, color: "#111", outline: "none",
            }}
          />
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            ⚠️ Chỉ nhập URL không có ảnh/specs — AI sẽ sinh nội dung từ title URL. Dùng extension để có kết quả tốt hơn.
          </p>
        </div>

        <button
          onClick={handleImport}
          disabled={loading}
          style={{
            width: "100%", padding: "11px 0", background: loading ? "#9ca3af" : "#e63946",
            color: "white", border: "none", borderRadius: 8,
            fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Đang xử lý..." : "🚀 Tạo sản phẩm"}
        </button>
      </div>

      {/* Steps */}
      {loading || Object.values(steps).some((s) => s !== "pending") ? (
        <div style={{ marginBottom: 16 }}>
          {STEPS.map((step) => (
            <div key={step.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", background: "white",
              border: "1px solid #e5e7eb", borderRadius: 7, marginBottom: 6,
              fontSize: 13, color: "#374151",
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                background: stepColor[steps[step.id]],
                boxShadow: steps[step.id] === "active" ? "0 0 0 3px #bfdbfe" : "none",
              }} />
              {step.label}
              {steps[step.id] === "done" && <span style={{ marginLeft: "auto", color: "#10b981", fontSize: 12 }}>✓</span>}
            </div>
          ))}
        </div>
      ) : null}

      {/* Error */}
      {error && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8,
          padding: "12px 14px", color: "#dc2626", fontSize: 13, marginBottom: 16
        }}>
          ❌ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          background: "white", border: "1px solid #d1fae5", borderRadius: 10, padding: 16,
        }}>
          {result.thumbnail && (
            <img src={result.thumbnail} alt="" style={{
              width: "100%", height: 200, objectFit: "cover", borderRadius: 7, marginBottom: 12
            }} />
          )}
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 12, lineHeight: 1.4 }}>
            ✅ {result.title}
          </h3>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={`/app/products/${result.productId}`}
              style={{
                flex: 1, textAlign: "center", padding: "10px 0",
                background: "#10b981", color: "white", borderRadius: 7,
                fontSize: 13, fontWeight: 600, textDecoration: "none",
              }}
            >
              Xem sản phẩm →
            </a>
            <a
              href="/app/products"
              style={{
                flex: 1, textAlign: "center", padding: "10px 0",
                background: "#f3f4f6", color: "#374151", borderRadius: 7,
                fontSize: 13, fontWeight: 600, textDecoration: "none",
              }}
            >
              Danh sách sản phẩm
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(Import1688Page)
