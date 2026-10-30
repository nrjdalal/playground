import { Browser, type Result, type Target, VIEWPORTS } from "./checks"

// The sidebar state after each step, in order: on load, a click on the rail, a click on the collapsed rail, Cmd+B, Cmd+B again; null where the sidebar could not be read.
export type RailStates = (string | null)[]

const STEPS = ["on load", "rail click", "second rail click", "Cmd+B", "second Cmd+B"]
const EXPECTED = ["expanded", "collapsed", "expanded", "collapsed", "expanded"]

// The pages whose sidebar draws a rail: the Dashboard's shell and the docs' own layout.
export const RAIL_PAGES = ["/dashboard", "/docs"]

// Pure: passes when each step left the page's sidebar as expected, else names the first step that did not.
export const railResult = (states: RailStates, page: string): Result => {
  const wrong = EXPECTED.findIndex((want, i) => states[i] !== want)
  return {
    check: `rail ${page}`,
    detail:
      wrong === -1
        ? STEPS.map((step, i) => `${step} ${states[i]}`).join(", ")
        : `after ${STEPS[wrong]} the sidebar reads ${states[wrong] ?? "nothing"}, not ${EXPECTED[wrong]}`,
    ok: wrong === -1,
  }
}

// The sidebar's state, and whether a transition inside it still runs: the container's 200ms slide carries the rail, so the rail's own animations never show it.
type RailRead = { moving: boolean; state: string | null } | null
const READ = `(() => { const bar = document.querySelector('[data-slot="sidebar"][data-state]'); return bar ? { moving: bar.getAnimations({ subtree: true }).some((a) => a instanceof CSSTransition), state: bar.getAttribute("data-state") } : null })()`
// How long a step waits for its state to land and its rail to rest, read every POLL_MS: a loaded machine can draw a toggle well past the 200ms slide.
const STEP_MS = 5000
const POLL_MS = 100
// The middle of the rail's part on screen: an offcanvas sidebar's collapsed rail hangs half past the left edge (the docs').
const CENTRE = `(() => { const rail = document.querySelector('[data-sidebar="rail"]'); if (!rail) return null; const box = rail.getBoundingClientRect(); const left = Math.max(box.left, 0), right = Math.min(box.right, innerWidth); return right > left ? [Math.round((left + right) / 2), Math.round(box.top + box.height / 2)] : null })()`

// The sidebar rail toggles the sidebar (once its tooltip's trigger replaced the rail's own click, so a click on it did nothing): on the page at 1280, a real click on the middle of the rail's part on screen collapses the sidebar, a second on the collapsed rail expands it, and Cmd+B does both too, each read once the sidebar shows the step's state and its slide is over, so the next click's target is read from a rail at rest. It ends with the sidebar open, as it found it.
export const rail = async (browser: Browser, { web }: Target, page: string): Promise<Result> => {
  await browser.viewport(VIEWPORTS[0]!)
  await browser.visit(`${web}${page}`)
  await browser.run("wait", '[data-sidebar="rail"]')
  const states: RailStates = []
  // Waits for the step's state and a sidebar at rest; when the wait runs out, the check ends on the state it last read, or on a rail still sliding.
  const settle = async (): Promise<Result | null> => {
    const step = states.length
    let read: RailRead = null
    for (let waited = 0; ; waited += POLL_MS) {
      read = await browser.eval<RailRead>(READ)
      if ((read?.state === EXPECTED[step] && !read.moving) || waited >= STEP_MS) break
      await browser.run("wait", String(POLL_MS))
    }
    states.push(read?.state ?? null)
    if (read?.state !== EXPECTED[step]) return railResult(states, page)
    if (!read.moving) return null
    return {
      check: `rail ${page}`,
      detail: `after ${STEPS[step]} the sidebar reads ${read.state} but its rail still slides after ${STEP_MS}ms`,
      ok: false,
    }
  }
  const failed = await settle()
  if (failed) return failed
  for (let i = 0; i < 2; i++) {
    const centre = await browser.eval<[number, number] | null>(CENTRE)
    if (!centre)
      return { check: `rail ${page}`, detail: "no sidebar rail drawn at 1280", ok: false }
    await browser.run("mouse", "move", String(centre[0]), String(centre[1]))
    await browser.run("mouse", "down")
    await browser.run("mouse", "up")
    const failed = await settle()
    if (failed) return failed
  }
  for (let i = 0; i < 2; i++) {
    await browser.run("press", "Meta+b")
    const failed = await settle()
    if (failed) return failed
  }
  return railResult(states, page)
}
