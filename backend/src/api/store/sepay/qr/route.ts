import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * POST /store/sepay/qr
 * Tạo QR code thanh toán SePay cho đơn hàng
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { orderCode, amount } = req.body as any

    if (!orderCode || !amount) {
      return res.status(400).json({ message: "Thiếu orderCode hoặc amount" })
    }

    const bank = process.env.SEPAY_BANK || "BIDV"
    const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER
    const content = `PV${orderCode}` // Nội dung chuyển khoản để match webhook

    if (!accountNumber) {
      return res.status(500).json({ message: "Chưa cấu hình SEPAY_ACCOUNT_NUMBER" })
    }

    // Tạo QR code bằng VietQR (tương thích mọi ngân hàng VN)
    // Format: https://img.vietqr.io/image/{bank}-{accountNumber}-{template}.png
    const qrUrl = `https://img.vietqr.io/image/${bank}-${accountNumber}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=PHAN VIET`

    return res.json({
      qrUrl,
      bank,
      accountNumber,
      amount,
      content,
      accountName: "PHAN VIET",
    })

  } catch (err: any) {
    console.error("[SePay QR] Error:", err.message)
    return res.status(500).json({ message: err.message })
  }
}

/**
 * GET /store/sepay/status/:orderCode
 * Kiểm tra trạng thái thanh toán của đơn hàng
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const orderCode = req.query.orderCode as string

    if (!orderCode) {
      return res.status(400).json({ message: "Thiếu orderCode" })
    }

    const apiToken = process.env.SEPAY_API_TOKEN
    const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER

    if (!apiToken) {
      return res.status(500).json({ message: "Chưa cấu hình SEPAY_API_TOKEN" })
    }

    // Query SePay API để kiểm tra giao dịch
    const response = await fetch(
      `https://my.sepay.vn/userapi/transactions/list?account_number=${accountNumber}&limit=20&transaction_date_min=${getDateMinusMinutes(30)}`,
      {
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        }
      }
    )

    if (!response.ok) {
      return res.json({ paid: false, message: "API error" })
    }

    const data = await response.json()
    const transactions = data?.transactions || []

    // Tìm giao dịch có nội dung chứa orderCode
    const matchedTx = transactions.find((tx: any) =>
      tx.transaction_content?.toUpperCase().includes(`PV${orderCode}`.toUpperCase()) &&
      tx.transfer_type === "in"
    )

    if (matchedTx) {
      return res.json({
        paid: true,
        amount: matchedTx.amount_in,
        transactionDate: matchedTx.transaction_date,
        referenceCode: matchedTx.reference_number,
      })
    }

    return res.json({ paid: false })

  } catch (err: any) {
    console.error("[SePay Status] Error:", err.message)
    return res.json({ paid: false })
  }
}

function getDateMinusMinutes(minutes: number): string {
  const d = new Date(Date.now() - minutes * 60 * 1000)
  return d.toISOString().slice(0, 19).replace("T", " ")
}
