import { parseGrapesContent } from "@lib/grapes"

const MOBILE_OVERRIDE_CSS = `
@media(max-width:639px){
  .pvb-how .steps{display:flex!important;flex-direction:column!important;gap:12px!important}
  .pvb-how .step{display:flex!important;align-items:center!important;gap:16px!important;text-align:left!important;padding:14px 16px!important}
  .pvb-how .num{min-width:44px!important;width:44px!important;height:44px!important;margin:0!important}
  .pvb-ps .inner{display:flex!important;flex-direction:column!important;gap:16px!important}
  .pvb-ben .grid{grid-template-columns:1fr 1fr!important}
  .pvb-gal .grid{grid-template-columns:1fr 1fr!important}
}
`

type Props = {
  content: string
}

export default function ProductPageContent({ content }: Props) {
  const html = parseGrapesContent(content)

  if (!html) {
    return null
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MOBILE_OVERRIDE_CSS }} />
      <div
        className="product-page-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  )
}
