import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { appWords } from "../../../../../../api/hono/src/lib/store/app-words"
import { done } from "../../../../../../api/hono/src/routers/store"
import { syncExtensions } from "../../../../../../packages/scripts/src/ops-ext-sync/sync"
import type { Run } from "../../../../../../packages/scripts/src/ops-tick/tick"
import { extAddCheck, extInit } from "../../../../../../packages/scripts/src/playground/ext-init"
import { linkExtension } from "../../../../../../packages/settings/src/extensions"
import { writeFiles } from "../../../../../../packages/settings/src/folder"
import { loginOf, loginPath, scopeDir } from "../../../../../../packages/settings/src/rendered"
import { checkSetting } from "../../../../../../packages/settings/src/settings"
import { setSetting } from "../../../../../../packages/settings/src/settings-folder"

// The command shapes no text the app returns may name: the app runs every step for the person.
const COMMAND = /playground (ext|settings) |bun run |gh auth |gitleaks git /

const ME = "made-up-me"
const WHO = { actor: "test", author: "owner", inboxRef: null, reason: "seeded" } as const
const scratch = mkdtempSync(join(tmpdir(), "app-words-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
let n = 0
const folder = (login?: string) => {
  const data = join(scratch, `${n++}`)
  mkdirSync(data, { recursive: true })
  if (login) {
    mkdirSync(join(data, "extensions"), { recursive: true })
    writeFileSync(loginPath(data), `${login}\n`)
  }
  return data
}
const failed = (result: { ok: boolean; message?: string }) => {
  if (result.ok) throw new Error("it did not refuse")
  return result.message!
}
const thrown = async (go: () => unknown) => {
  try {
    await go()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("it did not throw")
}
// A gh signed in as ME whose private repository is already there, so init goes on to the login's folder.
const gh: Run = async (argv) =>
  argv[1] === "api"
    ? { code: 0, out: `${ME}\n` }
    : argv[2] === "view"
      ? { code: 0, out: `PRIVATE ${join(scratch, "remote.git")}\n` }
      : { code: 0, out: "" }

// Each refusal as its own producer words it today, so a reword there turns this red rather than leaving the map behind.
const refusals: [string, () => Promise<string>, string][] = [
  [
    "an unknown setting (settings.ts)",
    async () => failed(checkSetting("jobs.no pe", 1)),
    "no setting jobs.no pe; the Settings page lists them",
  ],
  [
    "an unknown extension (extensions.ts)",
    async () => failed(linkExtension(folder(ME), "acme", "acme", WHO)),
    "no extension acme: the Settings page's Extensions section lists them, and Add extension adds one",
  ],
  [
    "a settings write with no login (settings-folder.ts)",
    async () =>
      failed(setSetting(folder(), { key: "clock.ownerZone", scope: ME, value: "UTC" }, WHO)),
    "settings are written to your extensions, which are not set up yet: click Set up settings",
  ],
  [
    "no login named (rendered.ts)",
    async () => {
      const data = folder()
      return thrown(() => loginOf(data, {}))
    },
    "Your settings are not set up yet: click Set up settings",
  ],
  [
    "a leak gitleaks finds in an extension's history (sync.ts, through Sync now)",
    async () => {
      const data = folder(ME)
      writeFiles(data, "acme", new Map([["docs/notes.md", "a note\n"]]), {
        author: "owner",
        reason: "a note",
      })
      const bin = join(scratch, `bin-${n++}`)
      mkdirSync(bin)
      writeFileSync(join(bin, "gitleaks"), "#!/bin/sh\nexit 1\n")
      chmodSync(join(bin, "gitleaks"), 0o755)
      const path = process.env.PATH
      process.env.PATH = `${bin}:${path}`
      try {
        const run: Run = async (argv) =>
          argv[0] === "gitleaks" ? { code: 1, out: "leaks found" } : { code: 1, out: "" }
        return await thrown(() => syncExtensions({ data, only: "acme", run }))
      } finally {
        process.env.PATH = path
      }
    },
    "ext sync: acme: refused, nothing pushed: gitleaks found a leak in its history (a secret scan found it; remove it from the history, then sync again)",
  ],
  [
    "a login folder holding files but no clone (ext-init.ts, through Set up settings)",
    async () => {
      const data = folder()
      mkdirSync(scopeDir(data, ME), { recursive: true })
      writeFileSync(join(scopeDir(data, ME), "stray"), "x")
      return thrown(() => extInit(data, gh, async () => true))
    },
    "",
  ],
  [
    "adding the login's own extension (ext-init.ts, through Add extension)",
    async () => thrown(() => extAddCheck(folder(ME), ME, undefined, gh)),
    `${ME} is your login's extension: Set up settings sets it up`,
  ],
]

describe("appWords", () => {
  const env = process.env.PLAYGROUND_LOGIN
  afterAll(() => {
    if (env === undefined) delete process.env.PLAYGROUND_LOGIN
    else process.env.PLAYGROUND_LOGIN = env
  })

  test.each(refusals)("words %s for the app, naming no command", async (_, produce, app) => {
    delete process.env.PLAYGROUND_LOGIN
    const said = await produce()
    expect(said).toMatch(COMMAND)
    const words = appWords(said)
    expect(words).not.toMatch(COMMAND)
    if (app) expect(words).toBe(app)
    else expect(words).toMatch(/click Set up settings( again)?$/)
  })

  test("leaves a refusal that names no command as it is", () => {
    expect(appWords("acme is already listed")).toBe("acme is already listed")
  })
})

describe("done", () => {
  test("a store refusal reaches the app in the app's words", () => {
    const said = failed(checkSetting("jobs.nope", 1))
    expect(() => done({ message: said, ok: false, status: 404 })).toThrow(
      "no setting jobs.nope; the Settings page lists them",
    )
  })
})
