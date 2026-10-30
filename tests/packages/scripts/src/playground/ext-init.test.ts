import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { Run } from "../../../../../packages/scripts/src/ops-tick/tick"
import {
  extAddCheck,
  extInit,
  extInitCheck,
  extVerb,
} from "../../../../../packages/scripts/src/playground/ext-init"
import type { Io } from "../../../../../packages/scripts/src/playground/store"
import { extGit } from "../../../../../packages/settings/src/folder"
import { extensionsDir, loginPath, scopeDir } from "../../../../../packages/settings/src/rendered"
import { readSetting, setSetting } from "../../../../../packages/settings/src/settings-folder"

process.env.PLAYGROUND_LOGIN = "made-up-me"
const ME = "made-up-me"
const SLUG = `${ME}/playground-${ME}`

const scratch = mkdtempSync(join(tmpdir(), "ext-init-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
let n = 0

// A data folder and a fake gh: signed in as login, with a scratch bare repository standing in for each GitHub one it makes or already holds; no real repository is ever made.
const fixture = ({ login = ME, visibility = "PRIVATE" } = {}) => {
  const at = join(scratch, `${n++}`)
  const data = join(at, "data")
  const repos = new Map<string, string>()
  const calls: string[] = []
  const bare = (slug: string) => {
    const path = join(at, `${slug.replace("/", "-")}.git`)
    Bun.spawnSync(["git", "init", "-q", "--bare", "-b", "main", path])
    repos.set(slug, path)
    return path
  }
  const run: Run = async (argv) => {
    calls.push(argv.join(" "))
    const [cmd, area, verb, slug = ""] = argv
    if (cmd !== "gh") return { code: 0, out: "" }
    if (area === "api") return login ? { code: 0, out: `${login}\n` } : { code: 1, out: "" }
    if (verb === "view")
      return repos.has(slug)
        ? { code: 0, out: `${visibility} ${repos.get(slug)}\n` }
        : { code: 1, out: "" }
    if (verb === "create")
      return repos.has(slug) ? { code: 1, out: "exists" } : (bare(slug), { code: 0, out: "" })
    return { code: 0, out: "" }
  }
  return { at, bare, calls, data, run }
}

const YES = async () => true

const created = (calls: string[]) => calls.filter((call) => call.startsWith("gh repo create"))

test("on a new machine with no repository, init makes it private with issues, wiki and projects off, starts the login's folder with it as origin, and a second run changes nothing", async () => {
  const { calls, data, run } = fixture()
  const dir = scopeDir(data, ME)
  expect(await extInit(data, run, YES)).toEqual([
    `login ${ME}`,
    `made ${SLUG}, private, with issues, wiki and projects off`,
    `started ${dir} with a first commit`,
  ])
  expect(created(calls)).toEqual([
    `gh repo create ${SLUG} --private --disable-issues --disable-wiki`,
  ])
  expect(calls).toContain(`gh repo edit ${SLUG} --enable-projects=false`)
  expect(readFileSync(loginPath(data), "utf8")).toBe(`${ME}\n`)
  expect(extGit(dir, ["remote", "get-url", "origin"]).out).toEndWith(
    `${SLUG.replace("/", "-")}.git`,
  )
  expect(await extInit(data, run, YES)).toEqual([
    `login ${ME}`,
    `${SLUG} is private`,
    `${dir} is already a clone`,
  ])
  expect(created(calls)).toHaveLength(1)
})

// A scope with no commit has no HEAD to push, so a fresh install's first ext sync failed on git's "src refspec HEAD"; init's first commit gives the scope content at once.
test("init's first commit holds an empty settings.json, so ext sync pushes straight after it", async () => {
  const { data, run } = fixture()
  await extInit(data, run, YES)
  const dir = scopeDir(data, ME)
  expect(extGit(dir, ["log", "--format=%s"]).out.trim()).toBe("init")
  expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe("{}\n")
  const out: string[] = []
  const io = { data, out: (line: string) => out.push(line) } as unknown as Io
  expect(await extVerb("sync", [], io, run)).toBe(0)
  expect(out).toEqual([
    `${ME} synced with ${SLUG} at ${extGit(dir, ["rev-parse", "--short", "HEAD"]).out}`,
  ])
})

test("with a repository another machine pushed to, init clones it and the root reads its settings", async () => {
  const { at, bare, data, run } = fixture()
  const other = join(at, "other")
  setSetting(
    other,
    { key: "factory.repo", scope: ME, value: "made-up-me/app" },
    { actor: "cli", author: "owner", inboxRef: null, reason: "set on the other machine" },
  )
  extGit(scopeDir(other, ME), ["push", "-q", bare(SLUG), "HEAD:main"])
  expect((await extInit(data, run, YES))[2]).toBe(`cloned ${SLUG} into ${scopeDir(data, ME)}`)
  expect(readSetting(data, "factory.repo")?.value).toBe("made-up-me/app")
  expect(
    JSON.parse(readFileSync(join(extensionsDir(data), "policy.json"), "utf8")).values,
  ).toMatchObject({
    "factory.repo": "made-up-me/app",
  })
})

test("a public repository is refused, and nothing is written", async () => {
  const { bare, calls, data, run } = fixture({ visibility: "PUBLIC" })
  bare(SLUG)
  await expect(extInit(data, run, YES)).rejects.toThrow(
    `${SLUG} is public, and a scope syncs only with a private repository`,
  )
  expect(created(calls)).toEqual([])
  expect(existsSync(extensionsDir(data))).toBe(false)
})

test("add --dry-run reads the repository add would use and its skills/ through gh, and makes nothing", async () => {
  const { bare, calls, data, run } = fixture()
  await extInit(data, run, YES)
  const counted: Run = async (argv) =>
    argv[1] === "api" && argv[2] === "repos/made-up-org/shared/contents/skills"
      ? { code: 0, out: "3\n" }
      : run(argv)
  expect(await extAddCheck(data, "qa", undefined, counted)).toEqual({
    exists: false,
    repo: `${ME}/playground-qa`,
    skills: 0,
  })
  bare("made-up-org/shared")
  expect(await extAddCheck(data, "qa", "made-up-org/shared", counted)).toEqual({
    exists: true,
    repo: "made-up-org/shared",
    skills: 3,
  })
  bare(`${ME}/playground-bare`)
  expect(
    await extAddCheck(data, "bare", undefined, async (argv) =>
      argv[1] === "api" && argv[2]?.startsWith("repos/") ? { code: 1, out: "" } : run(argv),
    ),
  ).toEqual({ exists: true, repo: `${ME}/playground-bare`, skills: 0 })
  await expect(extAddCheck(data, "Qa", undefined, run)).rejects.toThrow(
    "is not an extension's name",
  )
  expect(created(calls)).toEqual([
    `gh repo create ${SLUG} --private --disable-issues --disable-wiki`,
  ])
  expect(existsSync(scopeDir(data, "qa"))).toBe(false)
})

test("init --dry-run reads the login and its repository through gh, making nothing, and refuses as init does", async () => {
  const { bare, calls, data, run } = fixture()
  expect(await extInitCheck(data, run)).toEqual({ exists: false, login: ME, repo: SLUG })
  bare(SLUG)
  expect(await extInitCheck(data, run)).toEqual({ exists: true, login: ME, repo: SLUG })
  expect(created(calls)).toEqual([])
  expect(existsSync(extensionsDir(data))).toBe(false)
  const none = fixture({ login: "" })
  await expect(extInitCheck(none.data, none.run)).rejects.toThrow("gh has no login here")
  const open = fixture({ visibility: "PUBLIC" })
  open.bare(SLUG)
  await expect(extInitCheck(open.data, open.run)).rejects.toThrow(`${SLUG} is public`)
})

test("with no gh login, or extensions that are another login's, init refuses", async () => {
  const none = fixture({ login: "" })
  await expect(extInit(none.data, none.run, YES)).rejects.toThrow(
    "gh has no login here: run gh auth login",
  )
  const mine = fixture()
  await extInit(mine.data, mine.run, YES)
  const other = fixture({ login: "someone-else" })
  await expect(extInit(mine.data, other.run, YES)).rejects.toThrow(
    `these extensions are ${ME}'s and gh is signed in as someone-else`,
  )
})

test("ext sync prints each scope's line", async () => {
  const { data, run } = fixture()
  await extInit(data, run, YES)
  setSetting(
    data,
    { key: "factory.repo", scope: ME, value: "made-up-me/app" },
    { actor: "cli", author: "owner", inboxRef: null, reason: "my repo" },
  )
  const out: string[] = []
  const io = { data, out: (line: string) => out.push(line) } as unknown as Io
  expect(await extVerb("sync", [], io, run)).toBe(0)
  expect(out).toEqual([
    `${ME} synced with ${SLUG} at ${extGit(scopeDir(data, ME), ["rev-parse", "--short", "HEAD"]).out}`,
  ])
})

describe("the real CLI with a fake gh first on PATH", () => {
  const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/playground/cli.ts")
  const cli = (name: string, words: string[]) => {
    const at = join(scratch, name)
    const bin = join(at, "bin")
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/bash
echo "$*" >> "${at}/gh.log"
case "$1 $2" in
  "api user") echo ${ME} ;;
  "repo view") [ -d "${at}/repos/$3.git" ] && echo "PRIVATE ${at}/repos/$3.git" || exit 1 ;;
  "repo create") git init -q --bare -b main "${at}/repos/$3.git" ;;
  "repo edit") ;;
  *) exit 1 ;;
esac
`,
    )
    chmodSync(join(bin, "gh"), 0o755)
    const done = Bun.spawnSync([process.execPath, "--no-env-file", CLI, "ext", "init", ...words], {
      env: {
        HOME: at,
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        PLAYGROUND_DATA_DIR: join(at, "data"),
      },
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    })
    const log = existsSync(join(at, "gh.log")) ? readFileSync(join(at, "gh.log"), "utf8") : ""
    return {
      code: done.exitCode,
      err: done.stderr.toString(),
      gh: log.split("\n"),
      out: done.stdout.toString(),
    }
  }

  test("off a terminal with no --yes, gh repo create never runs", () => {
    const { code, err, gh } = cli("cli-no", [])
    expect(code).toBe(1)
    expect(err).toContain("Create it? [y/N] no: stdin is not a terminal, so pass --yes")
    expect(gh.filter((call) => call.startsWith("repo create"))).toEqual([])
  })

  test("with --yes, it says what it makes and makes it", () => {
    const { code, err, gh, out } = cli("cli-yes", ["--yes"])
    expect(code).toBe(0)
    expect(err).toContain(`will create ${SLUG} on GitHub, private`)
    expect(gh.filter((call) => call.startsWith("repo create"))).toEqual([
      `repo create ${SLUG} --private --disable-issues --disable-wiki`,
    ])
    expect(out).toContain(`made ${SLUG}, private, with issues, wiki and projects off`)
  })
})
