import { type Browser, type Result, type Target } from "./checks"

// Under a layout unit (1/64px), so a part drawn at its natural width is never read as cut.
const SLACK = 0.01

// One sidebar row as drawn: its first words, how much taller its content is than its padding box (cut, when the box holds a fixed height; neither measure counts the border, so none is subtracted), its height when it is a menu row (null for a member row and for the footer's user menu, shadcn's 48px lg button), how far its words run past the box's right edge less its padding (over: how far any element runs past that edge, or past the box inside the row that cuts it with no ellipsis, a flex or grid box drawing none, so a label that never shrinks counts as well as a state; text an ellipsis ends, and screen-reader text, never count), whether, at the stock width, its first line's label (data-part="label") draws narrower than its own width, which ends it in an ellipsis (labelCut), how far its chevron's middle sits from its own (null with no chevron), and the top and bottom it covers.
export type RowBoxes = {
  bottom: number
  chevron: number | null
  cut: number
  height: number | null
  labelCut: boolean
  name: string
  over: number
  top: number
}[]

// scrollHeight and clientHeight are whole pixels, so a row whose heights are fractional reads a pixel tall without any word being cut.
const ROUNDING = 1

// The stock menu button's height, which every menu row keeps, so no sidebar row grows, and how far a measure may stray from it or a chevron from the row's middle.
const ROW_PX = 32
const HALF_PX = 0.5

// Pure: every menu row is the stock 32px, its content fits its box, no word runs past its padded edge, no label is cut at the stock width, its chevron sits at its middle, and, within one list, no row covers another.
export const rowsFitResult = (check: string, groups: RowBoxes[]): Result => {
  const rows = groups.flat()
  if (!rows.length) return { check, detail: "no sidebar row was drawn", ok: false }
  const problems = [
    ...rows
      .filter((row) => row.height !== null && Math.abs(row.height - ROW_PX) > HALF_PX)
      .map((row) => `"${row.name}" is ${row.height!.toFixed(1)}px tall, not the stock ${ROW_PX}px`),
    ...rows
      .filter((row) => row.cut > ROUNDING)
      .map(
        (row) =>
          `"${row.name}" draws ${row.cut.toFixed(1)}px more than its box holds, so its words are cut`,
      ),
    ...rows
      .filter((row) => row.over > ROUNDING)
      .map(
        (row) =>
          `"${row.name}" runs its words ${row.over.toFixed(1)}px past its padded edge, so they are cut`,
      ),
    ...rows
      .filter((row) => row.labelCut)
      .map(
        (row) =>
          `"${row.name}" cuts its label at the stock width, so the title did not give way first`,
      ),
    ...rows
      .filter((row) => row.chevron !== null && Math.abs(row.chevron) > HALF_PX)
      .map(
        (row) =>
          `"${row.name}" draws its chevron ${Math.abs(row.chevron!).toFixed(1)}px off its middle`,
      ),
  ]
  for (const group of groups) {
    const sorted = [...group].sort((a, b) => a.top - b.top)
    for (const [a, b] of sorted.slice(1).map((row, i) => [sorted[i]!, row] as const)) {
      if (b.top < a.bottom - SLACK)
        problems.push(`"${a.name}" and "${b.name}" overlap by ${(a.bottom - b.top).toFixed(1)}px`)
    }
  }
  if (problems.length) return { check, detail: problems.join("; "), ok: false }
  return {
    check,
    detail: `${rows.length} rows drawn, each menu row ${ROW_PX}px, none cut, none past its edge, none overlapping`,
    ok: true,
  }
}

// A narrow sidebar, where a part that fits the stock 16rem can still run past its row's edge (a tester's narrow read).
const NARROW = "11rem"

// Waits for the sidebar to draw, then reads every visible row and member button that carries words, with the chevron beside it (a placeholder row carries none), grouped by the list each sits in, since rows of different lists never cover each other; it reads them at the stock width, then again with the sidebar at NARROW, naming those rows "(at NARROW)", and puts the width back.
const MEASURE = `new Promise((resolve) => { const started = Date.now(); const visible = () => [...document.querySelectorAll('[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]')].filter((b) => b.getBoundingClientRect().height > 0 && (b.textContent ?? "").trim() !== ""); const read = (at) => { const groups = new Map(); for (const b of visible()) { const box = b.getBoundingClientRect(); const edge = box.right - parseFloat(getComputedStyle(b).paddingRight); const clip = (el) => { for (let a = el.parentElement; a && a !== b; a = a.parentElement) if (getComputedStyle(a).overflowX !== "visible") return a; return null }; const ellipsis = (a) => { const s = getComputedStyle(a); return s.textOverflow === "ellipsis" && !/flex|grid/.test(s.display) }; const over = Math.max(0, ...[...b.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).position !== "absolute").map((el) => { const a = clip(el); if (a && ellipsis(a)) return 0; return el.getBoundingClientRect().right - Math.min(edge, a ? a.getBoundingClientRect().right : edge) })); const labelCut = at === "" && [...b.querySelectorAll('[data-part="label"]')].some((l) => { const copy = l.cloneNode(true); copy.style.cssText = "position:absolute;visibility:hidden;flex:none;width:max-content;max-width:none"; l.parentElement.append(copy); const natural = copy.getBoundingClientRect().width; copy.remove(); return natural - l.getBoundingClientRect().width > 0.5 }); const action = b.closest("li")?.querySelector(':scope > [data-sidebar="menu-action"]'); const mark = action?.getBoundingClientRect(); const row = { bottom: box.bottom, chevron: mark ? (mark.top + mark.bottom) / 2 - (box.top + box.bottom) / 2 : null, cut: b.scrollHeight - b.clientHeight, height: b.dataset.sidebar === "menu-button" && !b.closest('[data-sidebar="footer"]') ? box.height : null, labelCut, name: (b.textContent ?? "").trim().slice(0, 60) + at, over, top: box.top }; const list = b.closest("ul"); const group = groups.get(list) ?? []; group.push(row); groups.set(list, group) } return [...groups.values()] }; const look = () => { if (!visible().length) { if (Date.now() - started > 10000) return resolve([]); return setTimeout(look, 200) } const stock = read(""); const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]'); if (!wrapper) return resolve(stock); const was = wrapper.style.getPropertyValue("--sidebar-width"); wrapper.style.setProperty("--sidebar-width", ${JSON.stringify(NARROW)}); setTimeout(() => { const narrow = read(${JSON.stringify(` (at ${NARROW})`)}); wrapper.style.setProperty("--sidebar-width", was); resolve([...stock, ...narrow]) }, 400) }; look() })`

// On /dashboard at the current viewport, reads every sidebar row, at the stock width and at NARROW, and fails when a menu row is not 32px, its words are cut or run past its padded edge, its label is cut at the stock width, its chevron sits off its middle, or two rows of one list cover each other.
export const rowsFit = async (browser: Browser, { web }: Target): Promise<Result> => {
  const check = "rows"
  await browser.visit(`${web}/dashboard`)
  return rowsFitResult(check, await browser.eval<RowBoxes[]>(MEASURE))
}
