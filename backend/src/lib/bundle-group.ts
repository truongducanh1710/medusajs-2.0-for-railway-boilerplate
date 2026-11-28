/**
 * Cross-product box tiers ("mua 2–3–4 hộp bất kỳ được tặng thêm"), first used by the ICEgel
 * shop at /icegel (25/11/2026). A product joins a group with product.metadata.bundle_group and
 * is priced per box at product.metadata.group_unit_price (list price, never from the client).
 * The tier — shipping fee and gift patches — depends on the total boxes of the group in the cart.
 * Keep GROUPS in sync with storefront/src/lib/bundle-groups.ts (display only; server decides).
 */
export type GroupTier = { minBoxes: number; fee: number; giftPatches: number }
export type GiftChoice = { key: string; name: string; value: number }
/**
 * Address-based shipping for tiers that charge a fee: same-province parcels (the warehouse is in
 * Hanoi) pay localFee; a phone that has never ordered from Phan Viet (web or POS) ships free.
 * Every fee here needs a matching key in product.metadata.bundle_shipping_option_ids.
 */
export type GroupShipping = { localFee: number; localProvinces: string[]; newCustomerFree: boolean }
export type BundleGroup = {
  key: string
  label: string
  maxBoxes: number
  giftPackSize: number
  tiers: GroupTier[]
  giftChoices: GiftChoice[]
  shipping?: GroupShipping
}
/** Who is shipping where: province = shipping_address.city as typed by the checkout; isNewCustomer from order history */
export type ShipContext = { province?: string | null; isNewCustomer?: boolean }
export type ShipQuote = { fee: number; reason: "tier_free" | "new_customer" | "local" | "standard" }

export const GROUPS: Record<string, BundleGroup> = {
  icegel: {
    key: "icegel",
    label: "ICEgel",
    maxBoxes: 30,
    // Gifts come in packs of 2 patches; the customer picks the type of each pack
    giftPackSize: 2,
    tiers: [
      { minBoxes: 1, fee: 20000, giftPatches: 0 },
      { minBoxes: 2, fee: 20000, giftPatches: 2 },
      { minBoxes: 3, fee: 0, giftPatches: 4 },
      { minBoxes: 4, fee: 0, giftPatches: 6 },
    ],
    // 28/11 user: fee shown only after the address (by province), first order ships free.
    // VTP PL01: nội tỉnh 16,5k, liên tỉnh ~20k for parcels ≤0,5kg.
    shipping: { localFee: 16000, localProvinces: ["ha noi"], newCustomerFree: true },
    giftChoices: [
      { key: "giam-dau", name: "miếng dán giảm đau", value: 42000 },
      { key: "lam-am", name: "miếng dán làm ấm", value: 42000 },
      { key: "thai-duong", name: "miếng dán thái dương", value: 13500 },
      { key: "thong-mui", name: "miếng dán thông mũi", value: 19700 },
      { key: "ha-sot", name: "miếng dán hạ sốt", value: 17000 },
      { key: "mat-na-mat", name: "mặt nạ mắt", value: 42000 },
    ],
  },
}

const parse = (value: any): any => {
  if (typeof value !== "string") return value
  try { return JSON.parse(value) } catch { return undefined }
}

export function productGroup(productMetadata: any): BundleGroup | null {
  const key = productMetadata?.bundle_group
  return typeof key === "string" && GROUPS[key] ? GROUPS[key] : null
}

export function groupUnitPrice(productMetadata: any): number | null {
  const price = Number(productMetadata?.group_unit_price)
  return Number.isSafeInteger(price) && price > 0 ? price : null
}

export function groupTier(group: BundleGroup, boxes: number): GroupTier {
  return [...group.tiers].reverse().find((tier) => boxes >= tier.minBoxes) ?? group.tiers[0]
}

const VN_GROUPS: Record<string, string> = {
  a: "àáảãạăằắẳẵặâầấẩẫậ", e: "èéẻẽẹêềếểễệ", i: "ìíỉĩị", o: "òóỏõọôồốổỗộơờớởỡợ",
  u: "ùúủũụưừứửữự", y: "ỳýỷỹỵ", d: "đ",
}
const VN_BASE: Record<string, string> = Object.fromEntries(
  Object.entries(VN_GROUPS).flatMap(([base, chars]) => [...chars].map((ch) => [ch, base])))

/** "Thành phố Hà Nội" / "Ha Noi" → "ha noi" */
export function normalizeProvince(value: unknown): string {
  // Explicit table: String.normalize("NFD") did not strip marks on the production runtime (28/11)
  return [...String(value ?? "").normalize("NFC").toLowerCase()].map((ch) => VN_BASE[ch] ?? ch).join("")
    .replace(/^(thanh pho|tinh|tp\.?)\s+/, "").replace(/\s+/g, " ").trim()
}

// Places outside Hanoi whose names contain "Hà Nội" (Xa lộ Hà Nội in Thủ Đức)
const NOT_LOCAL = / (ho chi minh|hcm|tphcm|sai gon|thu duc) /

/**
 * Checkout addresses are free text ("12 ngõ 5 Cầu Giấy, Hà Nội", "... HN"), so the province is
 * found anywhere in the text rather than in a dedicated field.
 */
export function isLocalAddress(ship: GroupShipping, text: unknown): boolean {
  const n = ` ${normalizeProvince(text).replace(/[^a-z0-9]+/g, " ")} `
  if (NOT_LOCAL.test(n)) return false
  return ship.localProvinces.some((p) => n.includes(` ${p} `) || n.includes(` ${p.replace(/ /g, "")} `)) || / hn /.test(n)
}

/** Fee the customer pays for this many boxes, given where it ships and who orders. */
export function groupShippingQuote(group: BundleGroup, boxes: number, ctx: ShipContext = {}): ShipQuote {
  const tierFee = groupTier(group, boxes).fee
  if (tierFee === 0) return { fee: 0, reason: "tier_free" }
  const ship = group.shipping
  if (!ship) return { fee: tierFee, reason: "standard" }
  if (ship.newCustomerFree && ctx.isNewCustomer) return { fee: 0, reason: "new_customer" }
  if (isLocalAddress(ship, ctx.province)) return { fee: Math.min(tierFee, ship.localFee), reason: "local" }
  return { fee: tierFee, reason: "standard" }
}

/** Last 9 digits of a VN phone ("0912…", "+84912…", "84 912…" all match) */
export function phoneKey(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "")
  return digits.length >= 9 ? digits.slice(-9) : ""
}

/** Gift packs for the tier: valid customer picks first, then the first choices as defaults. */
export function groupGifts(group: BundleGroup, boxes: number, picks: unknown): { name: string; quantity: number; value: number; key: string }[] {
  const packs = Math.floor(groupTier(group, boxes).giftPatches / group.giftPackSize)
  if (packs <= 0) return []
  const wanted = (Array.isArray(picks) ? picks : parse(picks) ?? [])
    .map((key: unknown) => group.giftChoices.find((choice) => choice.key === key))
    .filter(Boolean) as GiftChoice[]
  const chosen: GiftChoice[] = []
  for (let i = 0; i < packs; i++) chosen.push(wanted[i] ?? group.giftChoices[i % group.giftChoices.length])
  // One line per gift type so the note reads "4 miếng dán giảm đau", not two lines of 2
  const merged = new Map<string, { name: string; quantity: number; value: number; key: string }>()
  for (const choice of chosen) {
    const entry = merged.get(choice.key) ?? { key: choice.key, name: "", quantity: 0, value: 0 }
    entry.quantity += group.giftPackSize
    entry.value += choice.value * group.giftPackSize
    entry.name = `${entry.quantity} ${choice.name} (${group.label})`
    merged.set(choice.key, entry)
  }
  return [...merged.values()]
}

type GroupLine = { item: any; productMetadata: any }

/**
 * Server-authoritative state of every group line in a cart: list price per box, tier fee on each
 * line (checkout shows the max line fee), and the tier gifts on the first line only.
 * Returns only the lines that need writing.
 */
export function groupLineUpdates(lines: GroupLine[]) {
  const byGroup = new Map<string, GroupLine[]>()
  for (const line of lines) {
    const group = productGroup(line.productMetadata)
    if (!group) continue
    byGroup.set(group.key, [...(byGroup.get(group.key) ?? []), line])
  }
  const updates: any[] = []
  for (const [key, groupLines] of byGroup) {
    const group = GROUPS[key]
    const boxes = groupLines.reduce((sum, line) => sum + Math.max(0, Number(line.item.quantity) || 0), 0)
    const tier = groupTier(group, boxes)
    const sorted = [...groupLines].sort((a, b) => String(a.item.id).localeCompare(String(b.item.id)))
    const picks = sorted.map((line) => line.item.metadata?.gift_picks).find((value) => value != null)
    const giftJson = JSON.stringify(groupGifts(group, boxes, picks))
    sorted.forEach(({ item, productMetadata }, index) => {
      const unitPrice = groupUnitPrice(productMetadata)
      const qty = Number(item.quantity)
      if (!unitPrice || !Number.isSafeInteger(qty) || qty < 1) return
      const gifts = index === 0 ? giftJson : "[]"
      const metadata = {
        ...(item.metadata ?? {}),
        bundle_group: key,
        bundle_qty: qty,
        bundle_price: unitPrice * qty,
        bundle_shipping_fee: tier.fee,
        gifts,
      }
      const m = item.metadata ?? {}
      const settled = Number(item.unit_price) === unitPrice && item.is_custom_price === true &&
        m.bundle_group === key && Number(m.bundle_qty) === qty && Number(m.bundle_price) === unitPrice * qty &&
        Number(m.bundle_shipping_fee) === tier.fee && m.gifts === gifts
      if (!settled) updates.push({ id: item.id, unit_price: unitPrice, is_custom_price: true, metadata })
    })
  }
  return updates
}
