import { Metadata } from "next"
import { notFound } from "next/navigation"
import { parseGrapesContent } from "@lib/grapes"

type Props = {
  params: Promise<{ slug: string; countryCode: string }>
}

async function getPage(slug: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/pages/${slug}`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.page
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await getPage(slug)
  return {
    title: page?.title ?? "Trang không tìm thấy",
  }
}

export default async function CustomPage({ params }: Props) {
  const { slug } = await params
  const page = await getPage(slug)

  if (!page) return notFound()

  const html = parseGrapesContent(page.content)

  return (
    <div className="min-h-screen">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
