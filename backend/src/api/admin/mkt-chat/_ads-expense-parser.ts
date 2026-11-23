import { getPool } from "../../../lib/db"

export const ADS_EXPENSE_CHANNEL_NAME = "KẾ TOÁN - MKT - Báo Ngưỡng"

export type ParsedAdsExpense = {
  card_last4: string | null
  merchant: string | null
  amount: number
  currency: string
  txn_at: Date | null
  // true = SMS không ghi thời điểm, txn_at được mượn từ giao dịch có ngày đứng cạnh trong cùng tin nhắn
  date_guessed: boolean
  raw_text: string
}

type Hit = Omit<ParsedAdsExpense, "date_guessed"> & { index: number }

// Một tin nhắn thường là paste hàng loạt, trộn nhiều mẫu SMS của nhiều ngân hàng.
// Mỗi mẫu một regex "g"; gom tất cả theo vị trí trong tin để suy ngày cho mẫu không có ngày.

// A. "The Visa 438103...3793 su dung tai FACEBK *M6Z5MVVXY2 Dublin IE so tien 5,500,000 VND luc 13-07-2026 22:30:35."
//    VCB gửi bản có dấu: "Thẻ VCB Visa 438103...2272 sử dụng tại FACEBK *8LM59TZS32 ... số tiền 1,196,868 VND lúc 12-07-2026 20:25:17."
const RE_VISA = /Visa\s+([\d.]+)\s+s[uử] d[uụ]ng t[aạ]i\s+(.+?)\s+s[oố] ti[eề]n\s+([\d,.]+)\s*(VND|USD)?\s*l[uú]c\s+(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/gi

// B. "MB VISA: SD THE [484803....7438]\nNgày GD: [2026-10-28 08:19:38]\nSố tiền GD: - 2,500,000 VND\nNội dung giao dịch: Giao dịch chi tiêu tại FACEBK *2V57HBW2K4"
const RE_MB = /MB VISA:\s*SD THE\s*\[([\d.\s]+)\]\s*Ngày GD:\s*\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\]\s*Số tiền GD:\s*-?\s*([\d,.]+)\s*(VND|USD)?\s*Nội dung giao dịch:\s*(?:Giao dịch chi tiêu tại\s*)?(FACEBK\s*\*\s*\w+|[^\n]+)/gi

// C. "The VPBank 5243...2746 vua chi tieu -2,884,427VND ND:FACEBK *6F3XL8WN94 vao luc 06:14 21/10." (năm có thể có "/26" hoặc không)
const RE_VPB = /VPBank\s+([\d.]+)\s+vua chi tieu\s*-?\s*([\d,.]+)\s*(VND|USD)\s*ND:\s*(.+?)\s+vao luc\s+(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/gi

// D. "Thẻ: 4 .... .... 1336\nSố tiền: - VND 3,000,000\nThanh toán tại FACEBK *CMJXF8J4A4" — KHÔNG có ngày giờ
const RE_CARD = /Thẻ:\s*([\d.\s]+?)\s*Số tiền:\s*-?\s*(VND|USD)?\s*([\d,.]+)\s*(?:VND|USD)?\s*Thanh toán tại\s*(FACEBK\s*\*\s*\w+|[^\n]+)/gi

function vnTime(y: number, mo: number, d: number, hh: number, mm: number, ss: number): Date | null {
  const t = new Date(Date.UTC(y, mo - 1, d, hh - 7, mm, ss))
  return Number.isNaN(t.getTime()) ? null : t
}

const toAmount = (s: string) => Number(String(s).replace(/[.,]/g, ""))
const last4 = (s: string) => String(s).replace(/\D/g, "").slice(-4) || null
const cleanMerchant = (s: string) => String(s).replace(/\s+/g, " ").replace(/\*\s+/, "*").trim()

export function extractFbRef(merchant: string | null): string | null {
  const m = String(merchant || "").match(/FACEBK\s*\*\s*(\w+)/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * @param refDate thời điểm tin nhắn được gửi — dùng để suy năm cho SMS VPBank không ghi năm.
 */
export function parseAdsExpenseText(input: string, refDate: Date = new Date()): ParsedAdsExpense[] {
  const text = String(input || "").normalize("NFC")
  const hits: Hit[] = []
  let m: RegExpExecArray | null

  const re1 = new RegExp(RE_VISA)
  while ((m = re1.exec(text)) !== null) {
    const [full, card, merchant, amt, cur, d, mo, y, hh, mi, ss] = m
    hits.push({ index: m.index, card_last4: last4(card), merchant: cleanMerchant(merchant), amount: toAmount(amt), currency: (cur || "VND").toUpperCase(), txn_at: vnTime(+y, +mo, +d, +hh, +mi, +ss), raw_text: full })
  }

  const re2 = new RegExp(RE_MB)
  while ((m = re2.exec(text)) !== null) {
    const [full, card, y, mo, d, hh, mi, ss, amt, cur, merchant] = m
    hits.push({ index: m.index, card_last4: last4(card), merchant: cleanMerchant(merchant), amount: toAmount(amt), currency: (cur || "VND").toUpperCase(), txn_at: vnTime(+y, +mo, +d, +hh, +mi, +ss), raw_text: full })
  }

  const re3 = new RegExp(RE_VPB)
  const refVn = new Date(refDate.getTime() + 7 * 3600000)
  while ((m = re3.exec(text)) !== null) {
    const [full, card, amt, cur, merchant, hh, mi, d, mo, yRaw] = m
    let y = yRaw ? Number(yRaw.length === 2 ? `20${yRaw}` : yRaw) : refVn.getUTCFullYear()
    let at = vnTime(y, +mo, +d, +hh, +mi, 0)
    // Không ghi năm mà ngày suy ra nằm sau lúc gửi tin → là năm trước (vd paste giao dịch 30/12 vào ngày 2/1)
    if (!yRaw && at && at.getTime() > refDate.getTime() + 86400000) at = vnTime(y - 1, +mo, +d, +hh, +mi, 0)
    hits.push({ index: m.index, card_last4: last4(card), merchant: cleanMerchant(merchant), amount: toAmount(amt), currency: cur.toUpperCase(), txn_at: at, raw_text: full })
  }

  const re4 = new RegExp(RE_CARD)
  while ((m = re4.exec(text)) !== null) {
    const [full, card, cur, amt, merchant] = m
    hits.push({ index: m.index, card_last4: last4(card), merchant: cleanMerchant(merchant), amount: toAmount(amt), currency: (cur || "VND").toUpperCase(), txn_at: null, raw_text: full })
  }

  hits.sort((a, b) => a.index - b.index)

  // Mẫu D không có ngày: mượn thời điểm giao dịch có ngày gần nhất phía trước (không có thì phía sau)
  // trong cùng tin. Cộng thêm vài giây theo thứ tự để không đụng unique index (thẻ+số tiền+thời điểm).
  const results: ParsedAdsExpense[] = []
  hits.forEach((h, i) => {
    if (!h.amount || Number.isNaN(h.amount)) return
    let txnAt = h.txn_at
    let guessed = false
    if (!txnAt) {
      let anchor: Date | null = null
      for (let j = i - 1; j >= 0 && !anchor; j--) if (hits[j].txn_at) anchor = hits[j].txn_at
      for (let j = i + 1; j < hits.length && !anchor; j++) if (hits[j].txn_at) anchor = hits[j].txn_at
      txnAt = new Date((anchor || refDate).getTime() + (i + 1) * 1000)
      guessed = true
    }
    const { index, ...rest } = h
    results.push({ ...rest, txn_at: txnAt, date_guessed: guessed })
  })
  return results
}

/**
 * Đọc 1 tin nhắn của nhóm kế toán → ghi giao dịch. Bỏ qua giao dịch đã có (theo mã FACEBK *XXXX,
 * kể cả dòng đã bị kế toán xoá — để quét lại không làm sống lại dòng đã xoá).
 */
export async function ingestAdsExpenseMessage(
  svc: any,
  msg: { id: string; channel_id: string; content: string; created_at?: Date | string | null }
): Promise<{ parsed: number; inserted: number; skipped: number }> {
  const refDate = msg.created_at ? new Date(msg.created_at) : new Date()
  const parsedList = parseAdsExpenseText(msg.content, refDate)
  if (!parsedList.length) return { parsed: 0, inserted: 0, skipped: 0 }

  const refs = parsedList.map((p) => extractFbRef(p.merchant)).filter(Boolean) as string[]
  const existing = new Set<string>()
  if (refs.length) {
    const { rows } = await getPool().query(
      `select upper(substring(merchant from 'FACEBK[[:space:]]*[*][[:space:]]*([[:alnum:]]+)')) as ref
         from ads_expense_transaction
        where channel_id = $1
          and upper(substring(merchant from 'FACEBK[[:space:]]*[*][[:space:]]*([[:alnum:]]+)')) = any($2)`,
      [msg.channel_id, refs]
    )
    rows.forEach((r: any) => r.ref && existing.add(r.ref))
  }

  let inserted = 0
  let skipped = 0
  for (const p of parsedList) {
    const ref = extractFbRef(p.merchant)
    if (ref && existing.has(ref)) { skipped++; continue }
    try {
      await svc.createAdsExpenseTransactions({
        source_message_id: msg.id,
        channel_id: msg.channel_id,
        card_last4: p.card_last4,
        merchant: p.merchant,
        amount: p.amount,
        currency: p.currency,
        txn_at: p.txn_at,
        raw_text: p.raw_text,
        parsed_by: p.date_guessed ? "regex-date-guessed" : "regex",
      })
      if (ref) existing.add(ref)
      inserted++
    } catch (e: any) {
      if (e?.code === "23505" || /duplicate|unique/i.test(String(e?.message))) skipped++ // trùng thẻ+tiền+thời điểm
      else console.error("[ads-expense] insert failed", e)
    }
  }
  return { parsed: parsedList.length, inserted, skipped }
}
