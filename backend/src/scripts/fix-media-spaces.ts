/**
 * Script: fix-media-spaces
 * Đổi tên file MinIO có dấu cách → dùng dấu gạch ngang, update DB
 * Chạy: medusa exec ./src/scripts/fix-media-spaces.ts
 */
import { Client } from "minio"
import { Pool } from "pg"

export default async function fixMediaSpaces() {
  const endPoint = (process.env.MINIO_ENDPOINT ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "")
  const accessKey = process.env.MINIO_ACCESS_KEY ?? ""
  const secretKey = process.env.MINIO_SECRET_KEY ?? ""
  const bucket = process.env.MINIO_BUCKET ?? "medusa-media"
  const useSSL = (process.env.MINIO_ENDPOINT ?? "").startsWith("https")

  const minio = new Client({ endPoint, useSSL, accessKey, secretKey })
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  // Lấy tất cả thumbnail có dấu cách
  const { rows } = await pool.query(`
    SELECT id, title, thumbnail FROM product
    WHERE thumbnail LIKE '% %' AND deleted_at IS NULL
  `)

  console.log(`Tìm thấy ${rows.length} sản phẩm cần fix`)

  for (const row of rows) {
    const oldUrl: string = row.thumbnail
    // Tách key từ URL: bỏ phần host + bucket
    const urlObj = new URL(oldUrl)
    // pathname dạng /medusa-media/LAUU 2-xxx.png hoặc /bucket/key
    const parts = urlObj.pathname.replace(/^\//, "").split("/")
    // parts[0] có thể là bucket name hoặc thẳng là key
    const oldKey = parts[0] === bucket ? parts.slice(1).join("/") : parts.join("/")
    const newKey = oldKey.replace(/\s+/g, "-")

    if (oldKey === newKey) {
      console.log(`  Skip: ${oldKey}`)
      continue
    }

    console.log(`\n[${row.title}]`)
    console.log(`  old: ${oldKey}`)
    console.log(`  new: ${newKey}`)

    try {
      // MinIO copyObject: src phải là "/bucket/key"
      await minio.copyObject(bucket, newKey, `/${bucket}/${oldKey}`, null as any)
      console.log(`  ✓ copied`)

      await minio.removeObject(bucket, oldKey)
      console.log(`  ✓ deleted old`)

      // Tạo URL mới — giữ nguyên host, chỉ thay key
      const newUrl = oldUrl.replace(encodeURIComponent(oldKey).replace(/%20/g, "%20"), encodeURIComponent(newKey))
        || oldUrl.replace(oldKey, newKey)
      // Cách đơn giản: thay thẳng string
      const fixedUrl = oldUrl.includes(oldKey)
        ? oldUrl.replace(oldKey, newKey)
        : `${urlObj.origin}/${bucket}/${newKey}`

      await pool.query(`UPDATE product SET thumbnail = $1 WHERE id = $2`, [fixedUrl, row.id])
      console.log(`  ✓ DB: ${fixedUrl}`)
    } catch (err: any) {
      console.error(`  ✗ ${err.message}`)
    }
  }

  await pool.end()
  console.log("\nXong!")
}
