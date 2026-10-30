import type { Browser, Result, Target } from "./checks"

const NAME = "verify-upload.png"
// A 1x1 PNG, so the API keeps it by its bytes.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
const SETTLE_MS = 1500
// The first retry after the route opens comes within the backoff's first steps (2s, 4s, 8s), and next dev may compile the route on its first call.
const UPLOAD_MS = 45_000

// The composer's chip for the pasted file as drawn: its state and its description, or null when it shows none.
export type ChipRead = { description: string; state: string } | null

// Pure: what the chip should show at each step: waiting as Queued while the upload gets no answer, and uploaded once the API answers.
export const chipResult = (check: string, chip: ChipRead, want: "done" | "kept"): Result => {
  if (!chip) return { check, detail: `no chip for ${NAME}: the file was dropped`, ok: false }
  if (want === "kept" && chip.state === "uploading" && chip.description === "Queued")
    return { check, detail: `the chip waits: ${chip.description}`, ok: true }
  if (want === "done" && chip.state === "done")
    return { check, detail: `uploaded: ${chip.description}`, ok: true }
  return { check, detail: `the chip reads ${chip.state}: ${chip.description}`, ok: false }
}

// Pastes the PNG into the composer as a clipboard paste carrying one file.
const PASTE = `(() => { const box = document.getElementById("composer"); if (!box) return false; const bytes = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0)); const data = new DataTransfer(); data.items.add(new File([bytes], ${JSON.stringify(NAME)}, { type: "image/png" })); box.focus(); box.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })); return true })()`

const READ = `(() => { const chip = [...document.querySelectorAll('[data-slot="attachment"]')].find((el) => el.querySelector('[data-slot="attachment-title"]')?.textContent === ${JSON.stringify(NAME)}); return chip ? { description: chip.querySelector('[data-slot="attachment-description"]')?.textContent ?? "", state: chip.getAttribute("data-state") ?? "" } : null })()`

// At 1280x800 on /dashboard: with the upload route refused at the browser (what the page sees while the API restarts; verify never stops a stack), pastes an image into Playground's box, reads its chip, reloads as next dev does after a restart, reads it again, then lets the route through and waits for the upload. It then removes the chip, sending nothing.
export const uploadKeep = async (browser: Browser, { api, web }: Target): Promise<Result[]> => {
  const route = `${api}/api/v1/attachments`
  await browser.viewport({ height: 800, width: 1280 })
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", "#composer")
  await browser.run("network", "route", route, "--abort")
  const results: Result[] = []
  try {
    await browser.eval<boolean>(PASTE)
    await browser.run("wait", String(SETTLE_MS))
    results.push(
      chipResult(
        "upload-keep a paste with no answer keeps its chip",
        await browser.eval(READ),
        "kept",
      ),
    )
    await browser.visit(`${web}/dashboard`)
    await browser.run("wait", "#composer")
    await browser.run("wait", String(SETTLE_MS))
    results.push(
      chipResult("upload-keep a reload keeps the chip", await browser.eval(READ), "kept"),
    )
  } finally {
    await browser.run("network", "unroute", route)
  }
  await browser
    .run("wait", `[aria-label="Open ${NAME}"]`, "--timeout", String(UPLOAD_MS))
    .catch(() => undefined)
  results.push(
    chipResult(
      "upload-keep the file uploads once the API answers",
      await browser.eval(READ),
      "done",
    ),
  )
  await browser.eval(
    `document.querySelector(${JSON.stringify(`[aria-label="Remove ${NAME}"]`)})?.click() ?? null`,
  )
  return results
}
