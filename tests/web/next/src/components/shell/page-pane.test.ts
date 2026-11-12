import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { PAGE_PANE } from "../../../../../../web/next/src/components/shell/page-pane"

// whitespace collapsed, so a reformat that wraps a line keeps the match
const read = async (path: string) =>
  (await Bun.file(join(import.meta.dir, "../../../../../../web/next/src", path)).text()).replace(
    /\s+/g,
    " ",
  )

const IMPORT = 'import { PAGE_PANE } from "@/components/shell/page-pane"'

// A channel renders through ChannelView on both shells, so it looks the same only while both draw the page in one box: these hold the dashboard's page and the members' /yard page to PAGE_PANE.
describe("the page box the dashboard and the members' /yard pages share", () => {
  test("scrolls on its own inside a column, so a channel's header and composer stay in view", () => {
    expect(PAGE_PANE.split(" ").sort()).toEqual(
      ["flex", "flex-col", "min-h-0", "overflow-y-auto"].sort(),
    )
  })

  test("is the dashboard's page on a wide screen and on a phone", async () => {
    const source = await read("components/dashboard/dashboard-aside.tsx")
    expect(source).toContain(IMPORT)
    expect(source).toContain('<div data-dashboard-page="" className={cn("h-full", PAGE_PANE)}>')
    expect(source).toContain(
      'className={cn("col-start-1 row-start-1 data-hidden:invisible", PAGE_PANE)}',
    )
  })

  test("is the members' /yard page, one screen tall as the dashboard's box is", async () => {
    const source = await read("app/(yard)/yard/(app)/layout.tsx")
    expect(source).toContain(IMPORT)
    expect(source).toContain('<div className={cn("h-svh", PAGE_PANE)}>{children}</div>')
  })
})
