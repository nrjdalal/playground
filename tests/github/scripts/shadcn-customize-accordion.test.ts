import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ACCORDION, accordionHeader } from "../../../.github/scripts/shadcn-customize"

const REPO = join(import.meta.dir, "../../..")
const ours = await Bun.file(join(REPO, ACCORDION)).text()
// the registry's shape, the patch's two edits taken back out of the committed file
const registry = ours
  .replace(/header,\s*/, "")
  .replace(/ & \{ header\?: AccordionPrimitive\.Header\.Props\["render"\] \}/, "")
  .replace(
    /function AccordionTrigger\(\{[^}]*\}/,
    "function AccordionTrigger({ className, children, ...props }",
  )
  .replace(" render={header}", "")

// a reviewer: the Pull requests tab's sections need an h4 under the dashboard's own queue's h3
describe("shadcn-customize's accordion header", () => {
  test("gives AccordionTrigger a header render on the registry's shape, and leaves the patched file as it is", () => {
    expect(registry).not.toContain("header")
    const patched = accordionHeader(registry)
    expect(patched).toContain("header, ...props")
    expect(patched).toContain('<AccordionPrimitive.Header className="flex" render={header}>')
    expect(accordionHeader(ours)).toBe(ours)
  })

  test("fails loudly when the trigger changes shape", () => {
    expect(() => accordionHeader("function AccordionTrigger() {}")).toThrow(/shape changed/)
  })
})
