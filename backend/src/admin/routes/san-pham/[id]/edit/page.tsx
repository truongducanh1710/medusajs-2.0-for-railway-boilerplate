import { useEffect, useState } from "react"
import { apiFetch } from "../../../../lib/api-client"
import ProductPageBuilder from "../../../../components/product-page-builder"
import { withRouteGuard } from "../../../../components/route-guard"

const useProductId = () => {
  const parts = window.location.pathname.split("/")
  // /app/san-pham/:id/edit → parts[..indexOf("edit")-1]
  const editIdx = parts.indexOf("edit")
  return editIdx > 0 ? parts[editIdx - 1] : ""
}

const SanPhamEditPage = () => {
  const id = useProductId()
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    apiFetch(`/admin/products/${id}?fields=id,title,metadata`)
      .then((r) => r.json())
      .then((d) => setProduct(d.product))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  // API /admin/product-content nhận { productId, metadata } — cùng format với
  // product-content-widget (page_content_draft = nháp, page_content = live)
  const saveContent = async (metadata: Record<string, any>) => {
    const res = await apiFetch(`/admin/product-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: id, metadata }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Lưu thất bại (${res.status})`)
    }
  }

  const handleSaveDraft = async (content: string) => {
    await saveContent({ page_content_draft: content })
  }

  const handlePublish = async (content: string) => {
    // Đẩy bản live hiện tại vào version history trước khi ghi đè (giống widget)
    const fresh = await apiFetch(`/admin/products/${id}?fields=id,metadata`)
      .then((r) => r.json())
      .catch(() => null)
    const meta = fresh?.product?.metadata || {}
    let versions: any[] = []
    try { versions = JSON.parse(meta.page_content_versions || "[]") } catch {}
    if (meta.page_content?.trim()) {
      versions.unshift({
        id: `v_${Date.now()}`,
        savedAt: new Date().toISOString(),
        savedBy: "san-pham-edit",
        savedByAvatar: "S",
        label: `Xuất bản ${versions.length + 1}`,
        content: meta.page_content,
        size: meta.page_content.length,
      })
      if (versions.length > 5) versions.splice(5)
    }
    await saveContent({
      page_content: content,
      page_content_draft: null,
      page_content_versions: JSON.stringify(versions),
    })
    // Revalidate để storefront cập nhật
    await apiFetch(`/admin/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["products"] }),
    }).catch(() => {})
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">
        Đang tải...
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">
        Không tìm thấy sản phẩm
      </div>
    )
  }

  return (
    <ProductPageBuilder
      open={true}
      productTitle={product.title}
      initialContent={product.metadata?.page_content_draft ?? product.metadata?.page_content}
      hasLiveContent={!!product.metadata?.page_content}
      onClose={() => { window.location.href = `/app/san-pham/${id}` }}
      onSaveDraft={handleSaveDraft}
      onPublish={handlePublish}
    />
  )
}

export default withRouteGuard(SanPhamEditPage)