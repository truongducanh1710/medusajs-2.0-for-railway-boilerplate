export function extractHtml(components: any[]): string {
  if (!components) return ""

  return components
    .map((component: any) => {
      if (component.type === "textnode") {
        return component.content || ""
      }

      const tag = component.tagName || "div"

      // Build attrs excluding style (GrapesJS stores style separately)
      const attrEntries = Object.entries(component.attributes || {}).filter(
        ([key]) => key !== "style"
      )
      const attrs = attrEntries
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ")

      // Build style from component.style object (GrapesJS parsed inline style into this)
      const styleObj = component.style || {}
      const styleStr = Object.entries(styleObj)
        .map(([key, value]) => `${key}: ${value}`)
        .join("; ")
      const style = styleStr ? ` style="${styleStr}"` : ""

      const inner = extractHtml(component.components || [])

      // HTML void elements (self-closing, no children)
      const voidTags = ["img", "br", "hr", "input", "link", "meta", "source"]
      if (voidTags.includes(tag)) {
        return `<${tag}${attrs ? ` ${attrs}` : ""}${style} />`
      }

      return `<${tag}${attrs ? ` ${attrs}` : ""}${style}>${inner}</${tag}>`
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
