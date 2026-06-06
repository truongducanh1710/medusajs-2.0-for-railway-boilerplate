import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

function setCors(req: MedusaRequest, res: MedusaResponse) {
  const origin = req.headers.origin || ""
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || !origin) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  }
}

export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  setCors(req, res)
  return res.status(204).end()
}

/** Proxy login: nhận email/password, gọi Medusa auth, trả token về cho extension */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  setCors(req, res)
  try {
    const { email, password } = (req.body as any) || {}
    if (!email || !password) return res.status(400).json({ message: "Thiếu email hoặc mật khẩu" })

    const backendUrl = process.env.BACKEND_URL || "http://localhost:9000"
    const authRes = await fetch(`${backendUrl}/auth/user/emailpass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    const data = await authRes.json()
    if (!authRes.ok) return res.status(authRes.status).json({ message: data.message || "Đăng nhập thất bại" })
    return res.json({ token: data.token })
  } catch (err: any) {
    return res.status(500).json({ message: err.message })
  }
}
