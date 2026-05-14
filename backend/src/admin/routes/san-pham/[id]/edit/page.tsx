import { useEffect, useState } from "react"
import { apiFetch } from "../../../../lib/api-client"
import ProductPageBuilder from "../../../../components/product-page-builder"

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

  const handleSaveDraft = async (content: string) => {
    await apiFetch(`/admin/product-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: id, content, publish: false }),
    })
  }

  const handlePublish = async (content: string) => {
    await apiFetch(`/admin/product-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: id, content, publish: true }),
    })
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
      onClose={() => { window.location.href = "/app/san-pham" }}
      onSaveDraft={handleSaveDraft}
      onPublish={handlePublish}
    />
  )
}

export default SanPhamEditPage
