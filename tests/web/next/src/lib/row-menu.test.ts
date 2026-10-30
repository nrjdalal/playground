import { describe, expect, test } from "bun:test"

import { MENU_HINT, opensMenu } from "../../../../../web/next/src/lib/row-menu"

// A manager row's Move up and Move down; every other row's words are its tooltip, a multiline tooltip rather than a menu.
describe("the manager row menu", () => {
  test("Shift+F10 and the Menu key open it, so it has a keyboard path", () => {
    expect(opensMenu({ key: "F10", shiftKey: true })).toBe(true)
    expect(opensMenu({ key: "ContextMenu", shiftKey: false })).toBe(true)
    expect(opensMenu({ key: "F10", shiftKey: false })).toBe(false)
    expect(opensMenu({ key: "Enter", shiftKey: true })).toBe(false)
    expect(MENU_HINT).toBe("Shift+F10 opens its menu")
  })
})
