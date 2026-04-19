import { parseGrapesContent } from "@lib/grapes"

type Props = {
  content: string
}

export default function ProductPageContent({ content }: Props) {
  const html = parseGrapesContent(content)

  if (!html) {
    return null
  }

  return (
    <div
      className="product-page-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
