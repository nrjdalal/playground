import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { alertsWait } from "../../../../../packages/scripts/src/playground/alerts-wait"

const dir = mkdtempSync(join(tmpdir(), "alerts-wait-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))
const line = (to: string, text: string) =>
  `${JSON.stringify({ at: "2026-10-26T05:40:00Z", job: "stuck-alert", text, to })}\n`

describe("playground alerts-wait (PG-2184)", () => {
  test("wakes on the first new stuck alert naming the session, past old lines and other sessions', then resumes after it", async () => {
    const outbox = join(dir, "outbox")
    const file = join(outbox, "ops-stuck-alert.jsonl")
    await Bun.write(file, line("builder", "old"))
    const first = alertsWait("builder", outbox, 5)
    await Bun.sleep(30)
    appendFileSync(file, line("ops", "not yours"))
    appendFileSync(file, line("builder", "x-worker is stuck"))
    appendFileSync(file, line("builder", "y-worker is stuck"))
    expect(await first).toBe("2026-10-26T05:40:00Z x-worker is stuck")
    expect(await alertsWait("builder", outbox, 5)).toBe("2026-10-26T05:40:00Z y-worker is stuck")
  })

  test("waits for an outbox file that does not exist yet", async () => {
    const outbox = join(dir, "fresh")
    const waiting = alertsWait("ops", outbox, 5)
    await Bun.sleep(30)
    writeFileSync(join(dir, "ignored"), "")
    await Bun.write(join(outbox, "ops-stuck-alert.jsonl"), line("ops", "z-runner is stuck"))
    expect(await waiting).toBe("2026-10-26T05:40:00Z z-runner is stuck")
  })
})
