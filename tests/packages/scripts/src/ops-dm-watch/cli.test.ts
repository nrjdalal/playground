import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BEATS } from "../../../../../packages/scripts/src/ops-dm-watch/cli"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const [watchBeat, updateBeat] = BEATS as [(typeof BEATS)[0], (typeof BEATS)[0]]

// A data folder with the bundled slack extension turned on and the Slack settings given, read as the job reads this machine's.
const data = mkdtempSync(join(tmpdir(), "dm-watch-cli-"))
afterAll(() => rmSync(data, { force: true, recursive: true }))
mkdirSync(join(data, "extensions"))
writeFileSync(join(data, "extensions", "login"), "someone\n")
const settle = (values: Record<string, unknown>) =>
  writeFileSync(
    join(data, "extensions", "policy.json"),
    JSON.stringify({ orgs: {}, schemaVersion: 1, values: { "ext.bundled": ["slack"], ...values } }),
  )
const WATCH = join(import.meta.dir, "../../../../../extensions/slack/skills/slack/scripts/watch.ts")
process.env.PLAYGROUND_DATA_DIR = data
const SET = { "slack.dmChannel": "D0FIXTURE", "slack.dmOwner": "U0OWNER" }

const fake = (result = { code: 0, out: "" }) => {
  const ran: string[][] = []
  const sent: { text: string; to: string }[] = []
  const ctx: Context = {
    now: new Date(2026, 9, 31, 12, 15),
    ops: "",
    repo: "",
    run: async (argv) => {
      ran.push(argv)
      return result
    },
    send: async (to, text) => {
      sent.push({ text, to })
      return true
    },
  }
  return { ctx, ran, sent }
}

describe("the DM watch job", () => {
  test("off Slack mode, or with the DM or its owner unset, neither beat reads or sends", async () => {
    for (const values of [SET, { ...SET, "slack.mode": true, "slack.dmOwner": "" }]) {
      settle(values)
      const { ctx, ran, sent } = fake()
      await watchBeat.run(ctx)
      await updateBeat.run(ctx)
      expect(ran).toEqual([])
      expect(sent).toEqual([])
    }
  })

  test("in Slack mode the watch runs the slack skill's watch.ts with no token in its argv, and the update beat nudges the dispatcher", async () => {
    settle({ ...SET, "slack.mode": true })
    const { ctx, ran, sent } = fake()
    await watchBeat.run(ctx)
    expect(ran).toEqual([[process.execPath, WATCH]])
    await updateBeat.run(ctx)
    expect(sent).toEqual([
      {
        text: "Slack mode: post the owner an update on the factory's work now, through playground dm send <file>.",
        to: "dispatcher",
      },
    ])
    expect(updateBeat.cron).toBe("*/15 * * * *")
  })

  test("a failed pass goes to ops once per kind until a pass succeeds", async () => {
    settle({ ...SET, "slack.mode": true })
    const failing = fake({ code: 1, out: "error: conversations.history: not_authed\n" })
    for (let i = 0; i < 2; i++) await watchBeat.run(failing.ctx).catch(() => {})
    expect(failing.sent).toEqual([
      { text: "DM watch failed (exit 1): conversations.history: not_authed", to: "ops" },
    ])
    await watchBeat.run(fake().ctx)
    await watchBeat.run(failing.ctx).catch(() => {})
    expect(failing.sent).toHaveLength(2)
  })

  test("with the slack extension off, ops is told Slack is not set up here, and nothing runs", async () => {
    settle({ ...SET, "ext.bundled": [], "slack.mode": true })
    const { ctx, ran, sent } = fake()
    await expect(watchBeat.run(ctx)).rejects.toThrow("exit 2: Slack is not set up here")
    expect(ran).toEqual([])
    expect(sent).toEqual([
      {
        text: "DM watch failed (exit 2): Slack is not set up here: reach the owner through the Inbox with bun run ask new (an update)",
        to: "ops",
      },
    ])
  })
})
