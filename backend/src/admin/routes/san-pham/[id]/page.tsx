import { useEffect, useRef, useState } from "react"
import { apiFetch } from "../../../lib/api-client"
import { withRouteGuard } from "../../../components/route-guard"

const useProductId = () => {
  const parts = window.location.pathname.split("/")
  // /app/san-pham/:id  →  last non-empty segment
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] && parts[i] !== "san-pham" && parts[i] !== "app") return parts[i]
  }
  return ""
}

type Tab = "thong-so" | "sale-guide" | "marketing" | "combo-don" | "ghi-chu"

const TABS: { id: Tab; label: string }[] = [
  { id: "thong-so", label: "📦 Thông số kỹ thuật" },
  { id: "sale-guide", label: "💬 Sale Guide" },
  { id: "marketing", label: "📣 Marketing" },
  { id: "combo-don", label: "🧩 Combo đơn" },
  { id: "ghi-chu", label: "📋 Ghi chú chung" },
]


type ComboItemRole = "main" | "addon"

type ComboItem = {
  product_id: string
  code: string
  name: string
  quantity: number
  role: ComboItemRole
}

type SalesCombo = {
  id: string
  name: string
  order_value: number
  note: string
  items: ComboItem[]
}

const DEFAULT_COMBO_COUNT = 3

function emptyCombo(index: number): SalesCombo {
  return {
    id: `combo_${index}`,
    name: `Combo ${index}`,
    order_value: 0,
    note: "",
    items: [],
  }
}

function comboItemFromProduct(product: any, role: ComboItemRole = "addon"): ComboItem {
  return {
    product_id: String(product?.id || ""),
    code: String(product?.code || ""),
    name: String(product?.name || ""),
    quantity: 1,
    role,
  }
}

function defaultSalesCombos(mainProduct?: any): SalesCombo[] {
  const combos = Array.from({ length: DEFAULT_COMBO_COUNT }, (_, i) => emptyCombo(i + 1))
  if (mainProduct?.id) {
    combos[0].items = [comboItemFromProduct(mainProduct, "main")]
  }
  return combos
}

function normalizeComboItem(item: any): ComboItem {
  const role: ComboItemRole = item?.role === "main" ? "main" : "addon"
  const quantity = Number(item?.quantity)
  return {
    product_id: String(item?.product_id || ""),
    code: String(item?.code || ""),
    name: String(item?.name || ""),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    role,
  }
}

function parseSalesCombos(value: unknown, mainProduct?: any): SalesCombo[] {
  let raw = value
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw) } catch { raw = null }
  }
  if (!Array.isArray(raw) || raw.length === 0) return defaultSalesCombos(mainProduct)

  const parsed = raw.slice(0, DEFAULT_COMBO_COUNT).map((combo: any, index: number): SalesCombo => ({
    id: String(combo?.id || `combo_${index + 1}`),
    name: String(combo?.name || `Combo ${index + 1}`),
    order_value: Number(combo?.order_value) || 0,
    note: String(combo?.note || ""),
    items: Array.isArray(combo?.items) ? combo.items.map(normalizeComboItem) : [],
  }))

  while (parsed.length < DEFAULT_COMBO_COUNT) parsed.push(emptyCombo(parsed.length + 1))
  return parsed
}

function findMktProductForTitle(title: string | undefined, products: any[]): any | undefined {
  const normalizedTitle = String(title || "").trim().toLowerCase()
  if (!normalizedTitle) return undefined
  return products.find((mp) => String(mp.name || "").trim().toLowerCase() === normalizedTitle)
}

function parseMoneyInput(value: string): number {
  const normalized = value.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "")
  return Number(normalized) || 0
}

function SaveButton({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <button
      onClick={onSave}
      disabled={saving}
      className="px-4 py-1.5 bg-violet-600 text-white text-sm font-medium rounded hover:bg-violet-700 disabled:opacity-50 transition-colors"
    >
      {saving ? "Đang lưu..." : "Lưu"}
    </button>
  )
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
      {msg}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
      />
    </div>
  )
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
    </div>
  )
}

const SanPhamDetailPage = () => {
  const id = useProductId()
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("thong-so")
  const [toast, setToast] = useState("")
  const [saving, setSaving] = useState(false)
  const [mktProducts, setMktProducts] = useState<any[]>([])

  // --- Thong so fields ---
  const [chatLieu, setChatLieu] = useState("")
  const [kichThuoc, setKichThuoc] = useState("")
  const [xuatXu, setXuatXu] = useState("")
  const [baoHanh, setBaoHanh] = useState("")
  const [mauSac, setMauSac] = useState("")
  const [trongLuong, setTrongLuong] = useState("")
  const [specsNote, setSpecsNote] = useState("")

  // --- Sale guide fields ---
  const [saleGuide, setSaleGuide] = useState("")
  const [saleIssues, setSaleIssues] = useState("")
  const [returnPolicy, setReturnPolicy] = useState("")
  const [commonReturnReasons, setCommonReturnReasons] = useState("")
  const [returnHandling, setReturnHandling] = useState("")

  // --- Marketing fields ---
  const [mktDescription, setMktDescription] = useState("")
  const [mktSpecsContent, setMktSpecsContent] = useState("")
  const [mktHashtags, setMktHashtags] = useState("")

  // --- Ghi chu fields ---
  const [productNotes, setProductNotes] = useState("")
  const [notesUpdatedAt, setNotesUpdatedAt] = useState("")

  // --- Combo don fields ---
  const [salesCombos, setSalesCombos] = useState<SalesCombo[]>(defaultSalesCombos())

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiFetch(`/admin/products/${id}?fields=id,title,thumbnail,metadata,variants,status`)
        .then((r) => r.json()),
      apiFetch(`/admin/marketing-video/products`)
        .then((r) => r.json()).catch(() => ({ products: [] })),
    ]).then(([productData, mktData]) => {
      const p = productData.product
      const products = mktData.products || []
      setProduct(p)
      setMktProducts(products)
      const m = p?.metadata || {}
      setChatLieu(m.chat_lieu || "")
      setKichThuoc(m.kich_thuoc || "")
      setXuatXu(m.xuat_xu || "")
      setBaoHanh(m.bao_hanh || "")
      setMauSac(m.mau_sac || "")
      setTrongLuong(m.trong_luong || "")
      setSpecsNote(m.specs_note || "")
      setSaleGuide(m.sale_guide || "")
      setSaleIssues(m.sale_issues || "")
      setReturnPolicy(m.return_policy || "")
      setCommonReturnReasons(m.common_return_reasons || "")
      setReturnHandling(m.return_handling || "")
      setMktDescription(m.mkt_description || "")
      setMktSpecsContent(m.mkt_specs_content || "")
      setMktHashtags(m.mkt_hashtags || "")
      setProductNotes(m.product_notes || "")
      setNotesUpdatedAt(m.notes_updated_at || "")
      setSalesCombos(parseSalesCombos(m.sales_combos, findMktProductForTitle(p?.title, products)))
    }).catch(console.error).finally(() => setLoading(false))
  }, [id])

  const saveMetadata = async (metadata: Record<string, any>) => {
    setSaving(true)
    try {
      const nextMetadata = { ...(product?.metadata || {}), ...metadata }
      const res = await apiFetch(`/admin/products/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: nextMetadata }),
      })
      if (res.ok) {
        setProduct((prev: any) => prev ? { ...prev, metadata: nextMetadata } : prev)
        setToast("✅ Đã lưu thành công")
      } else {
        setToast("❌ Lưu thất bại")
      }
    } catch {
      setToast("❌ Lỗi kết nối")
    } finally {
      setSaving(false)
    }
  }

  const saveThongSo = () =>
    saveMetadata({ chat_lieu: chatLieu, kich_thuoc: kichThuoc, xuat_xu: xuatXu, bao_hanh: baoHanh, mau_sac: mauSac, trong_luong: trongLuong, specs_note: specsNote })

  const saveSaleGuide = () =>
    saveMetadata({ sale_guide: saleGuide, sale_issues: saleIssues, return_policy: returnPolicy, common_return_reasons: commonReturnReasons, return_handling: returnHandling })

  const saveMarketing = () =>
    saveMetadata({ mkt_description: mktDescription, mkt_specs_content: mktSpecsContent, mkt_hashtags: mktHashtags })

  const saveGhiChu = () => {
    const now = new Date().toLocaleString("vi-VN")
    setNotesUpdatedAt(now)
    saveMetadata({ product_notes: productNotes, notes_updated_at: now })
  }

  const saveSalesCombos = () => saveMetadata({ sales_combos: salesCombos })

  const updateCombo = (comboIndex: number, patch: Partial<SalesCombo>) => {
    setSalesCombos((prev) => prev.map((combo, index) => index === comboIndex ? { ...combo, ...patch } : combo))
  }

  const addComboItem = (comboIndex: number) => {
    setSalesCombos((prev) => prev.map((combo, index) => index === comboIndex
      ? { ...combo, items: [...combo.items, { product_id: "", code: "", name: "", quantity: 1, role: "addon" }] }
      : combo
    ))
  }

  const updateComboItem = (comboIndex: number, itemIndex: number, patch: Partial<ComboItem>) => {
    setSalesCombos((prev) => prev.map((combo, index) => {
      if (index !== comboIndex) return combo
      return {
        ...combo,
        items: combo.items.map((item, idx) => idx === itemIndex ? { ...item, ...patch } : item),
      }
    }))
  }

  const selectComboProduct = (comboIndex: number, itemIndex: number, productId: string) => {
    const selected = mktProducts.find((mp) => String(mp.id) === productId)
    if (!selected) {
      updateComboItem(comboIndex, itemIndex, { product_id: "", code: "", name: "" })
      return
    }
    updateComboItem(comboIndex, itemIndex, { product_id: String(selected.id || ""), code: String(selected.code || ""), name: String(selected.name || "") })
  }

  const removeComboItem = (comboIndex: number, itemIndex: number) => {
    setSalesCombos((prev) => prev.map((combo, index) => index === comboIndex
      ? { ...combo, items: combo.items.filter((_, idx) => idx !== itemIndex) }
      : combo
    ))
  }

  const mktCode = mktProducts.find(
    (mp) => mp.name?.toLowerCase() === product?.title?.toLowerCase()
  )?.code || ""

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Đang tải...</div>
  if (!product) return <div className="flex items-center justify-center h-64 text-gray-400">Không tìm thấy sản phẩm</div>

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {toast && <Toast msg={toast} onDone={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => window.location.href = "/app/san-pham"}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ← Danh sách
        </button>
        <span className="text-gray-300">|</span>
        {product.thumbnail ? (
          <img src={product.thumbnail} alt={product.title} className="w-12 h-12 object-cover rounded-lg" />
        ) : (
          <div className="w-12 h-12 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-xs">?</div>
        )}
        <div className="flex-1">
          <h1 className="text-xl font-bold">{product.title}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${product.status === "published" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
              {product.status === "published" ? "Đã xuất bản" : "Nháp"}
            </span>
            {mktCode && (
              <span className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-700">
                {mktCode}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => window.location.href = `/app/san-pham/${id}/edit`}
          className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
        >
          ✏️ Sửa trang sản phẩm
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Thong so */}
      {tab === "thong-so" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">Bộ phận kho cập nhật thông số chính xác để sale và marketing tra cứu.</p>
          <div className="grid grid-cols-2 gap-4">
            <InputField label="Chất liệu" value={chatLieu} onChange={setChatLieu} placeholder="VD: Inox 304, Nhựa ABS..." />
            <InputField label="Kích thước" value={kichThuoc} onChange={setKichThuoc} placeholder="VD: 30x20x15 cm" />
            <InputField label="Xuất xứ" value={xuatXu} onChange={setXuatXu} placeholder="VD: Việt Nam, Hàn Quốc..." />
            <InputField label="Bảo hành" value={baoHanh} onChange={setBaoHanh} placeholder="VD: 12 tháng" />
            <InputField label="Màu sắc" value={mauSac} onChange={setMauSac} placeholder="VD: Trắng, Đen, Xám..." />
            <InputField label="Trọng lượng" value={trongLuong} onChange={setTrongLuong} placeholder="VD: 1.2 kg" />
          </div>
          <Field label="Ghi chú kỹ thuật thêm" value={specsNote} onChange={setSpecsNote} rows={4} placeholder="Các thông số khác, lưu ý kỹ thuật, thông tin bổ sung..." />
          <div className="flex justify-end">
            <SaveButton onSave={saveThongSo} saving={saving} />
          </div>
        </div>
      )}

      {/* Tab: Sale Guide */}
      {tab === "sale-guide" && (
        <div className="space-y-5">
          <p className="text-xs text-gray-400">Thông tin để sale và CSKH tra cứu khi tư vấn khách hàng.</p>

          <Field label="Cách tư vấn / Điểm bán (USP)" value={saleGuide} onChange={setSaleGuide} rows={5}
            placeholder="Khách hay hỏi gì? Trả lời thế nào? Điểm khác biệt so với đối thủ?..." />

          <Field label="Vấn đề hay gặp & cách xử lý" value={saleIssues} onChange={setSaleIssues} rows={4}
            placeholder="Các lỗi/thắc mắc thường gặp và cách giải quyết..." />

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">🔄 Hoàn hủy</h3>
            <div className="space-y-3">
              <Field label="Chính sách hoàn trả" value={returnPolicy} onChange={setReturnPolicy} rows={3}
                placeholder="Điều kiện hoàn trả, thời hạn, quy trình..." />
              <Field label="Lý do hay bị trả hàng" value={commonReturnReasons} onChange={setCommonReturnReasons} rows={3}
                placeholder="Khách hay trả vì lý do gì? VD: không vừa size, không đúng màu..." />
              <Field label="Cách xử lý hoàn hủy" value={returnHandling} onChange={setReturnHandling} rows={3}
                placeholder="Quy trình xử lý, ai phụ trách, liên hệ kho thế nào..." />
            </div>
            <div className="mt-3">
              <a
                href={`/app/don-hang`}
                onClick={(e) => { e.preventDefault(); window.location.href = "/app/don-hang" }}
                className="text-xs text-violet-600 hover:underline"
              >
                → Xem đơn hủy / hoàn trong Don hàng
              </a>
            </div>
          </div>

          <div className="flex justify-end">
            <SaveButton onSave={saveSaleGuide} saving={saving} />
          </div>
        </div>
      )}

      {/* Tab: Marketing */}
      {tab === "marketing" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">Nguyên liệu content cho MKT — mô tả chuẩn, thông số viết lại, hashtag.</p>

          {mktCode && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-center gap-3">
              <span className="text-xs text-gray-500">Mã sản phẩm MKT:</span>
              <span className="font-mono font-bold text-blue-700 text-sm">{mktCode}</span>
            </div>
          )}

          <Field label="Mô tả sản phẩm / USP (dùng làm caption, content)" value={mktDescription} onChange={setMktDescription} rows={6}
            placeholder="Mô tả sản phẩm theo ngôn ngữ marketing — lợi ích, cảm xúc, call to action..." />

          <Field label="Thông số kỹ thuật dạng content-friendly" value={mktSpecsContent} onChange={setMktSpecsContent} rows={4}
            placeholder="Viết lại thông số theo cách người dùng dễ hiểu, dùng trực tiếp cho content..." />

          <Field label="Hashtag / Keywords" value={mktHashtags} onChange={setMktHashtags} rows={3}
            placeholder="#dogiaDung #phanViet #BepInox... hoặc từ khóa quảng cáo" />

          <div className="flex justify-end">
            <SaveButton onSave={saveMarketing} saving={saving} />
          </div>
        </div>
      )}

      {/* Tab: Combo don */}
      {tab === "combo-don" && (
        <div className="space-y-5">
          <p className="text-xs text-gray-400">Cấu hình 3 combo đơn để sale/marketing tra cứu nhanh. Dữ liệu này chưa dùng để tính Target CPQC.</p>

          {salesCombos.map((combo, comboIndex) => (
            <div key={combo.id} className="border border-gray-200 rounded-xl p-4 space-y-4 bg-white">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
                <InputField label="Tên combo" value={combo.name} onChange={(v) => updateCombo(comboIndex, { name: v })} placeholder={`Combo ${comboIndex + 1}`} />
                <InputField
                  label="Giá trị đơn"
                  value={combo.order_value ? String(combo.order_value) : ""}
                  onChange={(v) => updateCombo(comboIndex, { order_value: parseMoneyInput(v) })}
                  placeholder="VD: 299000"
                />
              </div>

              <Field label="Ghi chú combo" value={combo.note} onChange={(v) => updateCombo(comboIndex, { note: v })} rows={2} placeholder="VD: combo bán chạy, áp dụng khi khách muốn mua thêm phụ kiện..." />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Sản phẩm trong combo</h3>
                  <button
                    type="button"
                    onClick={() => addComboItem(comboIndex)}
                    className="px-3 py-1.5 border border-violet-200 text-violet-700 text-xs font-medium rounded-lg hover:bg-violet-50"
                  >
                    + Thêm sản phẩm phụ
                  </button>
                </div>

                {combo.items.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-lg px-3 py-4 text-xs text-gray-400 text-center">
                    Chưa có sản phẩm trong combo. Bấm thêm sản phẩm phụ để chọn từ danh mục.
                  </div>
                ) : (
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Sản phẩm</th>
                          <th className="text-left px-3 py-2 font-medium w-28">Mã SP</th>
                          <th className="text-left px-3 py-2 font-medium w-24">Số lượng</th>
                          <th className="text-left px-3 py-2 font-medium w-32">Loại</th>
                          <th className="w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {combo.items.map((item, itemIndex) => (
                          <tr key={`${combo.id}_${itemIndex}`} className="border-t border-gray-100">
                            <td className="px-3 py-2">
                              <select
                                value={item.product_id}
                                onChange={(e) => selectComboProduct(comboIndex, itemIndex, e.target.value)}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                              >
                                <option value="">Chọn sản phẩm...</option>
                                {mktProducts.map((mp) => (
                                  <option key={mp.id} value={mp.id}>{mp.name}</option>
                                ))}
                              </select>
                              {item.name && <div className="mt-1 text-[11px] text-gray-400 truncate">{item.name}</div>}
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-500">{item.code || "—"}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) => updateComboItem(comboIndex, itemIndex, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                                className="w-20 border border-gray-200 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-violet-300"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={item.role}
                                onChange={(e) => updateComboItem(comboIndex, itemIndex, { role: e.target.value as ComboItemRole })}
                                className="w-full border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                              >
                                <option value="main">Sản phẩm chính</option>
                                <option value="addon">Sản phẩm phụ</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => removeComboItem(comboIndex, itemIndex)}
                                className="text-gray-300 hover:text-red-500"
                                title="Xóa dòng"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="flex justify-end">
            <SaveButton onSave={saveSalesCombos} saving={saving} />
          </div>
        </div>
      )}

      {/* Tab: Ghi chu */}
      {tab === "ghi-chu" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">Ghi chú chung cho mọi bộ phận — thông tin linh tinh, lưu ý đặc biệt.</p>
          <Field label="Ghi chú" value={productNotes} onChange={setProductNotes} rows={10}
            placeholder="Tự do ghi chú bất cứ thông tin gì liên quan đến sản phẩm này..." />
          {notesUpdatedAt && (
            <p className="text-xs text-gray-400">Cập nhật lần cuối: {notesUpdatedAt}</p>
          )}
          <div className="flex justify-end">
            <SaveButton onSave={saveGhiChu} saving={saving} />
          </div>
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(SanPhamDetailPage)