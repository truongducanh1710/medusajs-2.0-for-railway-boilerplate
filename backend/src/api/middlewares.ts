import { defineMiddlewares } from "@medusajs/medusa"

// Parse multipart/form-data manually without external dependency.
// Used for /admin/product-content to bypass Medusa's 1MB JSON body limit.
function parseMultipart() {
  return (req: any, res: any, next: any) => {
    const ct: string = req.headers["content-type"] || ""
    if (!ct.includes("multipart/form-data")) return next()

    const boundary = ct.split("boundary=")[1]?.trim()
    if (!boundary) return next()

    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8")
        const parts = raw.split(`--${boundary}`)
        const fields: Record<string, string> = {}

        for (const part of parts) {
          const match = part.match(/Content-Disposition: form-data; name="([^"]+)"\r?\n\r?\n([\s\S]*?)(\r?\n)?$/)
          if (match) {
            fields[match[1]] = match[2]
          }
        }

        req.body = fields
      } catch { /* leave body as-is */ }
      next()
    })
    req.on("error", next)
  }
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/product-content",
      middlewares: [parseMultipart()],
    },
  ],
})
