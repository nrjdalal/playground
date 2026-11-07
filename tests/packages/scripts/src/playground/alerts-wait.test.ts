import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { alertsWait } from "../../../../../packages/scripts/src/playground/alerts-wait"
import { waiterPidPath } from "../../../../../packages/scripts/src/stuck-alert"

const dir = mkdtempSync(join(tmpdir(), "alerts-wait-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))
const line = (to: string, text: string, at = "2026-10-26T05:40:00Z") =>
  `${JSON.stringify({ at, job: "stuck-alert", text, to })}\n`
const BEGAN = new Date("2026-10-26T05:41:00Z")

describe("playground alerts-wait (PG-2184)", () => {
  test("wakes on the first new stuck alert naming the session, past old lines and other sessions', then resumes after it", async () => {
    const outbox = join(dir, "outbox")
    const file = join(outbox, "ops-stuck-alert.jsonl")
    await Bun.write(file, line("builder", "old"))
    const first = alertsWait("builder", outbox, 5, BEGAN)
    await Bun.sleep(30)
    appendFileSync(file, line("ops", "not yours"))
    appendFileSync(file, line("builder", "x-worker is stuck"))
    appendFileSync(file, line("builder", "y-worker is stuck"))
    expect(await first).toBe("2026-10-26T05:40:00Z x-worker is stuck")
    expect(await alertsWait("builder", outbox, 5, BEGAN)).toBe(
      "2026-10-26T05:40:00Z y-worker is stuck",
    )
  })

  test("keeps its pid where stuck-alert reads it while it waits", async () => {
    const outbox = join(dir, "pid")
    const waiting = alertsWait("planner", outbox, 5, BEGAN)
    await Bun.sleep(30)
    expect(await Bun.file(waiterPidPath(outbox, "planner")).text()).toBe(String(process.pid))
    await Bun.write(join(outbox, "ops-stuck-alert.jsonl"), line("planner", "p is stuck"))
    expect(await waiting).toBe("2026-10-26T05:40:00Z p is stuck")
  })

  test("a waiter started after days down skips the alerts queued over 5 minutes before it began, and says how many", async () => {
    const outbox = join(dir, "backlog")
    const file = join(outbox, "ops-stuck-alert.jsonl")
    await Bun.write(join(outbox, "alerts-wait", "builder"), "0")
    await Bun.write(
      file,
      line("builder", "2 Nov", "2026-11-02T08:00:00Z") +
        line("builder", "6 Nov", "2026-11-06T22:00:00Z") +
        line("ops", "not yours", "2026-11-02T08:00:00Z") +
        line("builder", "4 minutes before", "2026-11-07T07:12:00Z"),
    )
    const began = new Date("2026-11-07T07:16:00Z")
    expect(await alertsWait("builder", outbox, 5, began)).toBe(
      "(skipped 2 older alerts, queued over 5 minutes before this wait began; the relay sent each) 2026-11-07T07:12:00Z 4 minutes before",
    )
  })

  test("waits for an outbox file that does not exist yet", async () => {
    const outbox = join(dir, "fresh")
    const waiting = alertsWait("ops", outbox, 5, BEGAN)
    await Bun.sleep(30)
    writeFileSync(join(dir, "ignored"), "")
    await Bun.write(join(outbox, "ops-stuck-alert.jsonl"), line("ops", "z-runner is stuck"))
    expect(await waiting).toBe("2026-10-26T05:40:00Z z-runner is stuck")
  })
})
