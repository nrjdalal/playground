import { join } from "node:path"

import type { Browser, Result, Target } from "./checks"

const ROOT = join(import.meta.dir, "../../../..")

// Pure: a card's Reply with its box empty hands focus to Playground's composer, reading re #iN:, in the click's own frame, so a paste sent at once lands there (a dictation app's Cmd+V right after the click went to the button).
export const focusResult = (check: string, active: string | null): Result =>
  active === "composer"
    ? {
        check,
        detail: "focus is in the composer, reading re #iN:, the moment Reply is clicked",
        ok: true,
      }
    : {
        check,
        detail: `focus is on ${active ?? "nothing"} the moment Reply is clicked, not the composer reading re #iN:`,
        ok: false,
      }

const lastLine = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes).trim().split("\n").at(-1) ?? ""

// Posts one decision into this checkout's own database for the card to show, and returns its id and #iN tag, or the reason bun run ask gave for refusing.
const postCard = (): { id: string; tag: string } | { refused: string } => {
  const run = Bun.spawnSync(["bun", "run", "ask", "new"], {
    cwd: ROOT,
    stdin: new TextEncoder().encode(
      JSON.stringify({
        from: "dispatcher",
        preview: { text: "Nothing happens: verify reply-focus posted it.", type: "ask" },
        title: "verify reply-focus",
      }),
    ),
  })
  const id = run.stdout.toString().trim()
  const tag = new TextDecoder().decode(run.stderr).match(/#i\d+/)?.[0]
  return run.exitCode === 0 && id && tag
    ? { id, tag }
    : { refused: lastLine(run.stderr) || `exit ${run.exitCode}` }
}

// Settles the card it posted, sending nothing, and returns why a settle failed, else null, so a card left open is reported.
const settleCard = (id: string): string | null => {
  const run = Bun.spawnSync(["bun", "run", "ask", "settle", id, "--note", "verify reply-focus"], {
    cwd: ROOT,
    stdout: "ignore",
  })
  return run.exitCode === 0 ? null : lastLine(run.stderr) || `exit ${run.exitCode}`
}

// The card's Reply button, by the aria-label inbox.tsx gives it.
export const replyButton = (tag: string): string => `[aria-label="Reply to ${tag}"]`

// Clicks the posted card's own Reply, its box empty, and reads where focus is in the same task, before any frame runs: "composer" for Playground's box once it opens with the card's re #iN:.
const click = (tag: string) =>
  `(() => { const button = document.querySelector(${JSON.stringify(replyButton(tag))}); if (!button) return "no card"; button.click(); const active = document.activeElement; if (active?.id === "composer" && active.value.startsWith(${JSON.stringify(`re ${tag}: `)})) return "composer"; return active?.id || active?.getAttribute("data-slot") || active?.tagName.toLowerCase() || null })()`

// Selects the composer's words, so one Backspace, a key React hears, empties it; agent-browser's fill with no words changes the box but not React's state, so the words came back on the next render.
const SELECT_COMPOSER = `(() => { const box = document.getElementById("composer"); box?.focus(); box?.setSelectionRange(0, box.value.length); return null })()`

// At 1280x800, opens /dashboard, waits for the card's Reply, clicks it and reads where focus is at once, then empties the composer, sending nothing.
export const clickFocus = async (
  browser: Pick<Browser, "eval" | "run" | "viewport" | "visit">,
  web: string,
  check: string,
  tag: string,
): Promise<Result> => {
  await browser.viewport({ height: 800, width: 1280 })
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", replyButton(tag))
  const result = focusResult(check, await browser.eval<string | null>(click(tag)))
  await browser.eval(SELECT_COMPOSER)
  await browser.run("press", "Backspace")
  return result
}

// At 1280x800, posts a card, clicks its Reply on /dashboard and reads where focus is at once; it then empties the composer and settles the card, sending nothing, and fails when the card is left open.
export const replyFocus = async (browser: Browser, { web }: Target): Promise<Result> => {
  const check = "reply-focus 1280"
  const card = postCard()
  if ("refused" in card)
    return {
      check,
      detail: `bun run ask new posted no card in this checkout: ${card.refused}`,
      ok: false,
    }
  try {
    const result = await clickFocus(browser, web, check, card.tag)
    const unsettled = settleCard(card.id)
    return unsettled
      ? {
          ...result,
          detail: `${result.detail}; ${card.tag} was left open: ${unsettled}`,
          ok: false,
        }
      : result
  } catch (error) {
    settleCard(card.id)
    throw error
  }
}
