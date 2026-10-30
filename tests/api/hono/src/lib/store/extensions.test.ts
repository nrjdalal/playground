import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  addExtension,
  checkExtension,
  checkSettings,
  type Cli,
  type CliRun,
  extensionsOf,
  linkOf,
  runCli,
  setUpSettings,
  syncExtension,
  whySkill,
} from "../../../../../../api/hono/src/lib/store/extensions"
import { loginPath } from "../../../../../../packages/settings/src/rendered"
import { setSetting } from "../../../../../../packages/settings/src/settings-folder"

const scratch = mkdtempSync(join(tmpdir(), "extensions-api-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ME = "made-up-me"
const WHO = { actor: "test", author: "owner", inboxRef: null, reason: "seeded" }
let n = 0

// A data folder whose login is ME, or one before ext init with none.
const folder = (login = true) => {
  const data = join(scratch, `data-${n++}`)
  if (login) {
    mkdirSync(dirname(loginPath(data)), { recursive: true })
    writeFileSync(loginPath(data), `${ME}\n`)
    expect(
      setSetting(data, { key: "clock.ownerZone", scope: ME, value: "Europe/Lisbon" }, WHO).ok,
    ).toBe(true)
  }
  return data
}

// A stand-in for `playground ext`: it keeps each argv and answers as told.
const fake = (run: Partial<CliRun> = {}) => {
  const calls: string[][] = []
  const cli: Cli = async (args) => {
    calls.push(args)
    return { code: 0, err: "", out: "", ...run }
  }
  return { calls, cli }
}

// Add and Sync reach GitHub, so they run only where the stack reads this Mac.
const live = async <T>(body: () => Promise<T>): Promise<T> => {
  process.env.PLAYGROUND_LIVE_READS = "1"
  try {
    return await body()
  } finally {
    delete process.env.PLAYGROUND_LIVE_READS
  }
}

delete process.env.PLAYGROUND_LOGIN

test("before ext init names a login there is no list, and every route refuses naming Set up settings", async () => {
  const data = folder(false)
  const { calls, cli } = fake()
  expect(extensionsOf(data)).toBeNull()
  for (const refused of [
    await addExtension({ name: "acme", yes: false }, cli, data),
    await syncExtension("acme", cli, data),
    await checkExtension({ name: "acme" }, cli, data),
    await whySkill("end-of-day", undefined, cli, data),
    linkOf(data, "acme", "acme", WHO),
  ])
    expect(refused).toEqual({
      message:
        "Extensions are kept beside your settings, which are not set up yet: click Set up settings",
      ok: false,
      status: 409,
    })
  expect(calls).toEqual([])
})

test("a fixture stack adds and syncs nothing, so it reaches no GitHub", async () => {
  const data = folder()
  const { calls, cli } = fake()
  expect(await addExtension({ name: "acme", yes: true }, cli, data)).toMatchObject({ status: 409 })
  expect(await syncExtension("acme", cli, data)).toMatchObject({ status: 409 })
  expect(await checkExtension({ name: "acme" }, cli, data)).toMatchObject({ status: 409 })
  expect(calls).toEqual([])
})

test("add with no yes names the repo it would create and makes nothing; yes passes --yes", async () => {
  const data = folder()
  const missing = fake({
    code: 1,
    err: `playground ext: ${ME}/playground-acme was not created: run playground ext add in a terminal and answer y, or pass --yes`,
  })
  expect(await live(() => addExtension({ name: "acme", yes: false }, missing.cli, data))).toEqual({
    create: `${ME}/playground-acme`,
    ok: true,
  })
  expect(missing.calls).toEqual([["add", "acme"]])
  const made = fake({ out: "started a\nacme is last in ext.order\n" })
  expect(
    await live(() =>
      addExtension({ name: "acme", repo: "acme-inc/shared", yes: true }, made.cli, data),
    ),
  ).toEqual({ lines: ["started a", "acme is last in ext.order"], ok: true })
  expect(made.calls).toEqual([["add", "acme", "acme-inc/shared", "--yes"]])
})

test("Add's check runs ext add --dry-run and answers what it found; a public repo is the CLI's refusal", async () => {
  const data = folder()
  const found = fake({ out: JSON.stringify({ exists: true, repo: "acme-inc/shared", skills: 3 }) })
  expect(
    await live(() => checkExtension({ name: "acme", repo: "acme-inc/shared" }, found.cli, data)),
  ).toEqual({ exists: true, ok: true, repo: "acme-inc/shared", skills: 3 })
  expect(found.calls).toEqual([["add", "acme", "acme-inc/shared", "--dry-run"]])
  const missing = fake({
    out: JSON.stringify({ exists: false, repo: `${ME}/playground-qa`, skills: 0 }),
  })
  expect(await live(() => checkExtension({ name: "qa" }, missing.cli, data))).toMatchObject({
    exists: false,
    repo: `${ME}/playground-qa`,
  })
  expect(missing.calls).toEqual([["add", "qa", "--dry-run"]])
  const open = fake({
    code: 1,
    err: "playground ext: acme-inc/shared is public, and a scope syncs only with a private repository",
  })
  expect(
    await live(() => checkExtension({ name: "acme", repo: "acme-inc/shared" }, open.cli, data)),
  ).toEqual({
    message: "acme-inc/shared is public, and a scope syncs only with a private repository",
    ok: false,
    status: 409,
  })
})

test("the CLI's refusal is the answer: a usage error a 400, any other a 409, never a create once yes is given", async () => {
  const data = folder()
  const usage = fake({ code: 2, err: "playground ext: Acme is not an extension's name" })
  expect(await live(() => addExtension({ name: "acme", yes: false }, usage.cli, data))).toEqual({
    message: "Acme is not an extension's name",
    ok: false,
    status: 400,
  })
  const said = fake({ code: 1, err: `playground ext: ${ME}/playground-acme was not created: x` })
  expect(await live(() => addExtension({ name: "acme", yes: true }, said.cli, data))).toMatchObject(
    { ok: false, status: 409 },
  )
})

test("why reads the resolver's answer, and a skill no extension holds is a 404", async () => {
  const data = folder()
  const found = fake({ out: JSON.stringify({ from: ME, shadowed: ["acme"] }) })
  expect(await whySkill("end-of-day", "acme", found.cli, data)).toEqual({
    from: ME,
    ok: true,
    shadowed: ["acme"],
  })
  expect(found.calls).toEqual([["why", "end-of-day", "--org", "acme"]])
  const none = fake({ code: 1, err: "playground ext: no scope holds the skill nope" })
  expect(await whySkill("nope", undefined, none.cli, data)).toMatchObject({ status: 404 })
  expect(none.calls).toEqual([["why", "nope"]])
})

test("runCli runs the CLI it is given by its path with a fixed argv and no shell, and only HOME, PATH and the data folder", async () => {
  const cli = join(scratch, "fake-cli.ts")
  writeFileSync(
    cli,
    `console.log(JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env).filter((key) => !key.startsWith("__")).sort() }))
console.error("playground ext: said on stderr")
process.exit(3)
`,
  )
  process.env.MADE_UP_TOKEN = "never-passed"
  try {
    const run = await runCli(cli)(["add", "acme; touch /tmp/x", "$(id)"])
    expect(run.code).toBe(3)
    expect(run.err).toBe("playground ext: said on stderr")
    const seen = JSON.parse(run.out) as { argv: string[]; env: string[] }
    expect(seen.argv).toEqual(["ext", "add", "acme; touch /tmp/x", "$(id)"])
    expect(seen.env).not.toContain("MADE_UP_TOKEN")
    expect(seen.env).toEqual(expect.arrayContaining(["HOME", "PATH", "PLAYGROUND_DATA_DIR"]))
  } finally {
    delete process.env.MADE_UP_TOKEN
  }
})

describe("Set up settings", () => {
  test("its check reads ext init --dry-run, and its run passes --yes and names the repository the login now has", async () => {
    const data = folder(false)
    const checked = fake({
      out: JSON.stringify({ exists: false, login: ME, repo: `${ME}/playground-${ME}` }),
    })
    expect(await live(() => checkSettings(checked.cli))).toEqual({
      exists: false,
      ok: true,
      repo: `${ME}/playground-${ME}`,
    })
    expect(checked.calls).toEqual([["init", "--dry-run"]])
    const ran = fake()
    const cli: Cli = async (args) => {
      mkdirSync(dirname(loginPath(data)), { recursive: true })
      writeFileSync(loginPath(data), `${ME}\n`)
      return ran.cli(args)
    }
    expect(await live(() => setUpSettings(cli, data))).toEqual({
      ok: true,
      repo: `${ME}/playground-${ME}`,
    })
    expect(ran.calls).toEqual([["init", "--yes"]])
  })

  test("gh with no login comes back in plain words, naming no command", async () => {
    const data = folder(false)
    const said = fake({
      code: 1,
      err: "playground ext: gh has no login here: run gh auth login, then playground ext init",
    })
    const plain = {
      message: "Sign in to GitHub first; a Sign in button comes in the next update",
      ok: false,
      status: 409,
    } as const
    expect(await live(() => checkSettings(said.cli))).toEqual(plain)
    expect(await live(() => setUpSettings(said.cli, data))).toEqual(plain)
    expect(existsSync(loginPath(data))).toBe(false)
  })

  test("any other failure comes back as the CLI's own first line", async () => {
    const data = folder(false)
    const said = fake({
      code: 1,
      err: `playground ext: ${ME}/playground-${ME} is public, and a scope syncs only with a private repository\nmore`,
    })
    expect(await live(() => setUpSettings(said.cli, data))).toEqual({
      message: `${ME}/playground-${ME} is public, and a scope syncs only with a private repository`,
      ok: false,
      status: 409,
    })
  })

  test("a fixture stack runs no CLI: its check names the fixture's repository and its run writes the fixture's login", async () => {
    const data = folder(false)
    const { calls, cli } = fake()
    expect(await checkSettings(cli)).toEqual({
      exists: true,
      ok: true,
      repo: "taylor/playground-taylor",
    })
    expect(await setUpSettings(cli, data)).toEqual({ ok: true, repo: "taylor/playground-taylor" })
    expect(readFileSync(loginPath(data), "utf8")).toBe("taylor\n")
    expect(calls).toEqual([])
  })
})
