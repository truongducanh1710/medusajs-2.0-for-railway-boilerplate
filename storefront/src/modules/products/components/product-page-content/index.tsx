import { parseGrapesContent } from "@lib/grapes"

const MOBILE_OVERRIDE_CSS = `
/* ── Product Page Builder: mobile overrides (≤639px) ── */
@media(max-width:639px){
  /* How-to-use: 4-col grid → flex column */
  .pvb-how .steps{display:flex!important;flex-direction:column!important;gap:10px!important}
  .pvb-how .step{display:flex!important;flex-direction:row!important;align-items:center!important;gap:14px!important;text-align:left!important;padding:12px 14px!important}
  .pvb-how .num{min-width:40px!important;width:40px!important;height:40px!important;margin:0!important;flex-shrink:0!important}
  .pvb-how h3,.pvb-how p{text-align:left!important}

  /* Pain/Solution: 2-col → 1-col */
  .pvb-ps .inner{display:flex!important;flex-direction:column!important;gap:14px!important}
  .pvb-ps .col{width:100%!important}

  /* Benefits: 4-col → 2-col */
  .pvb-ben .grid{grid-template-columns:1fr 1fr!important;gap:12px!important}

  /* Gallery: 3-col → 2-col */
  .pvb-gal .grid{grid-template-columns:1fr 1fr!important;gap:8px!important}

  /* Image-text left/right: side-by-side → stack */
  .pvb-itl .inner,.pvb-itr .inner{display:flex!important;flex-direction:column!important;gap:16px!important}
  .pvb-itl img.img,.pvb-itr img.img{width:100%!important;min-height:200px!important}

  /* Hero banner: reduce padding, smaller text */
  .pvb-hero{padding:40px 16px!important}
  .pvb-hero h1{font-size:1.6rem!important;line-height:1.3!important}
  .pvb-hero p{font-size:0.95rem!important}

  /* Comparison table: allow horizontal scroll */
  .pvb-cmp{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
  .pvb-cmp table{min-width:340px!important;font-size:0.8rem!important}
  .pvb-cmp td,.pvb-cmp th{padding:8px 10px!important}

  /* Reviews: 3-col → 1-col */
  .pvb-rev .grid{display:flex!important;flex-direction:column!important;gap:12px!important}

  /* Trust badges: allow wrap */
  .pvb-trust .inner{flex-wrap:wrap!important;gap:12px!important;justify-content:center!important}
  .pvb-trust .badge{min-width:80px!important}

  /* Countdown: shrink digit boxes */
  .pvb-cd .box{min-width:56px!important;padding:8px 4px!important}
  .pvb-cd .dig{font-size:2rem!important}

  /* Promo banner: smaller padding */
  .pvb-promo{padding:32px 16px!important}
  .pvb-promo h2{font-size:1.4rem!important}
}

/* ── tablet (640–1023px): minor tweaks ── */
@media(min-width:640px) and (max-width:1023px){
  .pvb-how .steps{grid-template-columns:1fr 1fr!important}
  .pvb-ben .grid{grid-template-columns:1fr 1fr!important}
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
