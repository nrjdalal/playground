import { type Browser, type Result, type Target, VIEWPORTS } from "./checks"

// A screen recorder's node as Scrnli 4.3.9 adds it (js/video-recorder-content.js, run at document_start, line 29: `document.body.appendChild(a)` once body exists and its CSS loads): a div#scrnli_recorder_root holding an open shadow root, put into body while the page still streams. It goes where the owner's hydration error showed it, after body's first script, the theme script, and before the shell, and records the body-level tags before it, since a client render removes it again. Put first in body it still fails, on Next's own hidden metadata div, which no layout of ours can move.
export const EXTENSION_NODE_SCRIPT = `(() => {
  const node = document.createElement("div")
  node.id = "scrnli_recorder_root"
  node.attachShadow({ mode: "open" }).append(document.createElement("div"))
  new MutationObserver((_, observer) => {
    const script = document.body?.querySelector(":scope > script")
    if (!script) return
    observer.disconnect()
    script.after(node)
    window.__extensionNode = [...document.body.children].slice(0, [...document.body.children].indexOf(node)).map((el) => el.tagName.toLowerCase())
  }).observe(document, { childList: true, subtree: true })
})()`

// What a load left: the body-level tags before the node (null when it never landed) and Next's dev overlay, its issue count and their labels (null when the page has no overlay to read).
export type ExtensionNodeRead = {
  before: string[] | null
  issues: { count: number; labels: string[] } | null
}

// React keys every node it owns with a __reactFiber property, once it hydrates the page or renders it again.
const HYDRATED = `(() => { const page = document.querySelector("[data-dashboard-page]"); return !!document.querySelector("nextjs-portal") && !!page && Object.keys(page).some((key) => key.startsWith("__reactFiber")) })()`

const READ = `(() => { const overlay = document.querySelector("nextjs-portal")?.shadowRoot; return { before: window.__extensionNode ?? null, issues: overlay ? { count: Number(overlay.querySelector("[data-issues-count]")?.textContent ?? 0), labels: [...overlay.querySelectorAll("[data-nextjs-error-label-group]")].map((label) => label.textContent.trim()) } : null } })()`

// Pure: a page passes when the node landed and Next's overlay counts no issue, since a hydration error shows there and not in the console.
export const extensionNodeResult = (route: string, read: ExtensionNodeRead): Result => {
  const check = `extension-node ${route}`
  if (!read.before) return { check, detail: "the node never landed in body", ok: false }
  if (!read.issues)
    return { check, detail: "no Next.js dev overlay to read issues from", ok: false }
  const at = `after ${read.before.join(" ")}`
  return read.issues.count
    ? {
        check,
        detail: `${read.issues.count} issue${read.issues.count === 1 ? "" : "s"} in Next's overlay with the node ${at}${read.issues.labels.length ? `: ${read.issues.labels.join(", ")}` : ""}`,
        ok: false,
      }
    : { check, detail: `hydrates clean with the node ${at}`, ok: true }
}

// Loads the page at 1280 with the node added (the browser's init script) and reads the overlay a second after React owns the page: the server's HTML draws the page's words before hydration, so the wait is on the React fiber hydration puts on its node, and on the overlay that reports what hydration found.
export const extensionNode = async (
  browser: Browser,
  { web }: Target,
  route: string,
): Promise<Result> => {
  await browser.viewport(VIEWPORTS[0]!)
  await browser.visit(`${web}${route}`)
  await browser.run("wait", "--fn", HYDRATED).catch(() => undefined)
  await browser.run("wait", "1000")
  return extensionNodeResult(route, await browser.eval<ExtensionNodeRead>(READ))
}
