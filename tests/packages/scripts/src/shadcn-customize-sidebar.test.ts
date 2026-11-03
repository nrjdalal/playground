import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { BODY_SCROLL, bodyScroll } from "../../../../packages/scripts/src/shadcn-customize"

const SIDEBAR = join(import.meta.dir, "../../../../web/next/src/components/ui/sidebar.tsx")
const REGISTRY =
  '"no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden",'

describe("bodyScroll (PG-711)", () => {
  test("turns the registry's body into one that scrolls up and down alone", () => {
    const patched = bodyScroll(REGISTRY)
    expect(patched).toContain(BODY_SCROLL)
    expect(patched).not.toContain(" overflow-auto ")
  })

  test("is idempotent", () => {
    const once = bodyScroll(REGISTRY)
    expect(bodyScroll(once)).toBe(once)
  })

  test("throws when the body's overflow class changes shape", () => {
    expect(() => bodyScroll('"flex min-h-0 flex-1 flex-col overflow-scroll"')).toThrow(
      "shape changed",
    )
  })

  test("the checked-in sidebar.tsx carries it, so its body never scrolls sideways", async () => {
    const source = await Bun.file(SIDEBAR).text()
    expect(source).toContain(BODY_SCROLL)
    expect(bodyScroll(source)).toBe(source)
  })
})
