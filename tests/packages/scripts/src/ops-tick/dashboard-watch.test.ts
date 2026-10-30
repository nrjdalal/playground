import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DASHBOARD_DOWN_MINUTES,
  dashboardWatch,
} from "../../../../../packages/scripts/src/ops-tick/dashboard-watch"
import { BEATS, type Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const scratch = (): string => {
  const ops = join(mkdtempSync(join(tmpdir(), "dashboard-watch-")), "dispatcher", "ops")
  dirs.push(join(ops, "..", ".."))
  mkdirSync(ops, { recursive: true })
  return ops
}

const NOTIFY = "/repo/scripts/ops/notify.sh"

// A fresh context each minute, as a restarted ops-tick would have: what it keeps between minutes is on disk alone; notify.sh is never run, only recorded.
const minute = async (ops: string, m: number, up: boolean, banners: string[]) => {
  const ctx: Context = {
    now: new Date(Date.UTC(2026, 9, 20, 10, 48 + m, 10)),
    ops,
    repo: "/repo",
    run: async (argv) => {
      const at = argv.indexOf(NOTIFY)
      if (argv[0] === "env" && argv[1] === "NOTIFY_MAC=1" && at > 0) banners.push(argv.at(-1)!)
      return { code: 0, out: "" }
    },
    send: async () => true,
  }
  await dashboardWatch(ctx, async () => up)
}

test(`one banner once the Dashboard has failed ${DASHBOARD_DOWN_MINUTES} minutes in a row, one when it answers again, and none in between (#1361)`, async () => {
  const ops = scratch()
  const banners: string[] = []
  for (let m = 0; m < DASHBOARD_DOWN_MINUTES; m++) await minute(ops, m, false, banners)
  expect(banners).toEqual([])
  await minute(ops, DASHBOARD_DOWN_MINUTES, false, banners)
  expect(banners).toEqual([`The Dashboard has not answered for ${DASHBOARD_DOWN_MINUTES} minutes`])
  for (let m = DASHBOARD_DOWN_MINUTES + 1; m < 60; m++) await minute(ops, m, false, banners)
  expect(banners).toHaveLength(1)
  await minute(ops, 107, true, banners)
  expect(banners.at(-1)).toBe("The Dashboard answers again, after 107 minutes down")
  await minute(ops, 108, true, banners)
  expect(banners).toHaveLength(2)
})

test("a minute's answer ends the run of failures, so a short roll tells no one", async () => {
  const ops = scratch()
  const banners: string[] = []
  for (let m = 0; m < 4; m++) await minute(ops, m, false, banners)
  await minute(ops, 4, true, banners)
  for (let m = 5; m < 9; m++) await minute(ops, m, false, banners)
  expect(banners).toEqual([])
})

test("a gap with no check, as the Mac asleep or ops-tick down, starts the run of failures again", async () => {
  const ops = scratch()
  const banners: string[] = []
  await minute(ops, 0, false, banners)
  for (let m = 60; m < 60 + DASHBOARD_DOWN_MINUTES; m++) await minute(ops, m, false, banners)
  expect(banners).toEqual([])
  await minute(ops, 60 + DASHBOARD_DOWN_MINUTES, false, banners)
  expect(banners).toEqual([`The Dashboard has not answered for ${DASHBOARD_DOWN_MINUTES} minutes`])
})

test("a line notify.sh fails to queue is sent again the next minute", async () => {
  const ops = scratch()
  for (let m = 0; m < DASHBOARD_DOWN_MINUTES; m++) await minute(ops, m, false, [])
  const failing: Context = {
    now: new Date(Date.UTC(2026, 9, 20, 10, 48 + DASHBOARD_DOWN_MINUTES, 10)),
    ops,
    repo: "/repo",
    run: async () => ({ code: 1, out: "notify.sh: no outbox" }),
    send: async () => true,
  }
  await expect(dashboardWatch(failing, async () => false)).rejects.toThrow("notify.sh")
  const banners: string[] = []
  await minute(ops, DASHBOARD_DOWN_MINUTES + 1, false, banners)
  expect(banners).toEqual([
    `The Dashboard has not answered for ${DASHBOARD_DOWN_MINUTES + 1} minutes`,
  ])
})

test("the beat runs every minute", () => {
  expect(BEATS.find((b) => b.name === "dashboard-watch")?.cron).toBe("* * * * *")
})
