import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  OPEN_HEADER,
  SHELF_ITEM,
  SHELF_ROW,
  STICKY_HEADER,
} from "../../../../../web/next/src/components/shelf"
import { ShelfMark } from "../../../../../web/next/src/components/shelf-mark"

const web = join(import.meta.dir, "../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown) => unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: unknown) => string
}

describe("the accordion rows the Inbox and the Changelog share", () => {
  // the owner: "when done opens there should be botter bottom at accordion trigger"
  test("a stuck header draws its full-width line, the last row's too once it is open", () => {
    expect(STICKY_HEADER).toContain("sticky top-[calc(var(--pane-top,0px)*-1)]")
    expect(STICKY_HEADER).toContain("-mx-(--pane-x) px-(--pane-x)")
    expect(STICKY_HEADER).toContain("[:last-child:not([data-open])>&]:after:hidden")
  })

  test("the open row paints over the pane's top padding, an open row draws a line after its section, and an empty row reads gray on the default cursor", () => {
    expect(OPEN_HEADER).toContain("before:bottom-full")
    expect(SHELF_ITEM).toContain("not-last:data-open:after:h-px")
    expect(SHELF_ROW).toContain("disabled:cursor-default disabled:opacity-50")
    // a row shrinks to its column, so its words truncate and its count and mark stay in view (a tester: the Changelog's long row ran past its column)
    expect(SHELF_ROW.split(" ")).toContain("min-w-0")
  })

  // the owner: "show circle icon if no items in accordion, and right chevron on closed?", "and hover state like this"
  test("a row hides the stock chevrons for its ShelfMark: a circle when empty, else a right chevron turning down while open, on a square while hovered", () => {
    expect(SHELF_ROW).toContain("[&>[data-slot=accordion-trigger-icon]]:hidden!")
    const empty = renderToStaticMarkup(createElement(ShelfMark, { empty: true }))
    const full = renderToStaticMarkup(createElement(ShelfMark))
    expect(empty).toContain('aria-hidden="true"')
    expect(empty).toContain("remixicon")
    expect(full).toContain("group-aria-expanded/accordion-trigger:rotate-90")
    expect(empty).not.toContain("rotate-90")
    expect(full).toContain("group-hover/accordion-trigger:group-enabled/accordion-trigger:bg-muted")
  })
})
