// Allowlist of safe HTML tags for GrapesJS output
const ALLOWED_TAGS = new Set([
  "div","span","p","a","img","br","hr","h1","h2","h3","h4","h5","h6",
  "ul","ol","li","table","thead","tbody","tr","th","td","section","article",
  "header","footer","main","nav","figure","figcaption","blockquote","strong",
  "em","b","i","u","s","small","sup","sub","button","input","label",
  "iframe","source","video",
])

// Allowlist of safe attributes
const ALLOWED_ATTRS = new Set([
  "class","id","style","href","src","alt","title","width","height","target",
  "rel","type","placeholder","name","value","controls","autoplay","muted","loop",
  "allowfullscreen","frameborder","loading","decoding","srcset","sizes",
])

// Strip dangerous CSS patterns (javascript:, expression(), behavior:)
function sanitizeCssValue(val: string): string {
  return /javascript:|expression\s*\(|behavior\s*:/i.test(val) ? "" : val
}

// Sanitize inline style string
function sanitizeStyle(styleStr: string): string {
  return styleStr
    .split(";")
    .map(rule => {
      const [prop, ...rest] = rule.split(":")
      const val = rest.join(":")
      if (!prop || !val) return ""
      return `${prop.trim()}: ${sanitizeCssValue(val.trim())}`
    })
    .filter(Boolean)
    .join("; ")
}

// Escape attribute values to prevent injection
function escapeAttr(val: string): string {
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function extractHtml(components: any[]): string {
  if (!components) return ""

  return components
    .map((component: any) => {
      if (component.type === "textnode") {
        return component.content || ""
      }

      const tag = (component.tagName || "div").toLowerCase()

      // Skip disallowed tags entirely
      if (!ALLOWED_TAGS.has(tag)) return ""

      // Build safe attrs
      const attrEntries = Object.entries(component.attributes || {}).filter(
        ([key]) => {
          const k = key.toLowerCase()
          // Block event handlers and javascript: hrefs
          if (k.startsWith("on")) return false
          if (!ALLOWED_ATTRS.has(k)) return false
          return true
        }
      )

      // Extra check: sanitize href/src values
      const safeAttrs = attrEntries.map(([key, value]) => {
        const v = String(value)
        if (key === "href" || key === "src") {
          if (/^javascript:/i.test(v.trim())) return `${key}="#"`
        }
        return `${key}="${escapeAttr(v)}"`
      })

      const attrs = safeAttrs.length ? ` ${safeAttrs.join(" ")}` : ""

      // Build safe style
      const styleObj = component.style || {}
      const styleStr = Object.entries(styleObj)
        .map(([key, value]) => `${key}: ${sanitizeCssValue(String(value))}`)
        .join("; ")
      const style = styleStr ? ` style="${escapeAttr(sanitizeStyle(styleStr))}"` : ""

      const inner = extractHtml(component.components || [])

      const voidTags = ["img", "br", "hr", "input", "link", "meta", "source"]
      if (voidTags.includes(tag)) {
        return `<${tag}${attrs}${style} />`
      }

      return `<${tag}${attrs}${style}>${inner}</${tag}>`
    })
    .join("")
}

export function parseGrapesContent(content?: string | null): string {
  if (!content) return ""

  try {
    const data = JSON.parse(content)

    // New format: {html, css, projectData}
    if (data.html !== undefined) {
      const css = data.css
        ? `<style>${data.css}</style>`
        : ""
      return css + data.html
    }

    // Old format: raw GrapesJS projectData JSON
    const components =
      data?.pages?.[0]?.frames?.[0]?.component?.components

    if (components) {
      return extractHtml(components)
    }
  } catch {
    // Plain HTML string fallback
    return content
  }

  return content
}
