import type { Browser, Result, Target, Viewport } from "./checks"

// A pixel for rounding.
const SLACK = 1
const SETTLE_MS = 400

type Box = { bottom: number; left: number; right: number; top: number }

// The aside's tab bar as drawn: its box, its squares' names and whether Tab can reach it before the panes it switches.
export type BarMeasure = {
  bar: Box
  firstInOrder: boolean
  names: string[]
  reachable: boolean
} | null

// One pane scrolled to its end: the bottom of its last content, whether it had to scroll to get there, and the place of the square selected while it shows (-1 for none).
export type PaneMeasure = { contentBottom: number; scrolled: boolean; selected: number } | null

const overlaps = (a: Box, b: Box) =>
  a.left < b.right - SLACK &&
  b.left < a.right - SLACK &&
  a.top < b.bottom - SLACK &&
  b.top < a.bottom - SLACK

// Pure: the bar names every square and comes before the panes in Tab's order, so a keyboard reaches each square by Tab, then the arrows.
export const reachResult = (check: string, measure: BarMeasure): Result => {
  if (!measure) return { check, detail: "no tab bar beside the chat", ok: false }
  const unnamed = measure.names.filter((name) => !name.trim()).length
  if (unnamed) return { check, detail: `${unnamed} square(s) have no name`, ok: false }
  if (!measure.reachable) return { check, detail: "no square takes focus by Tab", ok: false }
  if (!measure.firstInOrder)
    return { check, detail: "no pane follows the bar in Tab's order", ok: false }
  return { check, detail: `Tab reaches ${measure.names.join(", ")}`, ok: true }
}

// Pure: with the clicked square's pane scrolled to its end, its last content ends above the aside's bottom edge, where the bar hides, so the clipped aside cuts off no last line (shown, the bar floats see-through over it by the owner's ask).
export const paneResult = (
  check: string,
  edge: number,
  pane: PaneMeasure,
  clicked: number,
): Result => {
  if (!pane) return { check, detail: "no pane shows", ok: false }
  if (pane.selected !== clicked) {
    const selected = pane.selected < 0 ? "no square" : `square ${pane.selected + 1}`
    return {
      check,
      detail: `${selected} is selected after a click on square ${clicked + 1}`,
      ok: false,
    }
  }
  const room = Math.round(edge - pane.contentBottom)
  const how = pane.scrolled ? "scrolled to its end" : "with nothing to scroll"
  return room >= -SLACK
    ? { check, detail: `its last line ends ${room}px above the aside's edge, ${how}`, ok: true }
    : { check, detail: `the aside's edge cuts off ${-room}px of its last line, ${how}`, ok: false }
}

// Pure: a pane's own layers stay under the bar, so nothing it holds paints over a square, as a table's sticky header did.
export const topResult = (check: string, onTop: boolean | null): Result =>
  onTop === null
    ? { check, detail: "no pane shows", ok: false }
    : onTop
      ? { check, detail: "the bar stays above the pane's highest layer", ok: true }
      : { check, detail: "the pane's highest layer paints over the bar", ok: false }

// Pure: on a phone the bar, in a row of its own, covers nothing it is measured against (the composer).
export const clearResult = (
  check: string,
  bar: Box,
  others: Record<string, Box | null>,
): Result => {
  const missing = Object.entries(others)
    .filter(([, other]) => other === null)
    .map(([name]) => name)
  if (missing.length) return { check, detail: `no ${missing.join(" and ")} shows`, ok: false }
  const hit = Object.entries(others)
    .filter((entry): entry is [string, Box] => entry[1] !== null && overlaps(bar, entry[1]))
    .map(([name]) => name)
  return hit.length
    ? { check, detail: `the bar covers the ${hit.join(" and ")}`, ok: false }
    : { check, detail: `the bar clears the ${Object.keys(others).join(" and ")}`, ok: true }
}

// Pure: on a phone the sidebar's Menu is the bar's own last square, in place of the shell's floating button.
export const menuResult = (check: string, inBar: boolean): Result =>
  inBar
    ? { check, detail: "Menu sits in the bar", ok: true }
    : { check, detail: "no Menu square in the bar", ok: false }

const LIST = `document.querySelector('[role="tab"][aria-label^="Pages"]')?.closest('[role="tablist"]')`

const BAR = `(() => { const list = ${LIST}; if (!list) return null; const tabs = [...list.querySelectorAll('[role="tab"]')]; const panel = list.closest('[data-slot="tabs"]').querySelector('[data-slot="tabs-content"]'); const box = list.getBoundingClientRect(); return { bar: { bottom: box.bottom, left: box.left, right: box.right, top: box.top }, firstInOrder: Boolean(panel && list.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING), names: tabs.map((tab) => tab.getAttribute("aria-label") ?? ""), reachable: tabs.some((tab) => tab.tabIndex >= 0) } })()`

// Scrolls the pane that shows to its end and reads where its content stops: the lowest of its children's boxes, so its own bottom padding never counts as content.
const PANE = `(() => { const list = ${LIST}; const panel = [...list.closest('[data-slot="tabs"]').querySelectorAll('[data-slot="tabs-content"]')].find((pane) => !pane.hidden && pane.getBoundingClientRect().height > 0); if (!panel) return null; const scrolled = panel.scrollHeight > panel.clientHeight; panel.scrollTop = panel.scrollHeight; const bottoms = [...panel.children].map((child) => child.getBoundingClientRect()).filter((box) => box.height > 1).map((box) => box.bottom); return { contentBottom: bottoms.length ? Math.max(...bottoms) : panel.getBoundingClientRect().top, scrolled, selected: [...list.querySelectorAll('[role="tab"]')].findIndex((tab) => tab.getAttribute("aria-selected") === "true") } })()`

// the bar hides as a dock does (dashboard-aside.tsx's BAR_NEAR_PX), so the on-top probe first calls it up as a pointer near the aside's bottom does, then waits out its 200ms slide
const SHOW = `(() => { const tabs = ${LIST}?.closest('[data-slot="tabs"]'); if (!tabs) return false; const box = tabs.getBoundingClientRect(); tabs.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + box.width / 2, clientY: box.bottom - 10 })); return true })()`

// Lays a layer over the pane that shows, at the highest z-index there is, and reads whether the bar's centre still answers as the bar.
const ON_TOP = `(() => { const list = ${LIST}; const panel = [...list.closest('[data-slot="tabs"]').querySelectorAll('[data-slot="tabs-content"]')].find((pane) => !pane.hidden && pane.getBoundingClientRect().height > 0); if (!panel) return null; const layer = document.createElement("div"); layer.style.cssText = "position:fixed;inset:0;z-index:2147483647"; panel.append(layer); const box = list.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); layer.remove(); return Boolean(hit && list.contains(hit)) })()`

const box = (selector: string) =>
  `(() => { const el = ${selector}; if (!el) return null; const r = el.getBoundingClientRect(); return r.height ? { bottom: r.bottom, left: r.left, right: r.right, top: r.top } : null })()`

// the aside's bottom edge, which clips the panes and the hidden bar under it
const EDGE = `${LIST}?.closest('[data-slot="tabs"]')?.getBoundingClientRect().bottom ?? null`

const MENU_IN_BAR = `Boolean(${LIST}?.querySelector('[data-sidebar="trigger"][aria-label="Menu"]'))`
const COMPOSER = `document.getElementById("composer")?.closest("form")`

// On /dashboard, the aside's tab bar: on a wide screen each pane, scrolled to its end, keeps its last line above the aside's bottom edge, where the bar hides (shown, it floats see-through over the pane by the owner's ask), and none of its layers paints over the bar once called up; on a phone the bar holds Menu and clears the composer; at both, every square has a name and Tab reaches the bar first.
export const asideBar = async (
  browser: Browser,
  { web }: Target,
  viewport: Viewport,
): Promise<Result[]> => {
  const at = `aside-bar ${viewport.width}`
  await browser.viewport(viewport)
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", `[role="tab"][aria-label^="Pages"]`)
  await browser.run("wait", String(SETTLE_MS))
  const measure = await browser.eval<BarMeasure>(BAR)
  const results = [reachResult(`${at} squares`, measure)]
  if (!measure) return results
  if (viewport.width < 768) {
    await browser.run("wait", "#composer")
    results.push(
      clearResult(`${at} chat`, measure.bar, {
        composer: await browser.eval<Box | null>(box(COMPOSER)),
      }),
      menuResult(`${at} menu`, await browser.eval<boolean>(MENU_IN_BAR)),
    )
    return results
  }
  const edge = (await browser.eval<number | null>(EDGE)) ?? measure.bar.top
  // by place, since a square's name carries its count, which can change between the reads; the pane counts only while the square clicked is the one selected
  for (const [index, name] of measure.names.entries()) {
    await browser.eval(`${LIST}?.querySelectorAll('[role="tab"]')[${index}]?.click()`)
    await browser.run("wait", String(SETTLE_MS))
    results.push(
      paneResult(
        `${at} ${name.split(" · ")[0]}`,
        edge,
        await browser.eval<PaneMeasure>(PANE),
        index,
      ),
    )
    await browser.eval(SHOW)
    await browser.run("wait", String(SETTLE_MS))
    results.push(
      topResult(`${at} ${name.split(" · ")[0]} on top`, await browser.eval<boolean | null>(ON_TOP)),
    )
  }
  return results
}
