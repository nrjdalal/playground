import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  AsideDocsPane,
  docItem,
} from "../../../../../../web/next/src/components/dashboard/aside-docs"
import { pageDoc } from "../../../../../../web/next/src/lib/aside-docs"

type Node = unknown
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: Node[]) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}
const { QueryClient, QueryClientProvider } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as { QueryClient: new () => unknown; QueryClientProvider: unknown }

const PAGE = pageDoc("https://api.test", "sidebar-mock.html", "Sidebar spacing")

const render = (doc: typeof PAGE) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(AsideDocsPane, { doc, onClose: () => {} }),
    ),
  )

// the names of the buttons in the order they render
const labels = (html: string) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])

describe("a kept page in an aside tab", () => {
  test("shows in the viewer as an HTML file that loads and saves from its own addresses", () => {
    expect(docItem(PAGE)).toEqual({
      id: "page-sidebar-mock.html",
      kind: "html",
      name: "Sidebar spacing",
      page: {
        download: "https://api.test/api/v1/apps/previews/sidebar-mock.html?download=1",
        url: "https://api.test/api/v1/apps/previews/sidebar-mock.html",
      },
    })
  })

  // #1716: the tab's bar held Download and X alone
  test("its bar holds Download, Open in new tab, Full screen and Close, in that order", () => {
    expect(labels(render(PAGE))).toEqual(["Download", "Open in new tab", "Full screen", "Close"])
  })

  test("Open in new tab opens the page's own address in a browser tab", () => {
    expect(render(PAGE)).toContain(
      'href="https://api.test/api/v1/apps/previews/sidebar-mock.html" rel="noreferrer" target="_blank"',
    )
  })

  test("a card's markdown file keeps Download, Full screen and Close, with no tab to open", () => {
    const doc = {
      item: { id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000c1.md", kind: "doc", name: "notes.md" },
      key: "file-3f0e7a52-1c4b-4d2a-9e6f-0000000000c1.md",
      name: "notes.md",
    } as unknown as typeof PAGE
    expect(labels(render(doc))).toEqual(["Download", "Full screen", "Close"])
  })

  test("Full screen opens the viewer over the page, whose Open in side panel comes back to the tab", async () => {
    const source = await Bun.file(join(web, "src/components/dashboard/aside-docs.tsx")).text()
    expect(source).toContain("<FullScreen onClick={() => setOpen(true)} />")
    expect(source).toContain("onSidePanel={() => setOpen(false)}")
  })
})
