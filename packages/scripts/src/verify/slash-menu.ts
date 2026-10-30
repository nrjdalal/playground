import type { Browser, Result, Target, Viewport } from "./checks"

// The most rows the composer's / menu shows before it scrolls inside itself.
export const MENU_ROWS = 7
// A pixel for rounding.
const SLACK = 1

// The open menu as drawn: its list's top and bottom and the selected row's, in pixels from the viewport's top, the menu's left and right and the composer's, from its left, every row's height, and the skills it lists in order. Null when no menu is open.
export type MenuMeasure = {
  bottom: number
  boxLeft: number
  boxRight: number
  left: number
  listBottom: number
  listTop: number
  names: string[]
  right: number
  rowHeights: number[]
  selected: string | null
  top: number
} | null

// Pure: a compact menu whose rows are one height, which scrolls inside itself, and whose selected row, the one the arrows reached, is whole inside it.
export const menuResult = (check: string, menu: MenuMeasure, expected: string): Result => {
  if (!menu) return { check, detail: "typing / opened no menu", ok: false }
  const row = Math.min(...menu.rowHeights)
  const height = menu.listBottom - menu.listTop
  const fail = (detail: string): Result => ({ check, detail, ok: false })
  if (Math.max(...menu.rowHeights) - row > SLACK) return fail("its rows are not all one height")
  const past = Math.max(menu.boxLeft - menu.left, menu.right - menu.boxRight)
  if (past > SLACK) {
    const edge = menu.right - menu.boxRight > SLACK ? "right" : "left"
    return fail(`the menu runs ${past}px past the composer's ${edge} edge`)
  }
  if (height > MENU_ROWS * row + 2 * SLACK) {
    return fail(`the menu is ${height}px tall, over ${MENU_ROWS} rows of ${row}px`)
  }
  if (menu.names.length * row <= height) {
    return fail(`the menu does not scroll: all ${menu.names.length} skills fit`)
  }
  if (menu.selected !== expected) return fail(`/${menu.selected} is selected, not /${expected}`)
  const cut = Math.max(menu.listTop - menu.top, menu.bottom - menu.listBottom)
  if (cut > SLACK) return fail(`${cut}px of /${expected} is cut off by the menu's edge`)
  return { check, detail: `/${expected} is whole in a ${height}px menu`, ok: true }
}

// Reads the open menu: the cmdk list in the composer's field, and the item the arrows selected.
const MEASURE = `(() => { const field = document.getElementById("composer")?.closest('[data-slot="field"]'); const list = field?.querySelector("[cmdk-list]"); if (!list) return null; const menu = list.closest("[cmdk-root]").getBoundingClientRect(); const outer = field.getBoundingClientRect(); const items = [...list.querySelectorAll("[cmdk-item]")]; const selected = list.querySelector('[cmdk-item][aria-selected="true"]'); const box = list.getBoundingClientRect(); const own = selected?.getBoundingClientRect(); return { bottom: own?.bottom ?? 0, boxLeft: outer.left, boxRight: outer.right, left: menu.left, listBottom: box.bottom, listTop: box.top, names: items.map((item) => item.getAttribute("data-value")), right: menu.right, rowHeights: items.map((item) => item.getBoundingClientRect().height), selected: selected?.getAttribute("data-value") ?? null, top: own?.top ?? 0 } })()`

// Words filling 85% of the box's first line, then a /, so the menu opens near the box's right edge.
const NEAR_RIGHT = `(() => { const box = document.getElementById("composer"); const style = getComputedStyle(box); const pen = document.createElement("canvas").getContext("2d"); pen.font = style.font; const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); let line = ""; while (pen.measureText(line + "word ").width < room * 0.85) line += "word "; return line + "/" })()`

const SETTLE_MS = 300

// At each viewport, types / into Playground's composer, then presses ArrowDown to the last skill (past the menu's bottom edge) and once more, which wraps to the first (past its top edge), reading the menu after each, then types a / mid-line near the box's right edge; it then closes the menu and empties the box, sending nothing.
export const slashMenu = async (
  browser: Browser,
  { web }: Target,
  viewport: Viewport,
): Promise<Result[]> => {
  const at = `slash-menu ${viewport.width}`
  await browser.viewport(viewport)
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", "#composer")
  await browser.run("fill", "#composer", "/")
  await browser.run("wait", String(SETTLE_MS))
  const opened = await browser.eval<MenuMeasure>(MEASURE)
  const results = [menuResult(`${at} opens on the first skill`, opened, opened?.names[0] ?? "")]
  if (opened) {
    for (let i = 1; i < opened.names.length; i++) await browser.run("press", "ArrowDown")
    await browser.run("wait", String(SETTLE_MS))
    const last = opened.names.at(-1) ?? ""
    results.push(
      menuResult(
        `${at} ArrowDown past the bottom edge`,
        await browser.eval<MenuMeasure>(MEASURE),
        last,
      ),
    )
    await browser.run("press", "ArrowDown")
    await browser.run("wait", String(SETTLE_MS))
    results.push(
      menuResult(
        `${at} ArrowDown wraps past the top edge`,
        await browser.eval<MenuMeasure>(MEASURE),
        opened.names[0] ?? "",
      ),
    )
  }
  await browser.run("fill", "#composer", await browser.eval<string>(NEAR_RIGHT))
  await browser.run("wait", String(SETTLE_MS))
  const right = await browser.eval<MenuMeasure>(MEASURE)
  results.push(menuResult(`${at} a / mid-line near the right edge`, right, right?.names[0] ?? ""))
  await browser.run("press", "Escape")
  await browser.run("fill", "#composer", "")
  return results
}
