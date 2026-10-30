import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { InboxAttachment } from "../../../../../../../api/hono/src/lib/dashboard/inbox"
import type { ViewerItem } from "../../../../../../../web/next/src/components/dashboard/viewer/registry"
import {
  AttachmentThumbs,
  focusTarget,
} from "../../../../../../../web/next/src/components/dashboard/viewer/thumbnails"
import { STEP_OF_KEY } from "../../../../../../../web/next/src/components/dashboard/viewer/viewer"

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

const items = (n: number, kind: InboxAttachment["kind"] = "image"): InboxAttachment[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `3f0e7a52-1c4b-4d2a-9e6f-00000000000${i}.png`,
    kind,
    name: `shot-${i}.png`,
  }))

const render = (list: ViewerItem[]) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(AttachmentThumbs, { items: list, onOpen: () => {} }),
    ),
  )

describe('an ask\'s thumbnails (the owner: "4 by 4 grid and sqaure")', () => {
  test("twenty files fill the grid with fifteen square thumbnails and a +5 tile", () => {
    const html = render(items(20))
    expect(html).toContain("grid-cols-4")
    expect(html).toContain("aspect-square")
    expect(html.match(/aria-label="Open shot-/g)).toHaveLength(15)
    expect(html).toContain('aria-label="Open 5 more"')
    expect(html).toContain(">+5</button>")
  })

  test("a tile sits on no gray, since no card body does (asks.md)", () => {
    expect(render(items(20))).not.toMatch(/(^|[\s"])bg-muted(\/\d+)?(?=[\s"])/)
  })

  test("sixteen files fill the grid with sixteen thumbnails and no +N tile", () => {
    const html = render(items(16))
    expect(html.match(/aria-label="Open shot-/g)).toHaveLength(16)
    expect(html).not.toContain("more")
  })

  test("a kind with no renderer yet is a titled tile, its name under its icon", () => {
    expect(render(items(1, "pdf"))).toMatch(/<svg[^]*shot-0\.png<\/span>/)
  })
})

describe('Slider mode\'s keys (the owner: "left right up down navigate")', () => {
  test("Left and Up go back, Right and Down go on", () => {
    expect(STEP_OF_KEY).toEqual({ ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 })
  })
})

describe('the thumbnail grid takes the arrows too (the owner: "so small image icons, as I said, should be naviagatable in inbox too")', () => {
  test("Left and Right step a tile, Up and Down a row of four, held at the edges", () => {
    expect(focusTarget("ArrowRight", 1, 16)).toBe(2)
    expect(focusTarget("ArrowLeft", 1, 16)).toBe(0)
    expect(focusTarget("ArrowDown", 1, 16)).toBe(5)
    expect(focusTarget("ArrowUp", 5, 16)).toBe(1)
    expect(focusTarget("ArrowUp", 1, 16)).toBe(1)
    expect(focusTarget("ArrowDown", 13, 16)).toBe(13)
    expect(focusTarget("ArrowLeft", 0, 16)).toBe(0)
    expect(focusTarget("ArrowRight", 15, 16)).toBe(15)
  })

  test("Home and End jump to the ends, and any other key is left to the tile", () => {
    expect(focusTarget("Home", 3, 5)).toBe(0)
    expect(focusTarget("End", 0, 5)).toBe(4)
    expect(focusTarget("Enter", 2, 5)).toBeNull()
    expect(focusTarget("1", 2, 5)).toBeNull()
  })

  test("the grid is a named group", () => {
    expect(render(items(2))).toContain('role="group"')
    expect(render(items(2))).toContain('aria-label="Attached files"')
  })

  test('its tiles sit gap-3 apart, its own gap, the one the files sit below the words (the owner: "gap bewteen should be same")', () => {
    expect(render(items(2))).toContain("grid grid-cols-4 gap-3")
  })
})

// the owner: "Before: <full width image> After: <full width image>"
describe("a lone before/after pair", () => {
  test("shows at the card's full width, Before over After, each opening the pair", () => {
    const [before, after] = items(2)
    const pair = { ...before!, pair: { after: after!, before: before! } }
    const html = render([pair])
    expect(html).toContain('data-slot="attachment-thumbs"')
    expect(html).toContain("flex flex-col gap-3")
    expect(html).not.toContain("grid-cols-4")
    expect(html.indexOf(">Before<")).toBeGreaterThan(0)
    expect(html.indexOf(">After<")).toBeGreaterThan(html.indexOf(">Before<"))
    expect(html).toContain('aria-label="Open before: shot-0.png"')
    expect(html).toContain('aria-label="Open after: shot-1.png"')
  })

  test("each side holds a box of fixed height before its picture loads, so the card neither jumps nor stretches", async () => {
    const [before, after] = items(2)
    const html = render([{ ...before!, pair: { after: after!, before: before! } }])
    expect(html.match(/block h-48 w-full overflow-hidden/g)).toHaveLength(2)
    const source = await Bun.file(
      join(web, "src/components/dashboard/viewer/thumbnails.tsx"),
    ).text()
    expect(source).toContain('className="size-full object-contain"')
  })

  // a reviewer: canary's no-ring rule left a ring-only mark showing nothing
  test("each side shows focus by its border, with no ring", () => {
    const [before, after] = items(2)
    const html = render([{ ...before!, pair: { after: after!, before: before! } }])
    expect(html.match(/focus-visible:border-ring block h-48/g)).toHaveLength(2)
  })

  test("its two stacked sides take Up and Down one at a time, as a column of one", async () => {
    expect(focusTarget("ArrowDown", 0, 2, 1)).toBe(1)
    expect(focusTarget("ArrowUp", 1, 2, 1)).toBe(0)
    expect(focusTarget("ArrowDown", 1, 2, 1)).toBe(1)
    const source = await Bun.file(
      join(web, "src/components/dashboard/viewer/thumbnails.tsx"),
    ).text()
    expect(source).toContain("onKeyDown={moveFocus(1)}")
  })

  test("a pair among other files stays a tile in the grid", () => {
    const [before, after, other] = items(3)
    const html = render([{ ...before!, pair: { after: after!, before: before! } }, other!])
    expect(html).toContain("grid-cols-4")
    expect(html).not.toContain(">Before<")
  })
})

// a reviewer: with no ring, a picture covers a tile's muted focus fill
describe("a tile shows its focus with no ring", () => {
  test("it lights its border, which a picture never covers", () => {
    expect(render(items(1))).toContain("focus-visible:border-ring")
  })
})

// a lone HTML page shows live in its card, as a demo
describe("a lone HTML page", () => {
  test("fills its card at full width, with a full-screen button in its corner, not a tile", () => {
    const html = render([
      { id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000b1.html", kind: "html", name: "demo.html" },
    ])
    expect(html).toContain('aria-label="Open demo.html full screen"')
    expect(html).toContain("h-80")
    expect(html).not.toContain("grid-cols-4")
  })

  test("runs the page through the viewer's own HTML view, so a link in it opens and a page that leaves is put back", async () => {
    const source = await Bun.file(
      join(web, "src/components/dashboard/viewer/thumbnails.tsx"),
    ).text()
    expect(source).toContain(
      "<HTML_VIEWER.View active={false} item={item} onEdge={stay} url={url} />",
    )
    expect(source).not.toContain("<PageFrame")
  })

  test("among other files stays a tile in the grid", () => {
    const html = render([
      { id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000b1.html", kind: "html", name: "demo.html" },
      ...items(1),
    ])
    expect(html).not.toContain("full screen")
    expect(html).toContain("grid-cols-4")
  })
})
