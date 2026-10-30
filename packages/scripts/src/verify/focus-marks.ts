import { Browser, type Result, type Target, VIEWPORTS } from "./checks"

// The dashboard pages whose controls are read: the Dashboard with its aside, and a page of each table kind.
export const FOCUS_PAGES = [
  "/dashboard",
  "/dashboard/apps/changelog",
  "/dashboard/sessions",
  "/dashboard/settings",
  "/dashboard/system",
]

// What a page's read found: how many focusable controls it focused, and the names of those whose focus changed nothing the eye sees.
export type FocusRead = { checked: number; unmarked: string[] } | null

// Pure: passes when every focusable control on the page shows its focus, else names each that does not (with no ring, a control whose ring was its only mark showed nothing).
export const focusMarksResult = (page: string, read: FocusRead): Result => {
  const check = `focus-marks ${page}`
  if (!read) return { check, detail: "the page could not be read", ok: false }
  if (!read.unmarked.length)
    return { check, detail: `all ${read.checked} focusable controls show their focus`, ok: true }
  const shown = read.unmarked.slice(0, 12).join("; ")
  const more = read.unmarked.length > 12 ? ` and ${read.unmarked.length - 12} more` : ""
  return {
    check,
    detail: `${read.unmarked.length} of ${read.checked} show no focus: ${shown}${more}`,
    ok: false,
  }
}

// With transitions held still, so a fill reads at once, focuses each control as a key would (focusVisible) and compares what the eye sees on it, its parent and the field around it, before and after: a border's colour only where it has width, fill, text colour, underline, and a shadow or outline only when one shows; a control whose look does not change is unmarked.
const READ = `(() => { const still = document.createElement("style"); still.textContent = "*, *::before, *::after { transition: none !important; animation: none !important }"; document.head.append(still); const clear = (s) => s.replace(/rgba\\(0, 0, 0, 0\\)/g, ""); const shadow = (s) => (s === "none" || !/(rgb|lab|oklab|oklch|hsl)/.test(clear(s)) ? "none" : s); const look = (el) => { if (!el) return ""; const c = getComputedStyle(el); const edge = (side) => (parseFloat(c["border" + side + "Width"]) > 0 ? c["border" + side + "Color"] : "none"); return [edge("Top"), edge("Right"), edge("Bottom"), edge("Left"), c.backgroundColor, c.color, c.textDecorationLine, shadow(c.boxShadow), c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0 ? c.outlineStyle + c.outlineColor : "none"].join("|") }; const read = (el) => [look(el), look(el.parentElement), look(el.closest('[data-slot="input-group"]'))].join("#"); const all = [...document.querySelectorAll('a[href], button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.getBoundingClientRect().width > 0 && !el.closest('[inert], [hidden], nextjs-portal')); const unmarked = []; let checked = 0; for (const el of all) { document.activeElement?.blur(); const before = read(el); el.focus({ focusVisible: true }); if (document.activeElement !== el) continue; checked++; if (read(el) === before) unmarked.push((el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30) || el.tagName.toLowerCase()).replace(/\\s+/g, " ") + " [" + (el.getAttribute("data-slot") || el.tagName.toLowerCase()) + "]") } document.activeElement?.blur(); still.remove(); return { checked, unmarked: [...new Set(unmarked)] } })()`

// Every focusable control on the page, at 1280, shows its keyboard focus with no ring: a lit border or a fill; it only focuses and blurs, so the page is left as found.
export const focusMarksPage = async (
  browser: Browser,
  { web }: Target,
  page: string,
): Promise<Result> => {
  await browser.viewport(VIEWPORTS[0]!)
  await browser.visit(`${web}${page}`)
  await browser.run("wait", "main")
  await browser.run("wait", "2000")
  return focusMarksResult(page, await browser.eval<FocusRead>(READ))
}
