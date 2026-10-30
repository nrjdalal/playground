import type { Browser, Result, Target } from "./checks"

// When a dictation app pastes after a send: its Cmd+V goes wherever focus is, and one on a button lands nowhere.
const AFTER_MS = [500, 2000, 6000]

// Pure: focus is in Playground's box at each moment after a click on Send, so the next paste lands there.
export const sendFocusResult = (check: string, active: string | null): Result =>
  active === "composer"
    ? { check, detail: "focus is in the box, where a paste lands", ok: true }
    : {
        check,
        detail: `focus is on ${active ?? "nothing"}, not the box: a paste now lands nowhere`,
        ok: false,
      }

const ACTIVE = `(() => { const active = document.activeElement; return active?.id === "composer" ? "composer" : active?.getAttribute("aria-label") || active?.tagName.toLowerCase() || null })()`

// At 1280x800 on /dashboard: first a send the composer refuses (words ending in a backslash the send would keep), then a message, each by a real click on Send, reading where focus is after each: 0.5s after the refusal, and 0.5, 2 and 6s after the send; the message goes to the fixture's session.
export const sendFocus = async (browser: Browser, { web }: Target): Promise<Result[]> => {
  await browser.viewport({ height: 800, width: 1280 })
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", "#composer")
  await browser.run("fill", "#composer", "verify send-focus \\ \\")
  await browser.run("click", 'button[aria-label^="Send to"]')
  await browser.run("wait", "500")
  const results: Result[] = [
    sendFocusResult("send-focus 0.5s after a refused click on Send", await browser.eval(ACTIVE)),
  ]
  await browser.run("fill", "#composer", "verify send-focus")
  await browser.run("click", 'button[aria-label^="Send to"]')
  let waited = 0
  for (const at of AFTER_MS) {
    await browser.run("wait", String(at - waited))
    waited = at
    results.push(
      sendFocusResult(`send-focus ${at / 1000}s after a click on Send`, await browser.eval(ACTIVE)),
    )
  }
  return results
}
