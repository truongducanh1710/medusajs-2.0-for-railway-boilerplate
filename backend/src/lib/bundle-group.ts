/**
 * Cross-product box tiers ("mua 2–3–4 hộp bất kỳ được tặng thêm"), first used by the ICEgel
 * shop at /icegel (25/11/2026). A product joins a group with product.metadata.bundle_group and
 * is priced per box at product.metadata.group_unit_price (list price, never from the client).
 * The tier — shipping fee and gift patches — depends on the total boxes of the group in the cart.
 * Keep GROUPS in sync with storefront/src/lib/bundle-groups.ts (display only; server decides).
 */
export type GroupTier = { minBoxes: number; fee: number; giftPatches: number }
export type GiftChoice = { key: string; name: string; value: number }
export type BundleGroup = {
  key: string
  label: string
  maxBoxes: number
  giftPackSize: number
  tiers: GroupTier[]
  giftChoices: GiftChoice[]
}

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
