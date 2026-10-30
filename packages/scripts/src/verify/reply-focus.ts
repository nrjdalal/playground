import { join } from "node:path"

import type { Browser, Result, Target } from "./checks"

const ROOT = join(import.meta.dir, "../../../..")

// Pure: Chat about it hands focus to Playground's box in the click's own frame, so a paste sent at once lands there (a dictation app's Cmd+V right after the click went to the button).
export const focusResult = (check: string, active: string | null): Result =>
  active === "composer"
    ? { check, detail: "focus is in the box the moment Chat about it is clicked", ok: true }
    : {
        check,
        detail: `focus is on ${active ?? "nothing"} the moment Chat about it is clicked, not the box`,
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

// Clicks the posted card's own Chat about it and reads where focus is in the same task, before any frame runs.
const click = (tag: string) =>
  `(() => { const button = document.querySelector(${JSON.stringify(`[aria-label="Chat about ${tag}"]`)}); if (!button) return "no card"; button.click(); const active = document.activeElement; return active?.id || active?.getAttribute("data-slot") || active?.tagName.toLowerCase() || null })()`

// At 1280x800, opens /dashboard, waits for the card's Chat about it and for Playground's box, clicks it and reads where focus is at once; on a loaded host the box can mount after the card, and a click then has no box to focus.
export const clickFocus = async (
  browser: Pick<Browser, "eval" | "run" | "viewport" | "visit">,
  web: string,
  check: string,
  tag: string,
): Promise<Result> => {
  await browser.viewport({ height: 800, width: 1280 })
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", `[aria-label="Chat about ${tag}"]`)
  await browser.run("wait", "#composer")
  return focusResult(check, await browser.eval<string | null>(click(tag)))
}

// At 1280x800, posts a card, clicks its Chat about it on /dashboard and reads where focus is at once; it then settles the card, sending nothing, and fails when the card is left open.
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
