/**
 * Display copy of the cross-product box tiers. The backend (backend/src/lib/bundle-group.ts)
 * is authoritative for price, shipping fee and gifts — keep both in sync.
 */
export type GroupTier = { minBoxes: number; fee: number; giftPatches: number }
export type GiftChoice = { key: string; name: string; short: string; image?: string }

export const ICEGEL = {
  key: "icegel",
  label: "ICEgel",
  maxBoxes: 30,
  giftPackSize: 2,
  tiers: [
    { minBoxes: 1, fee: 20000, giftPatches: 0 },
    { minBoxes: 2, fee: 20000, giftPatches: 2 },
    { minBoxes: 3, fee: 0, giftPatches: 4 },
    { minBoxes: 4, fee: 0, giftPatches: 6 },
  ] as GroupTier[],
  giftChoices: [
    { key: "giam-dau", name: "miếng dán giảm đau", short: "Giảm đau" },
    { key: "lam-am", name: "miếng dán làm ấm", short: "Làm ấm" },
    { key: "thai-duong", name: "miếng dán thái dương", short: "Thái dương" },
    { key: "thong-mui", name: "miếng dán thông mũi", short: "Thông mũi" },
    { key: "ha-sot", name: "miếng dán hạ sốt", short: "Hạ sốt" },
    { key: "mat-na-mat", name: "mặt nạ mắt", short: "Mặt nạ mắt" },
  ] as GiftChoice[],
}

export function tierFor(boxes: number): GroupTier {
  return [...ICEGEL.tiers].reverse().find((tier) => boxes >= tier.minBoxes) ?? ICEGEL.tiers[0]
}

/** Next tier the customer can reach by adding boxes, or null at the top tier. */
export function nextTier(boxes: number): GroupTier | null {
  return ICEGEL.tiers.find((tier) => tier.minBoxes > boxes) ?? null
}

/** Gift choice key that matches a product slug, so we can suggest gifts the customer is not buying. */
export const SLUG_TO_GIFT: Record<string, string> = {
  "giam-dau": "giam-dau",
  "dau-goi": "giam-dau",
  "lam-am-giam-dau": "lam-am",
  "am-tu-cung": "lam-am",
  "thai-duong": "thai-duong",
  "thong-mui": "thong-mui",
  "ha-sot": "ha-sot",
  "ha-sot-so-sinh": "ha-sot",
  "mat-na-mat": "mat-na-mat",
}
