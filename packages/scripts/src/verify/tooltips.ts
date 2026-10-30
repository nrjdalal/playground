import { TOOLTIP_DELAY_MS } from "../../../../web/next/src/lib/tooltip"
import { type Browser, type Result, type Target, VIEWPORTS } from "./checks"

// The most a tooltip may take to open after keyboard focus reaches its trigger, which opens it at once: a frame or two.
export const OPEN_LIMIT_MS = 300

// How long past the shared hover delay a tooltip may take to open: a frame or two, as on focus.
export const HOVER_SLACK_MS = OPEN_LIMIT_MS

// What still draws the browser's own box once a page settles: an element with a title but a frame (whose title is its accessible name, tests/web/next/src/native-title.test.ts) and an svg <title>, each as its tag and the words it would show; one with no words draws nothing (recharts gives every chart an empty <title>), so it is left out.
const NATIVE = `(() => [...document.querySelectorAll("[title]:not(iframe), svg title")].map((el) => [el.tagName.toLowerCase(), ((el.hasAttribute("title") ? el.getAttribute("title") : el.textContent) ?? "").trim()]).filter(([, words]) => words).map(([tag, words]) => tag + " " + JSON.stringify(words.slice(0, 60))))()`

// Pure: a page passes with no native box left on it.
export const nativeResult = (route: string, found: string[]): Result => ({
  check: `tooltips ${route}`,
  detail: found.length
    ? `${found.length} native title box${found.length === 1 ? "" : "es"}: ${found.slice(0, 5).join(", ")}`
    : "no native title box",
  ok: found.length === 0,
})

// Pure: a trigger passes when its tooltip opened, within the limit, saying what its hover says.
export const openResult = (
  check: string,
  opened: { ms: number | null; text: string | null },
  expected: string,
): Result => {
  if (opened.ms === null || opened.text === null)
    return { check, detail: "no tooltip opened", ok: false }
  const ms = Math.round(opened.ms)
  if (!opened.text.includes(expected))
    return { check, detail: `the tooltip reads "${opened.text}", not "${expected}"`, ok: false }
  return {
    check,
    detail: `opened in ${ms}ms (limit ${OPEN_LIMIT_MS}ms)`,
    ok: ms <= OPEN_LIMIT_MS,
  }
}

// The watch on the trigger is listeners alone: on its pointerenter or focus, whichever comes first, it stamps the reach time into the document's dataset, and the popup's own open animation stamps the open, so the two stamps alone say how long the tooltip took (a window global did not survive from the watch's eval to the driver's, and the page's own timers and observers ran throttled or in a context of their own under the driver, so neither could carry the reading out). A popup leaving stamps nothing: it carries data-closed while its leave animation runs. ARM clears previous stamps.
const ARM = (expected: string) =>
  `(() => { delete document.documentElement.dataset.verifyEntered; delete document.documentElement.dataset.verifyOpened; const trigger = document.querySelector("[data-verify-tip]"); const mark = () => { document.documentElement.dataset.verifyEntered ??= String(Math.round(performance.now())) }; trigger.addEventListener("pointerenter", mark, { once: true }); trigger.addEventListener("focus", mark, { once: true }); const onOpen = (event) => { const el = event.target; if (!(el instanceof Element) || !el.matches('[data-slot="tooltip-content"]') || el.hasAttribute("data-closed") || !el.textContent.includes(${JSON.stringify(expected)})) return; document.documentElement.dataset.verifyOpened ??= String(Math.round(performance.now())); document.removeEventListener("animationstart", onOpen, true) }; document.addEventListener("animationstart", onOpen, true); return true })()`

// Pure: a hovered trigger passes when its tooltip waited the shared delay, then opened within the slack, saying what its hover says.
export const hoverResult = (
  check: string,
  opened: { ms: number | null; text: string | null },
  expected: string,
): Result => {
  if (opened.ms === null || opened.text === null)
    return { check, detail: "no tooltip opened", ok: false }
  const ms = Math.round(opened.ms)
  if (!opened.text.includes(expected))
    return { check, detail: `the tooltip reads "${opened.text}", not "${expected}"`, ok: false }
  if (ms < TOOLTIP_DELAY_MS)
    return { check, detail: `opened in ${ms}ms, before the ${TOOLTIP_DELAY_MS}ms delay`, ok: false }
  return {
    check,
    detail: `opened in ${ms}ms (from ${TOOLTIP_DELAY_MS}ms to ${TOOLTIP_DELAY_MS + HOVER_SLACK_MS}ms)`,
    ok: ms <= TOOLTIP_DELAY_MS + HOVER_SLACK_MS,
  }
}

// One probe, fresh eval: how long the tooltip took from the reach (the two stamps; where no open animation ran, the probe's own moment stands in, an upper bound by one poll), and the popup's words. A popup still fading from a neighbour passes, its words are not the ones expected.
const PROBE = (expected: string) =>
  `(() => { const at = Number(document.documentElement.dataset.verifyEntered ?? "") || null; const opened = Number(document.documentElement.dataset.verifyOpened ?? "") || null; const popup = at === null ? null : [...document.querySelectorAll('[data-slot="tooltip-content"]')].find((el) => el.textContent.includes(${JSON.stringify(expected)})); if (at === null || !popup) return null; return { ms: Math.round((opened ?? performance.now()) - at), text: popup.textContent.slice(0, 200) } })()`

// Polls the probe from the driver until the tooltip shows or about `within` ms of page time pass (800 on focus; a hover adds the shared delay).
const probeUntilOpen = async (
  browser: Browser,
  expected: string,
  within = 800,
): Promise<{ ms: number | null; text: string | null }> => {
  let opened: { ms: number | null; text: string | null } = { ms: null, text: null }
  for (let i = 0; i < within / 40 && opened.ms === null; i++) {
    await browser.run("wait", "40")
    opened = (await browser.eval<{ ms: number; text: string } | null>(PROBE(expected))) ?? opened
  }
  return opened
}

// Marks a trigger for the run by a CSS selector, or returns false when the page has none.
const mark = (selector: string) =>
  `(() => { document.querySelector("[data-verify-tip]")?.removeAttribute("data-verify-tip"); const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.setAttribute("data-verify-tip", ""); return true })()`

// The two triggers every dashboard page's sidebar has on a fixture stack: the Claude dispatcher row's first usage reading (the week), in the header, hovered, and the header's GitHub icon, reached by Tab from the top of the page. The row's own tooltip shows on the collapsed rail alone, so the hover lands on the reading's own trigger.
const USAGE = '[data-sidebar="header"] [data-usage] span[data-level]'
const GITHUB = '[data-sidebar="header"] a[target="_blank"]'

// At 1280: each page leaves no native title box, then on /dashboard the dispatcher's usage tooltip opens on hover after the shared delay, and GitHub's on keyboard focus at once.
export const tooltips = async (
  browser: Browser,
  { web }: Target,
  routes: string[],
): Promise<Result[]> => {
  await browser.viewport(VIEWPORTS[0]!)
  const results: Result[] = []
  for (const route of routes) {
    await browser.visit(`${web}${route}`)
    await browser.run("wait", "1500")
    results.push(nativeResult(route, await browser.eval<string[]>(NATIVE)))
  }
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", USAGE)
  await browser.eval(mark(USAGE))
  await browser.eval(ARM("Week"))
  await browser.run("hover", "[data-verify-tip]")
  results.push(
    hoverResult(
      "tooltips hover: the dispatcher's usage",
      await probeUntilOpen(browser, "Week", TOOLTIP_DELAY_MS + 800),
      "Week",
    ),
  )
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", GITHUB)
  await browser.eval(mark(GITHUB))
  await browser.eval(ARM("Open pull requests"))
  let focused = false
  for (let i = 0; i < 12 && !focused; i++) {
    await browser.run("press", "Tab")
    focused = await browser.eval<boolean>(
      `document.activeElement === document.querySelector("[data-verify-tip]")`,
    )
  }
  results.push(
    focused
      ? openResult(
          "tooltips focus: the GitHub icon",
          await probeUntilOpen(browser, "Open pull requests"),
          "Open pull requests",
        )
      : { check: "tooltips focus: the GitHub icon", detail: "Tab never reached it", ok: false },
  )
  return results
}
