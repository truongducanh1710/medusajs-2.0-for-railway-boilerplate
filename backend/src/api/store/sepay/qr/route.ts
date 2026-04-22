import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function logSePayRouteError(stage: string, error: unknown, extra?: Record<string, unknown>) {
  const payload =
    error instanceof Error
      ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        }
      : { error }

  console.error(`[SePay QR] ${stage}`, {
    ...payload,
    ...extra,
  })
}

/**
 * POST /store/sepay/qr
 * Tạo QR code thanh toán SePay cho đơn hàng
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any

  try {
    const { orderCode, amount } = body
    console.info("[SePay QR] POST request", { orderCode, amount })

    if (!orderCode || amount === undefined || amount === null) {
      return res.status(400).json({ message: "Thiếu orderCode hoặc amount" })
    }

    // Minimum amount 1000đ để tránh lỗi VietQR với số tiền quá nhỏ
    const finalAmount = Math.max(amount, 1000)

    const bank = process.env.SEPAY_BANK || "BIDV"
    const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER
    if (!accountNumber) {
      console.warn("[SePay QR] Missing SEPAY_ACCOUNT_NUMBER", { orderCode, amount })
    }
    const content = `PV${orderCode}` // Nội dung chuyển khoản để match webhook

    if (!accountNumber) {
      return res.status(500).json({ message: "Chưa cấu hình SEPAY_ACCOUNT_NUMBER" })
    }

    // Map tên ngân hàng → BIN (dùng cho VietQR deep link ba=STK@BIN)
    const BANK_BIN_MAP: Record<string, string> = {
      BIDV: "970418",
      VCB: "970436",
      VietinBank: "970415",
      ICB: "970415",
      MB: "970422",
      VPBank: "970432",
      Techcombank: "970407",
      ACB: "970416",
      Sacombank: "970403",
      TPBank: "970423",
      VIB: "970441",
      OCB: "970448",
      HDBank: "970437",
      SHB: "970443",
      MSB: "970426",
      Agribank: "970405",
    }
    const bankBin = process.env.SEPAY_BANK_BIN || BANK_BIN_MAP[bank] || BANK_BIN_MAP[bank.toUpperCase()] || ""

    // Tạo QR code bằng VietQR (tương thích mọi ngân hàng VN)
    const qrUrl = `https://img.vietqr.io/image/${bank}-${accountNumber}-compact2.png?amount=${finalAmount}&addInfo=${encodeURIComponent(content)}&accountName=PHAN VIET`

    return res.json({
      qrUrl,
      bank,
      bankBin,
      accountNumber,
      amount: finalAmount,
      content,
      accountName: "PHAN VIET",
    })

  } catch (err: any) {
    logSePayRouteError("POST failed", err, {
      orderCode: body?.orderCode,
      amount: body?.amount,
    })
    return res.status(500).json({ message: err.message })
  }
}

/**
 * GET /store/sepay/status/:orderCode
 * Kiểm tra trạng thái thanh toán của đơn hàng
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.query as any

  try {
    const orderCode = query.orderCode as string
    console.info("[SePay QR] GET status request", { orderCode })

    if (!orderCode) {
      return res.status(400).json({ message: "Thiếu orderCode" })
    }

    const apiToken = process.env.SEPAY_API_TOKEN
    const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER
    if (!apiToken) {
      console.warn("[SePay QR] Missing SEPAY_API_TOKEN", { orderCode })
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
      const body = await response.text()
      console.error("[SePay QR] SePay API returned non-OK response", {
        orderCode,
        status: response.status,
        statusText: response.statusText,
        body,
      })
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
    logSePayRouteError("GET failed", err, {
      orderCode: query.orderCode,
    })
    return res.json({ paid: false })
  }
}

function getDateMinusMinutes(minutes: number): string {
  const d = new Date(Date.now() - minutes * 60 * 1000)
  return d.toISOString().slice(0, 19).replace("T", " ")
}



