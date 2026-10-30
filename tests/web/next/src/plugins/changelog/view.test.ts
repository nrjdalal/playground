import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SHELF_ROW, STICKY_HEADER } from "../../../../../../web/next/src/components/shelf"

const view = await Bun.file(
  join(import.meta.dir, "../../../../../../web/next/src/plugins/changelog/view.tsx"),
).text()

describe('each changelog version an accordion row (the owner: "changelog should look like inbox, like the accordions")', () => {
  test("each version is one accordion row on the shelf classes", () => {
    expect(view).toContain("<AccordionItem value={group.id} className={SHELF_ITEM}>")
    expect(view).toContain("className={SHELF_ROW}")
    expect(view).toMatch(
      /header=\{\(props\) => <h2 \{\.\.\.props\} className=\{cn\(props\.className, STICKY_HEADER\)\} \/>\}/,
    )
  })

  test('a stuck header sticks up over its pane\'s top padding, so no row shows above it in the aside (the owner: "please no text can go above the entry")', () => {
    expect(STICKY_HEADER.split(" ")).toContain("top-[calc(var(--pane-top,0px)*-1)]")
  })

  test("a row never runs past its column, so a long one truncates rather than clipping at 1280 and 1440", () => {
    expect(SHELF_ROW.split(" ")).toContain("min-w-0")
  })

  test("the open versions follow openVersions, so a search or a link never leaves its match behind a shut row", () => {
    expect(view).toContain(
      "onValueChange={(ids) => setOpenState({ ...state, ids: ids as string[] })}",
    )
    expect(view).toContain("value={open}")
    expect(view).toContain("const state = nextOpen(openState, {")
    expect(view).toContain("const open = openVersions({")
  })

  test("a version's header is an h2 under the page's h1, and its count plain muted text, no Badge", () => {
    expect(view).not.toContain("<h3")
    expect(view).not.toContain("Badge")
    expect(view).toContain('<span className="text-muted-foreground shrink-0 tabular-nums">')
  })
})
