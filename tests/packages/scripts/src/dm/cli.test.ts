import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeScratch, removeScratch } from "../../../../../packages/safe-delete/src"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/dm/cli.ts")
const SLACK = { "slack.dmChannel": "D0FIXTURE", "slack.dmOwner": "U0OWNER" }
const scratches: string[] = []
afterAll(() => scratches.forEach((dir) => removeScratch(dir)))

// A data folder as this Mac's: the login's file, a policy with the values given, and the vault skill in acme's scope when linked names its links.
const machine = (values: Record<string, unknown>, linked?: string[]) => {
  const data = makeScratch("dm-cli-")
  scratches.push(data)
  mkdirSync(join(data, "extensions"))
  writeFileSync(join(data, "extensions", "login"), "someone\n")
  if (linked) {
    mkdirSync(join(data, "extensions", "acme", "skills", "vault"), { recursive: true })
    writeFileSync(join(data, "extensions", "acme", "skills", "vault", "SKILL.md"), "# vault\n")
  }
  const ext = linked ? { "ext.links": { acme: linked }, "ext.order": ["acme"] } : {}
  writeFileSync(
    join(data, "extensions", "policy.json"),
    JSON.stringify({ orgs: {}, schemaVersion: 1, values: { ...ext, ...values } }),
  )
  const body = join(data, "body.md")
  writeFileSync(body, "hello\n")
  return { body, data }
}

const dm = async (data: string, args: string[]) => {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI, ...args], {
    env: { ...process.env, PLAYGROUND_DATA_DIR: data },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  return { code, stderr: stderr.trim() }
}

describe("playground dm on a Mac that lacks Slack or the vault", () => {
  test("with no Slack set up, it sends the owner to the Inbox and never looks for the vault", async () => {
    const { body, data } = machine({})
    expect(await dm(data, ["send", body])).toEqual({
      code: 2,
      stderr:
        "dm send: Slack is not set up here: reach the owner through the Inbox with bun run ask new (an update)",
    })
  })

  test("with Slack set up and no scope holding the vault, it names the vault skill and how to install it", async () => {
    const { body, data } = machine(SLACK)
    expect(await dm(data, ["send", body])).toEqual({
      code: 2,
      stderr:
        "dm send: the vault is not installed: install an extension that holds the vault skill and link it to * (playground ext link <name> '*')",
    })
  })

  test("a vault in an extension linked to one org alone is not this Mac's, so it reads as not installed", async () => {
    const { body, data } = machine(SLACK, ["acme"])
    const { code, stderr } = await dm(data, ["send", body])
    expect(code).toBe(2)
    expect(stderr).toStartWith("dm send: the vault is not installed:")
  })

  test("an upload, whose place comes from its item, needs no DM settings: with no vault it names the vault alone", async () => {
    const { data } = machine({})
    const { code, stderr } = await dm(data, ["upload", "12345678-1234-1234-1234-123456789abc"])
    expect(code).toBe(2)
    expect(stderr).toStartWith("dm upload: the vault is not installed:")
  })

  test("a wrong verb or file prints the usage, before any check of what is set up", async () => {
    const { data } = machine({})
    const { code, stderr } = await dm(data, ["send", "relative.md"])
    expect(code).toBe(2)
    expect(stderr).toStartWith("usage: playground dm send <file>")
  })
})
