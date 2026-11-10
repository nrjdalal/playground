import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const read = (path: string) =>
  Bun.file(join(import.meta.dir, "../../../../../../web/next/src/components", path)).text()

const boxClasses = (source: string) => ({
  row: source.match(/<InputGroupAddon\s+align="block-end"\s+className="([^"]*)"/)?.[1],
  text: source.match(/<InputGroupTextarea[\s\S]*?className="([^"]*)"/)?.[1],
})

describe("Yard's composer", () => {
  test("is the session composer's box at its sizes, so the two boxes stay one", async () => {
    const yard = boxClasses(await read("yard/channel-view.tsx"))
    expect(yard.text).toBeString()
    expect(yard.row).toBeString()
    expect(yard).toEqual(boxClasses(await read("dashboard/composer.tsx")))
  })

  // the dashboard's phone tab bar holds its Menu, so the hosted dashboard's channel pads for no floating one
  test("rests above the floating Menu in Yard's own shell alone", async () => {
    const source = await read("yard/channel-view.tsx")
    const page = (path: string) =>
      Bun.file(join(import.meta.dir, "../../../../../../web/next/src/app", path)).text()
    expect(source).toContain('shell === "yard" && "max-md:mb-26"')
    expect(await page("(protected)/dashboard/yard/[id]/page.tsx")).toContain('shell="dashboard"')
    expect(await page("(yard)/yard/(app)/c/[id]/page.tsx")).toContain('shell="yard"')
  })

  // its words live in its own state alone, so a build reload waits while they show (build-reload.ts)
  test("holds a build reload while it holds typed words", async () => {
    const source = await read("yard/channel-view.tsx")
    const composer = source.slice(source.indexOf("function YardComposer"))
    expect(source).toContain('import { HOLDS_RELOAD } from "@/lib/build-reload"')
    expect(composer).toMatch(/<form\s+\{\.\.\.\{ \[HOLDS_RELOAD\]: "" \}\}/)
  })
})

// a channel takes the dashboard chat's layout, read from the chat's own files, so the two keep one convention (the design skill's Chat layout)
describe("A channel's layout", () => {
  const flat = async (path: string) => (await read(path)).replace(/\s+/g, " ")
  const pageBox = (source: string) =>
    source.match(/<PageShell size="full" className="(flex h-full flex-col py-0[^"]*)"/)?.[1]

  test("sits in the chat's page box, with its gutter and no top or bottom padding", async () => {
    const chat = pageBox(await flat("dashboard/dashboard-view.tsx"))
    expect(chat).toBeString()
    expect(pageBox(await flat("yard/channel-view.tsx"))).toBe(chat)
  })

  test("spaces its rows as the chat does, 16px apart with 36px under the last, in the chat's scroller gutter", async () => {
    const chat = await flat("dashboard/worker-stream.tsx")
    const yard = await flat("yard/channel-view.tsx")
    const scroller = '<MessageScroller className="-mx-1 min-h-0 w-auto flex-1">'
    expect(chat).toContain("grow gap-4 pb-9")
    expect(yard).toContain('<MessageScrollerContent className="gap-4 pt-3 pb-9">')
    expect(chat).toContain(scroller)
    expect(yard).toContain(scroller)
  })

  test("rests its composer 8px above the bottom, as the chat's does", async () => {
    expect(await flat("dashboard/composer.tsx")).toContain('<FieldGroup className="mb-2">')
    expect(await flat("yard/channel-view.tsx")).toContain('cn("mb-2", shell === "yard"')
  })

  test("puts your own post on the right in the chat's bubble and every other member's on the left", async () => {
    const yard = await flat("yard/channel-view.tsx")
    expect(yard).toContain("mine={isMine(message, me)}")
    expect(yard).toContain('variant={mine ? "default" : "muted"}')
  })
})

// #1527: a channel opened at its oldest message, so the newest sat below the screen on both shells
describe("A channel's messages", () => {
  // whitespace collapsed, so a reformat that wraps a line keeps the match
  const list = async () => (await read("yard/channel-view.tsx")).replace(/\s+/g, " ")

  test("open at the newest, and follow a new one only while the reader is at the end", async () => {
    const source = await list()
    expect(source).toContain('<MessageScrollerProvider autoScroll defaultScrollPosition="end">')
    expect(source).toContain("<MessageScrollerViewport")
    expect(source).not.toContain("overflow-y-auto px-4 py-3")
  })

  // the stock item guesses 10rem for a row off screen, and the view moved when the guess met the real height
  test("each sit in the scroller at its real height, keyed by its id", async () => {
    const source = await list()
    expect(source).toContain('import { STREAM_ROW } from "@/components/dashboard/chat-scroll"')
    expect(source).toContain(
      "<MessageScrollerItem key={message.id} className={STREAM_ROW} messageId={message.id}>",
    )
  })
})
