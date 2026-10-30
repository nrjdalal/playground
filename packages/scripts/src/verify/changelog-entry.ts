import type { Browser, Result, Target, Viewport } from "./checks"

const PHONE: Viewport = { height: 844, width: 390 }

// The drawer as read after a first load with ?entry=, then after Escape: the open dialog's text (null when none is open) and the page's query string each time.
export type DrawerMeasure = {
  closedSearch: string
  openedText: string | null
}

// Pure: the link opens the drawer on the entry it names, and closing the drawer drops ?entry= from the URL.
export const drawerResult = (check: string, drawer: DrawerMeasure, entry: string): Result => {
  if (drawer.openedText === null) return { check, detail: "?entry= opened no drawer", ok: false }
  if (!drawer.openedText.includes(entry)) {
    return { check, detail: "the drawer opened on another change", ok: false }
  }
  if (new URLSearchParams(drawer.closedSearch).has("entry")) {
    return { check, detail: "closing the drawer left ?entry= in the URL", ok: false }
  }
  return { check, detail: "?entry= opens the drawer on its change, and closing drops it", ok: true }
}

type Change = { pr: string; text: string }

// A merge older than the newest change, so a drawer showing the newest one, which the page falls back to, never passes for the link's; its PR number makes the link a person shares (?entry=pr-209).
const LINKED = `fetch("/api/v1/apps/changelog", { credentials: "include" }).then((response) => response.json()).then((body) => { const merge = (body.data?.entries ?? []).filter((entry) => entry.kind !== "release").sort((a, b) => b.at.localeCompare(a.at)).slice(1).find((entry) => entry.sourceKey && /\\/pull\\/\\d+$/.test(entry.link ?? "")); return merge ? { pr: merge.link.match(/\\/pull\\/(\\d+)$/)[1], text: merge.text } : null })`

const DIALOG = `new Promise((resolve) => { const started = Date.now(); const read = () => { const dialog = document.querySelector('[role="dialog"]'); if (dialog?.textContent) return resolve(dialog.textContent); if (Date.now() - started > 5000) return resolve(null); setTimeout(read, 100) }; read() })`

const CLOSED = `new Promise((resolve) => { const started = Date.now(); const read = () => { if (!new URLSearchParams(location.search).has("entry") || Date.now() - started > 3000) return resolve(location.search); setTimeout(read, 100) }; read() })`

// At a phone's width, opens the Changelog by a link naming a merge older than its newest change, reads the drawer, then presses Escape and reads the URL. Read-only: verify's visit marks nothing read.
export const changelogEntry = async (browser: Browser, { web }: Target): Promise<Result> => {
  const check = `changelog-entry ${PHONE.width}`
  await browser.viewport(PHONE)
  await browser.visit(`${web}/dashboard/apps/changelog`)
  const linked = await browser.eval<Change | null>(LINKED)
  if (!linked) {
    return {
      check,
      detail:
        "the Changelog holds no merge older than its newest change; on a fixture stack run bun run changelog fixture",
      ok: false,
    }
  }
  await browser.visit(`${web}/dashboard/apps/changelog?entry=pr-${linked.pr}`)
  const openedText = await browser.eval<string | null>(DIALOG)
  if (openedText !== null) await browser.run("press", "Escape")
  const closedSearch = await browser.eval<string>(CLOSED)
  return drawerResult(check, { closedSearch, openedText }, linked.text)
}
