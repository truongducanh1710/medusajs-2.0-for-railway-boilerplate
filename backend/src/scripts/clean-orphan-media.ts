/**
 * Quét MinIO bucket → tìm file không còn được tham chiếu trong DB
 * → liệt kê (dry-run) hoặc xoá.
 *
 * Chạy:
 *   pnpm exec medusa exec ./src/scripts/clean-orphan-media.ts          # dry-run, show top 50
 *   pnpm exec medusa exec ./src/scripts/clean-orphan-media.ts --all    # dry-run, show tất cả
 *   pnpm exec medusa exec ./src/scripts/clean-orphan-media.ts --delete # XOÁ thật (cần --confirm)
 *   pnpm exec medusa exec ./src/scripts/clean-orphan-media.ts --delete --confirm
 *
 * Args qua biến môi trường (vì medusa exec không pass argv tiện):
 *   CLEAN_MODE=delete CLEAN_CONFIRM=1 pnpm exec medusa exec ./src/scripts/clean-orphan-media.ts
 *   CLEAN_LIMIT=200       — số file orphan in ra (default 50)
 *   CLEAN_ONLY=video      — chỉ xét file video (mp4/mov/webm). Default all.
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { Client } from "minio"

const MODE        = (process.env.CLEAN_MODE ?? "dry").toLowerCase()      // dry | delete
const CONFIRM     = process.env.CLEAN_CONFIRM === "1"
const SHOW_LIMIT  = Number(process.env.CLEAN_LIMIT ?? "50")
const ONLY        = (process.env.CLEAN_ONLY ?? "").toLowerCase()         // "video" | "image" | ""

const VIDEO_EXT = [".mp4", ".mov", ".webm", ".m4v", ".quicktime"]
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]

function isVideo(key: string) {
  const lower = key.toLowerCase()
  return VIDEO_EXT.some(e => lower.endsWith(e))
}
function isImage(key: string) {
  const lower = key.toLowerCase()
  return IMAGE_EXT.some(e => lower.endsWith(e))
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Quét toàn bộ string trong object → extract tất cả "key" của file trong bucket.
 * URL có thể có dạng:
 *   https://minio.example.com/medusa-media/abc-01HXX.mp4
 *   /medusa-media/abc-01HXX.mp4
 *   abc-01HXX.mp4 (rare)
 * → ta extract phần sau "{bucket}/"
 */
function extractKeys(text: string, bucket: string, out: Set<string>) {
  if (!text) return
  // Match: bucket/<anything cho đến khi gặp ký tự không hợp lệ>
  const re = new RegExp(`${bucket.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\/([\\w\\-./]+)`, "g")
  let m
  while ((m = re.exec(text)) !== null) {
    // Strip query string nếu có
    const key = m[1].split("?")[0].split("#")[0]
    if (key && key.length < 500) out.add(key)
  }
}

function collectFromAny(value: any, bucket: string, out: Set<string>) {
  if (value == null) return
  if (typeof value === "string") {
    extractKeys(value, bucket, out)
    return
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      for (const v of value) collectFromAny(v, bucket, out)
    } else {
      for (const v of Object.values(value)) collectFromAny(v, bucket, out)
    }
  }
}

export default async function cleanOrphanMedia({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query  = container.resolve(ContainerRegistrationKeys.QUERY)

  // ---- MinIO config từ env ----
  const endpoint  = process.env.MINIO_ENDPOINT
  const accessKey = process.env.MINIO_ACCESS_KEY
  const secretKey = process.env.MINIO_SECRET_KEY
  const bucket    = process.env.MINIO_BUCKET || "medusa-media"

  if (!endpoint || !accessKey || !secretKey) {
    logger.error("Thiếu MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY trong env")
    return
  }

  // Parse endpoint (giống logic trong minio-file/service.ts)
  let host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
  let useSSL = !endpoint.startsWith("http://")
  let port = useSSL ? 443 : 80
  const pm = host.match(/:(\d+)$/)
  if (pm) { port = parseInt(pm[1], 10); host = host.replace(/:\d+$/, "") }

  const minio = new Client({
    endPoint: host, port, useSSL,
    accessKey, secretKey,
    pathStyle: true, region: "us-east-1",
  })

  logger.info(`\n=== CLEAN ORPHAN MEDIA — ${MODE === "delete" ? "🔥 DELETE MODE" : "🔍 DRY-RUN"} ===`)
  logger.info(`Bucket: ${bucket} @ ${host}:${port} (SSL: ${useSSL})`)
  if (ONLY) logger.info(`Filter: only ${ONLY}`)

  // ---- 1. Liệt kê tất cả objects trong bucket ----
  logger.info(`\n[1/3] Đang liệt kê objects trong bucket...`)
  const allObjects: Array<{ key: string; size: number; lastModified: Date }> = []

  await new Promise<void>((resolve, reject) => {
    const stream = minio.listObjectsV2(bucket, "", true)
    stream.on("data", (obj: any) => {
      if (obj.name) {
        allObjects.push({
          key: obj.name,
          size: obj.size ?? 0,
          lastModified: obj.lastModified ?? new Date(0),
        })
      }
    })
    stream.on("end", () => resolve())
    stream.on("error", (err) => reject(err))
  })

  logger.info(`   → Tổng cộng ${allObjects.length} objects, ${formatBytes(allObjects.reduce((s, o) => s + o.size, 0))}`)

  // ---- 2. Thu thập tất cả URL/key đang dùng trong DB ----
  logger.info(`\n[2/3] Đang quét DB để tìm key đang dùng...`)
  const usedKeys = new Set<string>()

  // (a) Products: thumbnail, images, metadata (page_content + draft + versions + backup)
  try {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "thumbnail", "images.url", "metadata"],
      pagination: { take: 10000 },
    })
    for (const p of products ?? []) {
      collectFromAny((p as any).thumbnail, bucket, usedKeys)
      collectFromAny((p as any).images, bucket, usedKeys)
      collectFromAny((p as any).metadata, bucket, usedKeys)
    }
    logger.info(`   → Quét ${products?.length ?? 0} products`)
  } catch (e: any) {
    logger.warn(`   Lỗi quét products: ${e.message}`)
  }

  // (b) Store metadata (homepage settings)
  try {
    const storeModule = container.resolve(Modules.STORE) as any
    const stores = await storeModule.listStores({}, { take: 50 })
    for (const s of stores ?? []) {
      collectFromAny(s.metadata, bucket, usedKeys)
    }
    logger.info(`   → Quét ${stores?.length ?? 0} stores (homepage settings)`)
  } catch (e: any) {
    logger.warn(`   Lỗi quét stores: ${e.message}`)
  }

  // (c) Pages module
  try {
    const pageModule = container.resolve("pageModule" as any) as any
    if (pageModule?.listPages) {
      const pages = await pageModule.listPages({}, { take: 1000 })
      for (const pg of pages ?? []) {
        collectFromAny(pg.content, bucket, usedKeys)
      }
      logger.info(`   → Quét ${pages?.length ?? 0} pages (CMS)`)
    }
  } catch (e: any) {
    logger.info(`   (Không có pageModule hoặc lỗi: ${e.message})`)
  }

  // (d) Collections, categories — có thể chứa banner
  try {
    const { data: collections } = await query.graph({
      entity: "product_collection",
      fields: ["id", "metadata"],
      pagination: { take: 1000 },
    })
    for (const c of collections ?? []) collectFromAny((c as any).metadata, bucket, usedKeys)
    logger.info(`   → Quét ${collections?.length ?? 0} collections`)
  } catch {}

  try {
    const { data: cats } = await query.graph({
      entity: "product_category",
      fields: ["id", "metadata"],
      pagination: { take: 2000 },
    })
    for (const c of cats ?? []) collectFromAny((c as any).metadata, bucket, usedKeys)
    logger.info(`   → Quét ${cats?.length ?? 0} categories`)
  } catch {}

  logger.info(`   → Tổng ${usedKeys.size} key đang được tham chiếu trong DB`)

  // ---- 3. So sánh, tách orphan ----
  logger.info(`\n[3/3] So sánh để tìm orphan...`)
  const orphans = allObjects.filter(o => !usedKeys.has(o.key))
  const filtered = ONLY === "video"
    ? orphans.filter(o => isVideo(o.key))
    : ONLY === "image"
      ? orphans.filter(o => isImage(o.key))
      : orphans

  const totalSize  = orphans.reduce((s, o) => s + o.size, 0)
  const videoCount = orphans.filter(o => isVideo(o.key)).length
  const videoSize  = orphans.filter(o => isVideo(o.key)).reduce((s, o) => s + o.size, 0)
  const imageCount = orphans.filter(o => isImage(o.key)).length
  const imageSize  = orphans.filter(o => isImage(o.key)).reduce((s, o) => s + o.size, 0)
  const otherCount = orphans.length - videoCount - imageCount

  logger.info(`\n========================================`)
  logger.info(`📊 KẾT QUẢ`)
  logger.info(`========================================`)
  logger.info(`Tổng object trong bucket : ${allObjects.length}`)
  logger.info(`Đang dùng                : ${allObjects.length - orphans.length}`)
  logger.info(`🗑️  ORPHAN                : ${orphans.length} (${formatBytes(totalSize)})`)
  logger.info(`   - Video orphan        : ${videoCount} (${formatBytes(videoSize)})`)
  logger.info(`   - Ảnh orphan          : ${imageCount} (${formatBytes(imageSize)})`)
  logger.info(`   - Khác                : ${otherCount}`)

  // Sort orphan giảm dần theo size
  filtered.sort((a, b) => b.size - a.size)
  const showList = filtered.slice(0, SHOW_LIMIT)

  logger.info(`\n📋 Top ${showList.length} orphan${ONLY ? ` (${ONLY})` : ""} (sort theo size):`)
  for (const o of showList) {
    const age = Math.floor((Date.now() - o.lastModified.getTime()) / (1000 * 60 * 60 * 24))
    logger.info(`   ${formatBytes(o.size).padStart(10)}  ${age}d  ${o.key}`)
  }
  if (filtered.length > SHOW_LIMIT) {
    logger.info(`   ... và ${filtered.length - SHOW_LIMIT} file nữa (set CLEAN_LIMIT=N để xem thêm)`)
  }

  // ---- DELETE MODE ----
  if (MODE !== "delete") {
    logger.info(`\n💡 Đây là DRY-RUN. Để xoá thật:`)
    logger.info(`   CLEAN_MODE=delete CLEAN_CONFIRM=1 pnpm exec medusa exec ./src/scripts/clean-orphan-media.ts`)
    logger.info(`   (thêm CLEAN_ONLY=video để chỉ xoá video orphan)`)
    return
  }

  if (!CONFIRM) {
    logger.warn(`\n⚠️  CLEAN_MODE=delete nhưng thiếu CLEAN_CONFIRM=1 → KHÔNG xoá để an toàn.`)
    return
  }

  const toDelete = filtered
  logger.warn(`\n🔥 BẮT ĐẦU XOÁ ${toDelete.length} file (${formatBytes(toDelete.reduce((s, o) => s + o.size, 0))})...`)

  let ok = 0, fail = 0
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100)
    try {
      await minio.removeObjects(bucket, batch.map(o => o.key))
      ok += batch.length
      logger.info(`   ✓ Đã xoá ${ok}/${toDelete.length}`)
    } catch (err: any) {
      fail += batch.length
      logger.error(`   ✗ Lỗi batch: ${err.message}`)
    }
  }

  logger.info(`\n✅ Hoàn tất: xoá thành công ${ok}, lỗi ${fail}`)
}
