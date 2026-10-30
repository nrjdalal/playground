import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BEATS } from "../../../../../packages/scripts/src/ops-channel-watch/cli"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const beat = BEATS[0]!

// A data folder whose extensions hold vault in acme's, linked to every repo, read as the job reads this machine's.
const data = mkdtempSync(join(tmpdir(), "channel-watch-"))
afterAll(() => rmSync(data, { force: true, recursive: true }))
const vault = join(data, "extensions", "acme", "skills", "vault")
mkdirSync(vault, { recursive: true })
writeFileSync(join(vault, "SKILL.md"), "# vault\n")
writeFileSync(join(data, "extensions", "login"), "someone\n")
writeFileSync(
  join(data, "extensions", "policy.json"),
  JSON.stringify({
    orgs: {},
    schemaVersion: 1,
    values: { "ext.links": { acme: ["*"] }, "ext.order": ["acme"] },
  }),
)
process.env.PLAYGROUND_DATA_DIR = data

const fake = (minute: number, result: { code: number; out: string }) => {
  const ran: string[][] = []
  const sent: { text: string; to: string }[] = []
  const ctx: Context = {
    now: new Date(2026, 9, 23, 12, minute),
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

describe("the channel watch beat", () => {
  test("runs the full pass at minutes 7 and 37 and the quick one otherwise, with the token from the vault skill's scope", async () => {
    for (const [minute, mode] of [
      [7, "full"],
      [37, "full"],
      [9, "quick"],
    ] as const) {
      const { ctx, ran } = fake(minute, { code: 0, out: "" })
      await beat.run(ctx)
      const argv = ran[0]!
      expect(argv.at(-1)).toBe(mode)
      expect(argv.at(-2)).toEndWith("packages/scripts/src/ops-channel-watch/watch.ts")
      expect(argv.slice(argv.indexOf("run", 2), argv.indexOf("--"))).toEqual([
        "run",
        "-e",
        "SLACK_TOKEN=local.slack.channel_token",
      ])
      expect(argv[4]).toBe(join(vault, "scripts", "vault.py"))
    }
  })

  test("with no scope holding vault, it tells ops and throws, running nothing", async () => {
    rmSync(join(data, "extensions", "policy.json"))
    writeFileSync(
      join(data, "extensions", "policy.json"),
      JSON.stringify({ orgs: {}, schemaVersion: 1, values: {} }),
    )
    const none = fake(21, { code: 0, out: "" })
    await expect(beat.run(none.ctx)).rejects.toThrow("no scope holds the skill vault")
    expect(none.ran).toEqual([])
    expect(none.sent).toEqual([
      { text: "channel watch quick failed (exit 2): no scope holds the skill vault", to: "ops" },
    ])
    writeFileSync(
      join(data, "extensions", "policy.json"),
      JSON.stringify({
        orgs: {},
        schemaVersion: 1,
        values: { "ext.links": { acme: ["*"] }, "ext.order": ["acme"] },
      }),
    )
  })

  test("tells ops once per kind of failure, again after a success, and throws each time", async () => {
    const bad = { code: 1, out: "  at x\nerror: conversations.history: invalid_auth\n  at y\n" }
    const first = fake(9, bad)
    await expect(beat.run(first.ctx)).rejects.toThrow("exit 1: conversations.history: invalid_auth")
    expect(first.sent).toEqual([
      {
        text: "channel watch quick failed (exit 1): conversations.history: invalid_auth",
        to: "ops",
      },
    ])
    const again = fake(12, bad)
    await expect(beat.run(again.ctx)).rejects.toThrow("invalid_auth")
    expect(again.sent).toEqual([])
    await beat.run(fake(15, { code: 0, out: "" }).ctx)
    const after = fake(18, bad)
    await expect(beat.run(after.ctx)).rejects.toThrow("invalid_auth")
    expect(after.sent).toHaveLength(1)
  })
})
