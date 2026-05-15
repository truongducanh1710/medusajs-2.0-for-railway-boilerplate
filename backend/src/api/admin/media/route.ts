import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { Client } from "minio"

const VIDEO_EXT = [".mp4", ".mov", ".webm", ".m4v", ".quicktime"]
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]

function getKind(key: string): "video" | "image" | "other" {
  const l = key.toLowerCase()
  if (VIDEO_EXT.some(e => l.endsWith(e))) return "video"
  if (IMAGE_EXT.some(e => l.endsWith(e))) return "image"
  return "other"
}

function getMinioClient() {
  const endpoint  = process.env.MINIO_ENDPOINT!
  const accessKey = process.env.MINIO_ACCESS_KEY!
  const secretKey = process.env.MINIO_SECRET_KEY!
  const bucket    = process.env.MINIO_BUCKET || "medusa-media"

  let host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
  let useSSL = !endpoint.startsWith("http://")
  let port = useSSL ? 443 : 80
  const pm = host.match(/:(\d+)$/)
  if (pm) { port = parseInt(pm[1], 10); host = host.replace(/:\d+$/, "") }

  const client = new Client({
    endPoint: host, port, useSSL,
    accessKey, secretKey,
    pathStyle: true, region: "us-east-1",
  })
  return { client, bucket, host, port, useSSL }
}

function extractKeys(text: string, bucket: string, out: Map<string, Set<string>>, refLabel: string) {
  if (!text) return
  const re = new RegExp(`${bucket.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\/([\\w\\-./]+)`, "g")
  let m
  while ((m = re.exec(text)) !== null) {
    const key = m[1].split("?")[0].split("#")[0]
    if (key && key.length < 500) {
      if (!out.has(key)) out.set(key, new Set())
      out.get(key)!.add(refLabel)
    }
  }
}

function collectFromAny(value: any, bucket: string, out: Map<string, Set<string>>, label: string) {
  if (value == null) return
  if (typeof value === "string") { extractKeys(value, bucket, out, label); return }
  if (typeof value === "object") {
    if (Array.isArray(value)) for (const v of value) collectFromAny(v, bucket, out, label)
    else for (const v of Object.values(value)) collectFromAny(v, bucket, out, label)
  }
}

/**
 * GET /admin/media?kind=video|image|all&filter=used|unused|all&search=
 * Trả về list file trong bucket + flag "in_use" + refs (sản phẩm/page nào đang dùng)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const q = req.query as Record<string, string>
    const kindFilter   = (q.kind ?? "all").toLowerCase()    // video | image | all
    const usedFilter   = (q.filter ?? "all").toLowerCase()  // used | unused | all
    const search       = (q.search ?? "").toLowerCase()

    const { client, bucket, host, port, useSSL } = getMinioClient()
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // 1. List objects
    const objects: Array<{ key: string; size: number; lastModified: Date }> = []
    await new Promise<void>((resolve, reject) => {
      const stream = client.listObjectsV2(bucket, "", true)
      stream.on("data", (obj: any) => {
        if (obj.name) objects.push({
          key: obj.name,
          size: obj.size ?? 0,
          lastModified: obj.lastModified ?? new Date(0),
        })
      })
      stream.on("end", () => resolve())
      stream.on("error", reject)
    })

    // 2. Collect used keys from DB
    const used = new Map<string, Set<string>>()

    try {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "title", "thumbnail", "images.url", "metadata"],
        pagination: { take: 10000 },
      })
      for (const p of products ?? []) {
        const label = `Sản phẩm: ${(p as any).title || (p as any).id}`
        collectFromAny((p as any).thumbnail, bucket, used, label)
        collectFromAny((p as any).images, bucket, used, label)
        collectFromAny((p as any).metadata, bucket, used, label)
      }
    } catch {}

    try {
      const storeModule = req.scope.resolve(Modules.STORE) as any
      const stores = await storeModule.listStores({}, { take: 50 })
      for (const s of stores ?? []) {
        collectFromAny(s.metadata, bucket, used, `Trang chủ (store: ${s.name || s.id})`)
      }
    } catch {}

    try {
      const pageModule = req.scope.resolve("pageModule" as any) as any
      if (pageModule?.listPages) {
        const pages = await pageModule.listPages({}, { take: 1000 })
        for (const pg of pages ?? []) {
          collectFromAny(pg.content, bucket, used, `Page: ${pg.title || pg.slug || pg.id}`)
        }
      }
    } catch {}

    try {
      const { data: collections } = await query.graph({
        entity: "product_collection",
        fields: ["id", "title", "metadata"],
        pagination: { take: 1000 },
      })
      for (const c of collections ?? []) {
        collectFromAny((c as any).metadata, bucket, used, `Collection: ${(c as any).title || (c as any).id}`)
      }
    } catch {}

    try {
      const { data: cats } = await query.graph({
        entity: "product_category",
        fields: ["id", "name", "metadata"],
        pagination: { take: 2000 },
      })
      for (const c of cats ?? []) {
        collectFromAny((c as any).metadata, bucket, used, `Category: ${(c as any).name || (c as any).id}`)
      }
    } catch {}

    // 3. Build response
    const protocol = useSSL ? "https" : "http"
    const portSuffix = (useSSL && port === 443) || (!useSSL && port === 80) ? "" : `:${port}`

    let items = objects.map(o => {
      const kind = getKind(o.key)
      const refs = used.get(o.key)
      const url = `${protocol}://${host}${portSuffix}/${bucket}/${o.key}`
      return {
        key: o.key,
        size: o.size,
        last_modified: o.lastModified,
        kind,
        url,
        in_use: !!refs,
        refs: refs ? Array.from(refs) : [],
      }
    })

    // Filter
    if (kindFilter !== "all") items = items.filter(i => i.kind === kindFilter)
    if (usedFilter === "used")   items = items.filter(i => i.in_use)
    if (usedFilter === "unused") items = items.filter(i => !i.in_use)
    if (search) items = items.filter(i => i.key.toLowerCase().includes(search))

    items.sort((a, b) => b.size - a.size)

    // Summary
    const allObjects = objects.map(o => ({ kind: getKind(o.key), size: o.size, used: used.has(o.key) }))
    const summary = {
      total_count: allObjects.length,
      total_size:  allObjects.reduce((s, x) => s + x.size, 0),
      video: {
        count:        allObjects.filter(x => x.kind === "video").length,
        size:         allObjects.filter(x => x.kind === "video").reduce((s, x) => s + x.size, 0),
        unused_count: allObjects.filter(x => x.kind === "video" && !x.used).length,
        unused_size:  allObjects.filter(x => x.kind === "video" && !x.used).reduce((s, x) => s + x.size, 0),
      },
      image: {
        count:        allObjects.filter(x => x.kind === "image").length,
        size:         allObjects.filter(x => x.kind === "image").reduce((s, x) => s + x.size, 0),
        unused_count: allObjects.filter(x => x.kind === "image" && !x.used).length,
        unused_size:  allObjects.filter(x => x.kind === "image" && !x.used).reduce((s, x) => s + x.size, 0),
      },
      filtered_count: items.length,
    }

    return res.json({ items, summary })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * DELETE /admin/media
 * Body: { keys: string[] }
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { keys } = req.body as { keys: string[] }
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "Body phải có { keys: string[] }" })
    }
    if (keys.length > 500) {
      return res.status(400).json({ error: "Tối đa 500 file mỗi lần" })
    }

    const { client, bucket } = getMinioClient()
    const errors: Array<{ key: string; error: string }> = []
    let deleted = 0

    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100)
      try {
        await client.removeObjects(bucket, batch)
        deleted += batch.length
      } catch (err: any) {
        for (const k of batch) errors.push({ key: k, error: err.message })
      }
    }

    return res.json({ ok: true, deleted, errors })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
