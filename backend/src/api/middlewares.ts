import { defineMiddlewares } from "@medusajs/medusa"
import { NextFunction, Request, Response } from "express"

// Re-parse JSON body with 100MB limit for our custom page-content route.
// This runs BEFORE Medusa's own body-parser on this specific path.
function largeJsonBody(limit: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers["content-type"]?.includes("application/json")) return next()
    let data = ""
    let size = 0
    const maxBytes = parseInt(limit) * 1024 * 1024
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk)
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
      middlewares: [largeJsonBody("100")],
    },
  ],
})
