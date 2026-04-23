import { revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

export const POST = async (req: NextRequest) => {
  const secret = req.headers.get("x-revalidate-secret")
  if (secret !== (process.env.REVALIDATE_SECRET || "phanviet-revalidate")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { tags } = await req.json().catch(() => ({ tags: ["products"] }))
  const tagList: string[] = Array.isArray(tags) ? tags : ["products"]
  tagList.forEach(tag => revalidateTag(tag))

  return NextResponse.json({ revalidated: true, tags: tagList })
}
