import { Metadata } from "next"
import { notFound } from "next/navigation"

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

  // Parse GrapesJS JSON and extract HTML
  let html = ""
  try {
    const projectData = JSON.parse(page.content)
    // GrapesJS stores HTML in pages[0].frames[0].component
    const components = projectData?.pages?.[0]?.frames?.[0]?.component?.components
    if (components) {
      html = extractHtml(components)
    } else if (projectData?.html) {
      html = projectData.html
    }
  } catch {
    html = page.content
  }

  return (
    <div className="min-h-screen">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function extractHtml(components: any[]): string {
  if (!components) return ""
  return components
    .map((c: any) => {
      if (c.type === "textnode") return c.content || ""
      const tag = c.tagName || "div"
      const attrs = Object.entries(c.attributes || {})
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")
      const style = c.style
        ? ` style="${Object.entries(c.style).map(([k, v]) => `${k}:${v}`).join(";")}"`
        : ""
      const inner = extractHtml(c.components || [])
      return `<${tag} ${attrs}${style}>${inner}</${tag}>`
    })
    .join("")
}
