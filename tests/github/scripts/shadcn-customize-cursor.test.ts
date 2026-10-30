import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  BODY,
  POINTER_CURSORS,
  POINTER_ITEMS,
  pointerCursors,
  pointerItems,
} from "../../../.github/scripts/shadcn-customize"

const REPO = join(import.meta.dir, "../../..")
const css = await Bun.file(join(REPO, "web/next/src/app/globals.css")).text()

// Every button and other clickable control shows the pointer cursor, Send included.
describe("shadcn-customize's pointer cursor", () => {
  test("globals.css's base layer gives every clickable control the pointer, and the sync puts it back on init's shape", () => {
    expect(css).toMatch(/@layer base \{[\s\S]*cursor: pointer;[\s\S]*cursor: not-allowed;/)
    expect(css).toContain(POINTER_CURSORS)
    const registry = css.replace(POINTER_CURSORS, BODY)
    expect(registry).not.toContain("cursor: pointer")
    expect(pointerCursors(registry)).toBe(css)
    expect(pointerCursors(css)).toBe(css)
  })

  test("the rule covers buttons, links, tabs, menu items, options and toggles, and not-allowed when disabled", () => {
    const selectors = (/:is\(([^)]*)\) \{/.exec(POINTER_CURSORS)?.[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
    expect(selectors).toEqual(
      expect.arrayContaining([
        "button",
        '[role="button"]',
        "a[href]",
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="checkbox"]',
        '[role="switch"]',
      ]),
    )
    expect(POINTER_CURSORS).toContain(
      '&:is(:disabled, [aria-disabled="true"], [data-disabled]:not([data-disabled="false"])) {\n      cursor: not-allowed;',
    )
  })

  test("fails loudly when the base layer's body rule changes shape", () => {
    expect(() => pointerCursors("@layer base {\n  html {}\n}")).toThrow(/shape changed/)
  })

  test("every menu, select, combobox and command item shows the pointer, and the sync swaps init's cursor-default back", async () => {
    for (const file of POINTER_ITEMS) {
      const source = await Bun.file(join(REPO, file)).text()
      expect({ file, default: source.includes("cursor-default") }).toEqual({ file, default: false })
      const stock = source.replaceAll("cursor-pointer", "cursor-default")
      expect(pointerItems(stock, file)).toBe(source)
      expect(pointerItems(source, file)).toBe(source)
    }
  })

  test("fails loudly when an item file carries no cursor at all", () => {
    expect(() => pointerItems("export const Item = () => null", "select.tsx")).toThrow(
      "no item cursor in select.tsx",
    )
  })
})
