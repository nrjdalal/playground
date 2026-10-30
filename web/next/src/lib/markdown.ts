import { defaultUrlTransform, type UrlTransform } from "streamdown"

// The images a transcript may load: a file the dashboard keeps, served at this path by our own API (its /api/v1 path, or the old one a transcript written before the move holds) under the only names it gives an image (a random UUID and an image extension, as api/hono's attachments.ts names them), and a preview image an agent made, by a name the Previews app serves (as api/hono's previews.ts checks them, with no ..); a test holds each to the API's. Any other URL would be a request the page makes on a session's say, which can carry data out in its URL or tell whoever serves it that the page was opened.
const ATTACHMENT_PATH =
  /^\/api\/(?:v1|desk)\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:gif|jpg|png|webp)$/
const PREVIEW_PATH =
  /^\/api\/(?:v1\/)?apps\/previews\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:gif|png|webp)$/

const isOwnImagePath = (path: string): boolean =>
  ATTACHMENT_PATH.test(path) || (PREVIEW_PATH.test(path) && !path.includes(".."))

// src as an absolute URL when it names one of our own attachments or preview images on one of our origins, else null. A relative src resolves against the first origin.
export function ownImageSrc(src: string, origins: string[]): string | null {
  const base = origins[0]
  if (!base) return null
  let url: URL
  try {
    url = new URL(src, base)
  } catch {
    return null
  }
  if (!origins.some((origin) => new URL(origin).origin === url.origin)) return null
  if (url.username || url.password || url.search || url.hash) return null
  return isOwnImagePath(url.pathname) ? url.href : null
}

export type TranscriptLink = { external: boolean; href: string }

// A link in transcript text is a fragment, kept as it is, or opens only over http or https, resolved the way the browser would against the page's own origin (app), so "//host" and "/\host" read as the other host they reach; anything else (javascript:, data:, file:, mailto:, a URL with credentials, one that does not parse) is null. external is true unless it lands on app's own origin.
export function transcriptLink(href: string, app: string): TranscriptLink | null {
  if (href.startsWith("#")) return { external: false, href }
  let url: URL
  try {
    url = new URL(href, app)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null
  return { external: url.origin !== new URL(app).origin, href: url.href }
}

// Streamdown's urlTransform for transcript text: an image's or a <source>'s URL passes only when it is one of our own attachments or preview images, any href only through transcriptLink, and every other URL goes through Streamdown's own check. It sees src but not srcset, so a renderer also takes TRANSCRIPT_COMPONENTS (components/transcript-markdown.tsx).
export const transcriptUrls =
  (origins: string[], app: string): UrlTransform =>
  (url, key, node) => {
    if (node.tagName === "img" || node.tagName === "source") return ownImageSrc(url, origins)
    if (key === "href") return transcriptLink(url, app)?.href ?? null
    return defaultUrlTransform(url, key, node)
  }

// The HTML tree as rehype hands it over, as far as rehypeCallouts reads it.
type HastNode = {
  children?: HastNode[]
  properties?: Record<string, unknown>
  tagName?: string
  type: string
  value?: string
}

// GitHub's callout markers, each opening a quote's first line (> [!NOTE]), as a transcript may write them.
const CALLOUT_MARKER = /^\s*\[!(CAUTION|IMPORTANT|NOTE|TIP|WARNING)\][ \t]*/

function markCallout(quote: HastNode): void {
  const first = quote.children?.find((child) => child.type === "element")
  const kids = first?.tagName === "p" ? (first.children ?? []) : []
  const lead = kids[0]
  const match = lead?.type === "text" ? CALLOUT_MARKER.exec(lead.value ?? "") : null
  if (!lead || !match?.[1]) return
  lead.value = (lead.value ?? "").slice(match[0].length)
  if (!lead.value) {
    kids.shift()
    if (kids[0]?.tagName === "br") kids.shift()
    if (kids[0]?.type === "text") kids[0].value = kids[0].value?.trimStart()
  }
  if (!kids.some((kid) => kid.type !== "text" || kid.value?.trim()))
    quote.children = quote.children?.filter((child) => child !== first)
  quote.properties = { ...quote.properties, dataCallout: match[1].toLowerCase() }
}

function walkCallouts(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (child.tagName === "blockquote") {
      delete child.properties?.dataCallout
      markCallout(child)
    }
    walkCallouts(child)
  }
}

// A rehype step run after Streamdown's sanitising: a quote whose first line is a callout marker loses the marker and the line break after it, and is marked data-callout with its kind in lowercase. Every other quote is left as it is, and no quote keeps a data-callout it did not earn here.
export const rehypeCallouts = () => (tree: HastNode) => walkCallouts(tree)
