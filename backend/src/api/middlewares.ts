import { defineMiddlewares } from "@medusajs/medusa"

function largeJsonBody(limitMB: number) {
  const maxBytes = limitMB * 1024 * 1024
  return (req: any, res: any, next: any) => {
    if (!req.headers["content-type"]?.includes("application/json")) return next()
    // Body already parsed by Medusa's body-parser — skip
    if (req.body !== undefined) return next()
    let data = ""
    let size = 0
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8")
      if (size > maxBytes) {
        res.status(413).json({ error: "Payload too large" })
        return
      }
      data += chunk
    })
    req.on("end", () => {
      if (data) {
        try { req.body = JSON.parse(data) } catch { /* leave as-is */ }
      }
      next()
    })
    req.on("error", next)
  }
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/product-content",
      middlewares: [largeJsonBody(100)],
    },
  ],
})
