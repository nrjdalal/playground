import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  handBack,
  IMAGE_VIEWER,
  PairView,
} from "../../../../../../../web/next/src/components/dashboard/viewer/image"

// React resolves from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
const web = join(import.meta.dir, "../../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: Node[]) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}
const { QueryClient, QueryClientProvider } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as { QueryClient: new () => unknown; QueryClientProvider: unknown }

const html = renderToStaticMarkup(
  createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    createElement(IMAGE_VIEWER.View, {
      active: true,
      item: { id: "0b9c6f1e-1111-4111-8111-000000000001.png", kind: "image", name: "shot.png" },
      onEdge: () => {},
      url: "blob:https://desk.playground.localhost/1",
    }),
  ),
)

describe("a lone picture in the viewer", () => {
  test("is a zoom button named by its picture", () => {
    expect(html).toContain('aria-label="Zoom in on shot.png"')
    expect(html).toContain('aria-pressed="false"')
  })

  // a reviewer: canary's no-ring rule left a ring-only mark showing nothing
  test("shows focus by its border, with no ring", () => {
    expect(html).toContain("focus-visible:border-ring")
    expect(html).not.toContain("focus-visible:ring")
  })
})

// a pair's views sit on one bar in the viewer's own floating look
describe("a before/after pair in the viewer", () => {
  const pair = renderToStaticMarkup(
    createElement(PairView, {
      after: { alt: "after.png", url: "blob:https://desk.playground.localhost/3" },
      before: { alt: "before.png", url: "blob:https://desk.playground.localhost/2" },
      onEdge: () => {},
    }),
  )

  test("offers Before, Side, Slider and After on one bar, in that order, Side picked first", () => {
    const at = (label: string) => pair.indexOf(`>${label}</button>`)
    expect(at("Before")).toBeGreaterThan(0)
    expect(at("Side")).toBeGreaterThan(at("Before"))
    expect(at("Slider")).toBeGreaterThan(at("Side"))
    expect(at("After")).toBeGreaterThan(at("Slider"))
    expect(pair).toMatch(/aria-pressed="true"[^>]*>Side</)
  })

  test("opens on Side, the two pictures at a divider that resizes the split", () => {
    expect(pair).toContain('data-slot="resizable-handle"')
    expect(pair).not.toContain('role="slider"')
  })

  // a reviewer: the viewer took every arrow first, so a keyboard user could not change the view or resize
  test("lets the bar and the divider keep Left and Right", () => {
    expect(pair).toMatch(
      /aria-label="Compare view"[^>]*data-viewer-owns-keys=""|data-viewer-owns-keys=""[^>]*aria-label="Compare view"/,
    )
    expect(pair).toMatch(
      /data-slot="resizable-handle"[^>]*data-viewer-owns-keys=""|data-viewer-owns-keys=""[^>]*data-slot="resizable-handle"/,
    )
  })

  // a reviewer: at 390px the centred bar ran under the viewer's top-right Close, so a tap on After closed the viewer
  test("leaves the top corners free on a narrow screen, its buttons shrinking to fit", () => {
    expect(pair).toMatch(
      /aria-label="Compare view"[^>]*max-w-\[calc\(100%-7rem\)\]|max-w-\[calc\(100%-7rem\)\][^>]*aria-label="Compare view"/,
    )
    const buttons = pair.match(/<button[^>]*>(?:Before|Side|Slider|After)</g) ?? []
    expect(buttons).toHaveLength(4)
    // the stock toggle item is shrink-0, which held each button at 80px past the cap (a reviewer)
    for (const button of buttons) {
      const classes = /class="([^"]*)"/.exec(button)?.[1]?.split(" ") ?? []
      expect(classes).toContain("min-w-0")
      expect(classes).toContain("shrink")
      expect(classes).not.toContain("shrink-0")
    }
  })

  // a reviewer: owning every arrow took Up and Down from the viewer too, as asks.md has a renderer hand them back
  test("hands Up and Down from the bar and the divider back to the viewer, for the slide before or after", async () => {
    const edges: number[] = []
    let stopped = 0
    const keep = handBack((direction) => edges.push(direction))
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
      keep({ key, preventDefault: () => {}, stopPropagation: () => stopped++ } as never)
    expect(edges).toEqual([-1, 1])
    expect(stopped).toBe(2)
    const source = await Bun.file(join(web, "src/components/dashboard/viewer/image.tsx")).text()
    expect(source.match(/onKeyDown=\{handBack\(onEdge\)\}/g)).toHaveLength(2)
  })
})
