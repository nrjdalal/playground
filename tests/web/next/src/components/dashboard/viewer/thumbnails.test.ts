import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { InboxAttachment } from "../../../../../../../api/hono/src/lib/dashboard/inbox"
import { attachmentDisposition, fileNameOf } from "../../../../../../../api/hono/src/lib/download"
import type { ViewerItem } from "../../../../../../../web/next/src/components/dashboard/viewer/registry"
import {
  AttachmentThumbs,
  focusTarget,
} from "../../../../../../../web/next/src/components/dashboard/viewer/thumbnails"
import { attachmentQuery } from "../../../../../../../web/next/src/components/dashboard/viewer/use-attachment-url"
import {
  saveItem,
  STEP_OF_KEY,
} from "../../../../../../../web/next/src/components/dashboard/viewer/viewer"

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
)) as {
  QueryClient: new (options?: unknown) => { prefetchQuery: (options: unknown) => Promise<void> }
  QueryClientProvider: unknown
}

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

describe("an ask's thumbnails", () => {
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

describe("Slider mode's keys", () => {
  test("Left and Up go back, Right and Down go on", () => {
    expect(STEP_OF_KEY).toEqual({ ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 })
  })
})

describe("the thumbnail grid takes the arrows too", () => {
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

  test("its tiles sit gap-3 apart, its own gap, the one the files sit below the words", () => {
    expect(render(items(2))).toContain("grid grid-cols-4 gap-3")
  })
})

// a lone before and after pair at full width, one over the other
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

const PAGE: ViewerItem = {
  id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000b1.html",
  kind: "html",
  name: "demo.html",
}

// the names of the buttons in the order they render
const labels = (html: string) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])

// a lone HTML page shows live in its card, as a demo
describe("a lone HTML page", () => {
  test("fills its card at full width, not a tile", () => {
    const html = render([PAGE])
    expect(html).toContain("h-80")
    expect(html).not.toContain("grid-cols-4")
  })

  // #1716: the owner found no way to open a page big or in a tab
  test("its bar holds Download, Open in new tab and Full screen, in that order, with no side panel outside the aside", () => {
    expect(labels(render([PAGE]))).toEqual([
      "Attached files",
      "Download",
      "Open in new tab",
      "Full screen",
    ])
  })

  test("in the aside its bar adds Open in side panel before Full screen", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(AttachmentThumbs, { items: [PAGE], onOpen: () => {}, onSidePanel: () => {} }),
      ),
    )
    expect(labels(html)).toEqual([
      "Attached files",
      "Download",
      "Open in new tab",
      "Open in side panel",
      "Full screen",
    ])
  })

  test("each of its squares names itself in a tooltip, and Full screen opens the viewer, never an aside tab", async () => {
    const source = await Bun.file(
      join(web, "src/components/dashboard/viewer/thumbnails.tsx"),
    ).text()
    expect(source).toContain("onFullScreen={view}")
    expect(source).toContain("onFullScreen={() => (onFullScreen ?? onOpen)(0)}")
    const viewer = await Bun.file(join(web, "src/components/dashboard/viewer/viewer.tsx")).text()
    expect(viewer).toContain(
      'content={state === "failed" ? "Download failed, try again" : "Download"}',
    )
    for (const words of ["Open in new tab", "Open in side panel", "Full screen"])
      expect(viewer).toContain(`content="${words}" description={null}>`)
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
    const html = render([PAGE, ...items(1)])
    expect(html).not.toContain("Full screen")
    expect(html).toContain("grid-cols-4")
  })
})

// each file on the card saves from its own tile, the viewer's Download staying (#783's Fix, the Builder's ruling on #821)
describe("a tile's Download", () => {
  test("every tile but +N holds a Download naming its file, and the arrows step the tiles alone", async () => {
    const html = render(items(20))
    expect(html.match(/aria-label="Download shot-/g)).toHaveLength(15)
    expect(html).not.toContain('aria-label="Download 5 more"')
    expect(html.match(/data-tile=""/g)).toHaveLength(16)
    const source = await Bun.file(
      join(web, "src/components/dashboard/viewer/thumbnails.tsx"),
    ).text()
    expect(source).toContain('querySelectorAll<HTMLButtonElement>("button[data-tile]")')
  })

  test("each side of a lone pair saves its own file", () => {
    const [before, after] = items(2)
    const html = render([{ ...before!, pair: { after: after!, before: before! } }])
    expect(html).toContain('aria-label="Download shot-0.png"')
    expect(html).toContain('aria-label="Download shot-1.png"')
  })

  test("sits in the tile's corner on the glass, shown on hover or focus and always on a touch screen", () => {
    const html = render(items(1))
    expect(html).toContain("group/tile relative")
    expect(html).toContain("group-hover/tile:opacity-100")
    expect(html).toContain("group-focus-within/tile:opacity-100")
    expect(html).toContain("pointer-coarse:opacity-100")
  })

  test("fetches its file from the Inbox's route in download mode with the cookie, and saves it under the readable name the API gives", async () => {
    const [file] = items(1)
    const name = fileNameOf("Weekly plan, updated draft", "png")
    const fetched: { credentials?: RequestCredentials; url: string }[] = []
    const saved: { download: string; href: string }[] = []
    const scope = globalThis as { document?: unknown; fetch: typeof fetch }
    const [realFetch, realDocument] = [scope.fetch, scope.document]
    scope.fetch = (async (url: string, init?: RequestInit) => {
      fetched.push({ credentials: init?.credentials, url: String(url) })
      return new Response("png", {
        headers: { "content-disposition": attachmentDisposition(name) },
      })
    }) as typeof fetch
    scope.document = {
      createElement: () => {
        const link = {
          click: () => saved.push({ download: link.download, href: link.href }),
          download: "",
          href: "",
        }
        return link
      },
    }
    try {
      await saveItem(file!)
    } finally {
      scope.fetch = realFetch
      scope.document = realDocument
    }
    expect(fetched).toHaveLength(1)
    const url = new URL(fetched[0]!.url)
    expect(url.pathname).toBe(`/api/v1/inbox/attachments/${file!.id}`)
    expect(url.searchParams.get("download")).toBe("1")
    expect(fetched[0]!.credentials).toBe("include")
    expect(saved).toEqual([
      { download: "Weekly plan, updated draft.png", href: expect.stringMatching(/^blob:/) },
    ])
  })
})

// a file whose fetch fails says so in its place: a 404 reads Missing, as before, and any other failure reads Did not load, where a 500 or a lost connection once left the card blank (#1615)
describe("a file whose fetch fails", () => {
  const LOADS = {
    "a 200": async () => new Response(new Blob(["x"]), { status: 200 }),
    "a 404": async () => new Response("", { status: 404 }),
    "a 500": async () => new Response("", { status: 500 }),
    "a network error": async () => {
      throw new TypeError("Failed to fetch")
    },
  }
  type Outcome = keyof typeof LOADS
  // the files' queries settled through the real fetch with no retry, then the card rendered from that cache, held there with no retry on mount, which would show a settled error as pending again until it failed once more; a pair's after takes afterOutcome when one is given
  const settled = async (list: ViewerItem[], outcome: Outcome, afterOutcome = outcome) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    })
    const loads = list.flatMap((item): [string, Outcome][] =>
      item.pair
        ? [
            [item.pair.before.id, outcome],
            [item.pair.after.id, afterOutcome],
          ]
        : [[item.id, outcome]],
    )
    for (const [id, load] of loads)
      await client.prefetchQuery(attachmentQuery(id, true, LOADS[load] as unknown as typeof fetch))
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AttachmentThumbs, { items: list, onOpen: () => {} }),
      ),
    )
  }
  const [before, after] = items(2)
  const LAYOUTS: [string, ViewerItem[]][] = [
    ["a grid tile", items(2)],
    ["a before/after pair", [{ ...before!, pair: { after: after!, before: before! } }]],
    [
      "a lone HTML page",
      [{ id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000b1.html", kind: "html", name: "demo.html" }],
    ],
  ]

  for (const [layout, list] of LAYOUTS) {
    test.each(["a 500", "a network error"] as const)(
      `${layout} shows Did not load for %s`,
      async (outcome) => {
        expect(await settled(list, outcome)).toContain(">Did not load<")
      },
    )

    test(`${layout} keeps Missing for a 404`, async () => {
      const html = await settled(list, "a 404")
      expect(html).toContain(">Missing<")
      expect(html).not.toContain("Did not load")
    })
  }

  // a folded pair whose after did not load shows its before alone, as one whose after is missing does
  test.each(["a 500", "a network error"] as const)(
    "a grid of folded pairs shows each before's picture when its after fails with %s",
    async (outcome) => {
      const [a0, a1, b0, b1] = items(4)
      const pairs: ViewerItem[] = [
        { ...a0!, pair: { after: a1!, before: a0! } },
        { ...b0!, pair: { after: b1!, before: b0! } },
      ]
      const html = await settled(pairs, "a 200", outcome)
      expect(html.match(/<img /g)?.length).toBe(2)
      expect(html).not.toContain("Did not load")
    },
  )
})
