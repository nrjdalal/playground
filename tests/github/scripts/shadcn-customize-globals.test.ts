import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  destructiveShades,
  FOCUS_MARKS,
  focusMarks,
  hideScrollbars,
  NO_FOCUS_RING,
  noFocusRing,
  SCROLLBARS_HIDDEN,
} from "../../../.github/scripts/shadcn-customize"

const css = await Bun.file(join(import.meta.dir, "../../../web/next/src/app/globals.css")).text()

describe("shadcn-customize's globals.css patch", () => {
  test("globals.css hides every native scrollbar, and the sync puts the rule back on init's shape", () => {
    expect(css).toContain(SCROLLBARS_HIDDEN)
    const registry = css.replace(SCROLLBARS_HIDDEN, "  }")
    expect(registry).not.toContain("scrollbar-width")
    expect(hideScrollbars(registry)).toBe(css)
    expect(hideScrollbars(css)).toBe(css)
  })

  test("fails loudly when the base layer's rule changes shape", () => {
    expect(() => hideScrollbars("@layer base {\n  body {}\n}")).toThrow(/shape changed/)
  })

  test("globals.css draws no focus ring, a focused field lighting its border alone, and the sync puts the rule back", () => {
    expect(css).toContain(NO_FOCUS_RING)
    expect(NO_FOCUS_RING).toContain('[data-slot="input-group"]:has(:focus-visible)')
    expect(NO_FOCUS_RING).toContain('[aria-invalid="true"],')
    expect(NO_FOCUS_RING).toContain(":focus-visible {\n  outline: none;\n}")
    expect(NO_FOCUS_RING).toContain(
      "@media (forced-colors: active) {\n  :focus-visible {\n    outline: 2px solid;",
    )
    expect(NO_FOCUS_RING).toContain(
      'label:has(> [data-slot="questionnaire-choice-input"]:focus-visible) {',
    )
    expect(NO_FOCUS_RING).toContain('[data-focused="true"] [data-day],')
    expect(NO_FOCUS_RING).toContain('[data-slot="item"]:has(a:focus-visible),')
    expect(NO_FOCUS_RING).toContain('[data-slot="resizable-handle"]:focus-visible > div,')
    expect(NO_FOCUS_RING).toContain("--tw-ring-shadow: 0 0 #0000;")
    const before = css.replace(`\n${FOCUS_MARKS}`, "")
    const registry = before.replace(`\n${NO_FOCUS_RING}`, "")
    expect(registry).not.toContain("--tw-ring-shadow")
    expect(noFocusRing(registry)).toBe(before)
    expect(noFocusRing(css)).toBe(css)
  })

  test("globals.css gives a focused control a mark without a ring, a muted fill its own fill outranks, and the sync puts it back (#2353)", () => {
    expect(css).toContain(FOCUS_MARKS)
    expect(FOCUS_MARKS).toContain(
      "@layer base {\n  :focus-visible {\n    background-color: var(--muted);",
    )
    expect(FOCUS_MARKS).toContain('[data-slot="resizable-handle"]:focus-visible')
    expect(FOCUS_MARKS).toContain("color-mix(in oklab, var(--foreground) 4%, transparent)")
    expect(FOCUS_MARKS).toContain(
      '[class~="focus-visible:border-ring"]:focus-visible:not([aria-invalid="true"]) {\n  border-color: var(--ring);',
    )
    expect(FOCUS_MARKS).toContain('[data-slot="sidebar-menu-button"][data-active]:focus-visible')
    expect(FOCUS_MARKS).toContain('[role="tab"][data-active]:focus-visible')
    expect(FOCUS_MARKS).toContain(
      '[data-slot="sidebar-menu-sub-button"][data-active]:focus-visible',
    )
    expect(FOCUS_MARKS).toContain('[data-slot="needs-you-body"]:focus-visible')
    const registry = css.replace(`\n${FOCUS_MARKS}`, "")
    expect(registry).not.toContain("#2353")
    expect(focusMarks(registry)).toBe(css)
    expect(focusMarks(css)).toBe(css)
  })

  test("globals.css keeps --destructive on red-600 and red-500, and the sync puts both back over init's values", () => {
    const registry = css
      .replace("--destructive: var(--color-red-600);", "--destructive: oklch(0.577 0.245 27.325);")
      .replace("--destructive: var(--color-red-500);", "--destructive: oklch(0.704 0.191 22.216);")
    expect(registry).not.toContain("--color-red-")
    expect(destructiveShades(registry)).toBe(css)
    expect(destructiveShades(css)).toBe(css)
  })

  test("fails loudly when the --destructive lines change shape", () => {
    expect(() => destructiveShades(":root {\n  --destructive: red;\n}")).toThrow(/shape changed/)
  })
})
