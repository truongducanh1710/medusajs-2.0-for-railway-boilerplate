export function extractHtml(components: any[]): string {
  if (!components) return ""

  return components
    .map((component: any) => {
      if (component.type === "textnode") {
        return component.content || ""
      }

      const tag = component.tagName || "div"
      const attrs = Object.entries(component.attributes || {})
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ")
      const style = component.style
        ? ` style="${Object.entries(component.style)
            .map(([key, value]) => `${key}:${value}`)
            .join(";")}"`
        : ""
      const inner = extractHtml(component.components || [])

      return `<${tag}${attrs ? ` ${attrs}` : ""}${style}>${inner}</${tag}>`
    })
    .join("")
}

export function parseGrapesContent(content?: string | null): string {
  if (!content) return ""

  try {
    const projectData = JSON.parse(content)
    const components =
      projectData?.pages?.[0]?.frames?.[0]?.component?.components

    if (components) {
      return extractHtml(components)
    }

    if (projectData?.html) {
      return projectData.html
    }
  } catch {
    return content
  }

  return content
}
