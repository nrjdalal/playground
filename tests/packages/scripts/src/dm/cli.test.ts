import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeScratch, removeScratch } from "../../../../../packages/safe-delete/src"
import { fakeKeychain } from "../../../../extensions/slack/skills/slack/scripts/fake-keychain"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/dm/cli.ts")
const SLACK = { "slack.dmChannel": "D0MADE0201", "slack.dmOwner": "U0OWNER" }
const ON = { "ext.bundled": ["slack"] }
const NOT_SET_UP =
  "Slack is not set up here: reach the owner through the Inbox with bun run ask new (an update)"
const scratches: string[] = []
afterAll(() => scratches.forEach((dir) => removeScratch(dir)))

// A data folder as this Mac's: the login's file and a policy with the values given.
const machine = (values: Record<string, unknown>) => {
  const data = makeScratch("dm-cli-")
  scratches.push(data)
  mkdirSync(join(data, "extensions"))
  writeFileSync(join(data, "extensions", "login"), "someone\n")
  writeFileSync(
    join(data, "extensions", "policy.json"),
    JSON.stringify({ orgs: {}, schemaVersion: 1, values }),
  )
  const body = join(data, "body.md")
  writeFileSync(body, "hello\n")
  return { body, data }
}

// The CLI as a session runs it, with a fake `security` first on PATH that holds no Slack token, so no run reads this Mac's Keychain or reaches Slack.
const dm = async (data: string, args: string[]) => {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI, ...args], {
    env: { ...process.env, PATH: fakeKeychain(data), PLAYGROUND_DATA_DIR: data },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  return { code, stderr: stderr.trim() }
}

describe("playground dm and the bundled slack extension", () => {
  test("with no Slack DM set up, a send points to the Inbox and runs nothing", async () => {
    const { body, data } = machine(ON)
    expect(await dm(data, ["send", body])).toEqual({ code: 2, stderr: `dm send: ${NOT_SET_UP}` })
  })

  test("with the DM set up and the slack extension off, a send loads no Slack code and says Slack is not set up here", async () => {
    const { body, data } = machine(SLACK)
    expect(await dm(data, ["send", body])).toEqual({ code: 2, stderr: `dm send: ${NOT_SET_UP}` })
  })

  test("with the slack extension off, an upload says the same, since its code is the extension's", async () => {
    const { data } = machine({})
    expect(await dm(data, ["upload", "12345678-1234-1234-1234-123456789abc"])).toEqual({
      code: 2,
      stderr: `dm upload: ${NOT_SET_UP}`,
    })
  })

  test("with the slack extension on, a send runs the extension's send.ts, which reads its token from the Keychain alone", async () => {
    const { body, data } = machine({ ...ON, ...SLACK })
    expect(await dm(data, ["send", body])).toEqual({
      code: 1,
      stderr:
        "error: the Slack token is not in the Keychain: save it through the Inbox's secret ask for slack",
    })
  })

  test("with a scope's own slack skill in the bundled one's place, a send names that scope and runs nothing", async () => {
    const { body, data } = machine({ ...ON, ...SLACK })
    const skill = join(data, "extensions", "someone", "skills", "slack")
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, "SKILL.md"), "---\nname: slack\n---\n")
    expect(await dm(data, ["send", body])).toEqual({
      code: 2,
      stderr:
        "dm send: the slack skill in the scope someone holds no scripts/send.ts, and it takes the bundled slack extension's place",
    })
  })

  test("a wrong verb or file prints the usage, before any check of what is set up", async () => {
    const { data } = machine({})
    const { code, stderr } = await dm(data, ["send", "relative.md"])
    expect(code).toBe(2)
    expect(stderr).toStartWith("usage: playground dm send <file>")
  })
})
