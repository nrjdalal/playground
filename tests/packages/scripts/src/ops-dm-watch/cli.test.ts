import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BEATS } from "../../../../../packages/scripts/src/ops-dm-watch/cli"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const [watchBeat, updateBeat] = BEATS as [(typeof BEATS)[0], (typeof BEATS)[0]]

// A data folder whose extensions hold vault in acme's, with the Slack settings given, read as the job reads this machine's.
const data = mkdtempSync(join(tmpdir(), "dm-watch-cli-"))
afterAll(() => rmSync(data, { force: true, recursive: true }))
mkdirSync(join(data, "extensions", "acme", "skills", "vault"), { recursive: true })
writeFileSync(join(data, "extensions", "acme", "skills", "vault", "SKILL.md"), "# vault\n")
writeFileSync(join(data, "extensions", "login"), "someone\n")
const settle = (values: Record<string, unknown>) =>
  writeFileSync(
    join(data, "extensions", "policy.json"),
    JSON.stringify({
      orgs: {},
      schemaVersion: 1,
      values: { "ext.links": { acme: ["*"] }, "ext.order": ["acme"], ...values },
    }),
  )
process.env.PLAYGROUND_DATA_DIR = data
const SET = { "slack.dmChannel": "D0FIXTURE", "slack.dmOwner": "U0OWNER" }

const fake = (result = { code: 0, out: "" }, op = { code: 0, out: "" }) => {
  const ran: string[][] = []
  const sent: { text: string; to: string }[] = []
  const ctx: Context = {
    now: new Date(2026, 9, 31, 12, 15),
    ops: "",
    repo: "",
    run: async (argv) => {
      ran.push(argv)
      return argv[0] === "op" ? op : result
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

  test("in Slack mode the watch runs watch.ts with the token from vault alone, and the update beat nudges the dispatcher", async () => {
    settle({ ...SET, "slack.mode": true })
    const { ctx, ran, sent } = fake()
    await watchBeat.run(ctx)
    expect(ran[0]!.at(-1)).toEndWith("packages/scripts/src/ops-dm-watch/watch.ts")
    expect(ran[0]!).toContain("SLACK_TOKEN=local.slack.channel_token")
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

  test("vault's 1Password error names an empty op account list as the job's context, and a listed account leaves vault's words", async () => {
    settle({ ...SET, "slack.mode": true })
    const locked = {
      code: 1,
      out: 'vault: the note "LightPass" in the Employee vault could not be read: is 1Password unlocked and op signed in?\n',
    }
    const none = fake(locked, {
      code: 1,
      out: "No accounts configured for use with 1Password CLI.",
    })
    await watchBeat.run(none.ctx).catch(() => {})
    expect(none.sent[0]!.text).toContain("op has no 1Password account in this job's context")
    await watchBeat.run(fake().ctx)
    const listed = fake(locked, { code: 0, out: "URL  EMAIL  USER ID\nmy.1password.com  a  b\n" })
    await watchBeat.run(listed.ctx).catch(() => {})
    expect(listed.sent[0]!.text).toContain("is 1Password unlocked")
  })
})
