import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  glassTooltip,
  KBD,
  plainKbd,
  TOOLTIP,
  TOOLTIP_GLASS,
} from "../../../../packages/scripts/src/shadcn-customize"

const REPO = join(import.meta.dir, "../../../..")
const ours = await Bun.file(join(REPO, TOOLTIP)).text()
const ARROW =
  '\n          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground size-2.5" />'
// the registry's shape: the solid popup, with its arrow after the children
const registry = ours
  .replace(TOOLTIP_GLASS, "bg-foreground px-3 py-1.5 text-xs text-background")
  .replace("{children}", `{children}${ARROW}`)

// the owner on #i949: "glass tooltip"
describe("shadcn-customize's glass tooltip", () => {
  test("gives the registry's popup the bars' glass and drops its arrow, and leaves the patched file as it is", () => {
    expect(registry).toContain("TooltipPrimitive.Arrow")
    const patched = glassTooltip(registry)
    expect(patched).toContain(TOOLTIP_GLASS)
    expect(patched).not.toContain("TooltipPrimitive.Arrow")
    expect(patched).not.toContain("text-background")
    expect(glassTooltip(ours)).toBe(ours)
  })

  test("gives a key in a tooltip its own muted look, which the registry inverts for a solid popup, and leaves the patched file as it is", async () => {
    const kbd = await Bun.file(join(REPO, KBD)).text()
    const stock = kbd.replace(
      "text-muted-foreground select-none",
      "text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
    )
    expect(stock).toContain("tooltip-content")
    expect(plainKbd(stock)).toBe(kbd)
    expect(plainKbd(kbd)).toBe(kbd)
  })

  test("fails loudly when the popup changes shape", () => {
    expect(() => glassTooltip("<TooltipPrimitive.Popup />")).toThrow(/shape changed/)
  })
})
