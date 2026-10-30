import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  contentType,
  EXTENSIONS,
  IMAGE_EXTENSIONS,
} from "../../../../../../../api/hono/src/lib/dashboard/attachments"
import { INBOX_ATTACHMENT_KINDS } from "../../../../../../../api/hono/src/lib/dashboard/inbox"
import {
  BAR_COUNT,
  BAR_NAME,
  keepFocus,
  onSelect,
  OpenInNewTab,
  OPENS_IN_TAB,
  pinsBars,
  wrapStep,
} from "../../../../../../../web/next/src/components/dashboard/viewer/viewer"

describe("Open in new tab opens a blob URL with the Dashboard's origin, so only a file that runs no script", () => {
  test("it opens an image or a PDF, and an HTML page, code and a doc have no button", () => {
    expect([...OPENS_IN_TAB]).toEqual(["image", "pdf"])
    expect(INBOX_ATTACHMENT_KINDS.filter((kind) => !OPENS_IN_TAB.includes(kind))).toEqual([
      "code",
      "doc",
      "html",
    ])
  })

  test("an image is never an SVG, and no file is served as HTML or SVG, whatever it holds", () => {
    expect(IMAGE_EXTENSIONS as readonly string[]).not.toContain("svg")
    for (const extension of [...EXTENSIONS, "htm", "html", "svg"])
      expect(contentType(`3f0e7a52-1c4b-4d2a-9e6f-0000000000a1.${extension}`)).not.toMatch(
        /html|svg|xml|javascript/,
      )
  })
})

describe('a step past either end wraps (the owner: "back and forth not working right")', () => {
  test("Next on the last goes to the first and Previous on the first to the last, each a jump", () => {
    expect(wrapStep(19, 1, 20)).toEqual({ next: 0, wraps: true })
    expect(wrapStep(0, -1, 20)).toEqual({ next: 19, wraps: true })
  })

  test("a step inside sweeps to its neighbour", () => {
    expect(wrapStep(15, 1, 20)).toEqual({ next: 16, wraps: false })
    expect(wrapStep(15, -1, 20)).toEqual({ next: 14, wraps: false })
  })

  test("one file stays put", () => {
    expect(wrapStep(0, 1, 1).next).toBe(0)
    expect(wrapStep(0, -1, 1).next).toBe(0)
  })
})

describe("a frame keeps a touch to itself, so on a screen with no hover its bars stay up", () => {
  test("an HTML page or a PDF on a touch screen keeps the bar and the X up", () => {
    expect(pinsBars("html", true)).toBe(true)
    expect(pinsBars("pdf", true)).toBe(true)
  })

  test("a picture on touch, and every kind with a pointer that hovers, leave the bars to the pointer", () => {
    expect(pinsBars("image", true)).toBe(false)
    for (const kind of INBOX_ATTACHMENT_KINDS) expect(pinsBars(kind, false)).toBe(false)
  })
})

describe('the bar holds one width from slide to slide (the owner: "it\'s size changes? width should be fixed")', () => {
  const web = join(import.meta.dir, "../../../../../../../web/next")
  const render = async (kind: (typeof INBOX_ATTACHMENT_KINDS)[number]) => {
    const { createElement } = await import(Bun.resolveSync("react", web))
    const { renderToStaticMarkup } = await import(Bun.resolveSync("react-dom/server", web))
    const { QueryClient, QueryClientProvider } = await import(
      Bun.resolveSync("@tanstack/react-query", web)
    )
    const item = { id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000a1.png", kind, name: "a.png" }
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(OpenInNewTab, { item }),
      ),
    ) as string
  }

  test("the count and the name take fixed widths", () => {
    expect(BAR_COUNT.split(" ")).toEqual(
      expect.arrayContaining(["w-16", "shrink-0", "text-center"]),
    )
    expect(BAR_NAME.split(" ")).toEqual(expect.arrayContaining(["w-48", "truncate"]))
  })

  test("a kind with no Open in new tab keeps a square's room in its place", async () => {
    expect(await render("html")).toBe('<span aria-hidden="true" class="size-8 shrink-0"></span>')
    expect(await render("image")).toContain('aria-label="Open in new tab"')
  })
})

// a tester: Down from the compare slider moved the slide and dropped focus to the page, so Left, Right and Up did nothing after
describe("a slide holding focus hands it to the stage before it goes inert", () => {
  const stage = () => {
    const calls: unknown[] = []
    return {
      calls,
      el: { focus: (options: unknown) => calls.push(options) } as unknown as HTMLElement,
    }
  }
  const inSlide = (yes: boolean) =>
    ({
      closest: (selector: string) =>
        yes && selector === '[data-slot="carousel-item"]' ? {} : null,
    }) as unknown as Element

  test("focus in a slide moves to the stage, without scrolling", () => {
    const { calls, el } = stage()
    keepFocus(inSlide(true), el)
    expect(calls).toEqual([{ preventScroll: true }])
  })

  test("focus on the stage, the bar or nowhere stays where it is", () => {
    const { calls, el } = stage()
    keepFocus(inSlide(false), el)
    keepFocus(null, el)
    expect(calls).toEqual([])
  })

  // as embla-carousel 8.6.0 does: scrollTo emits select only when the index changes
  const embla = (count: number, onIndexChange: (index: number) => void, el: HTMLElement) => {
    let current = 0
    return (direction: -1 | 1) => {
      const { next } = wrapStep(current, direction, count)
      if (next === current) return
      current = next
      onSelect(next, inSlide(true), el, onIndexChange)
    }
  }

  test("a select hands the old slide's focus to the stage, then moves the index", () => {
    const { calls, el } = stage()
    const indexes: number[] = []
    embla(3, (index) => indexes.push(index), el)(1)
    expect(calls).toEqual([{ preventScroll: true }])
    expect(indexes).toEqual([1])
  })

  test("an arrow on a lone item moves nothing, so focus stays in its page", () => {
    const { calls, el } = stage()
    const indexes: number[] = []
    const go = embla(1, (index) => indexes.push(index), el)
    go(1)
    go(-1)
    expect(calls).toEqual([])
    expect(indexes).toEqual([])
  })
})

// a reviewer: the stage took the muted focus fill once the keyboard was used
describe("the stage stays see-through while it holds focus", () => {
  test("its focus takes no fill", async () => {
    const web = join(import.meta.dir, "../../../../../../../web/next")
    const viewer = await Bun.file(join(web, "src/components/dashboard/viewer/viewer.tsx")).text()
    expect(viewer).toContain('className="min-h-0 flex-1 outline-none focus-visible:bg-transparent')
  })
})

describe("the viewer's Close", () => {
  const viewer = () =>
    Bun.file(
      join(
        import.meta.dir,
        "../../../../../../../web/next/src/components/dashboard/viewer/viewer.tsx",
      ),
    ).text()

  // the Close matches the bottom bar: one square, always shown
  test("sits always shown at the top right, one square on a floating bar of its own, the bottom bar's look", async () => {
    const source = await viewer()
    expect(source).toContain('<div className={cn(FLOATING_BAR, "absolute top-2 right-2 z-10")}>')
    expect(source).not.toContain("setCorner")
  })

  // the bar's icons read one size, the chevrons a step up for their thinner glyph
  test("the bottom bar's chevrons take 20px, since their glyph fills less of its box, and its cross reads 16px as every other icon", async () => {
    const source = await viewer()
    expect(source).toContain('<RiArrowLeftSLine className="size-5" />')
    expect(source).toContain('<RiArrowRightSLine className="size-5" />')
    expect(source).not.toContain('<RiCloseLine className="size-5" />')
  })
})
