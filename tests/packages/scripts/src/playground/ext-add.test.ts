import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Run } from "../../../../../packages/scripts/src/ops-tick/tick"
import { extAdd, extInit, extVerb } from "../../../../../packages/scripts/src/playground/ext-init"
import { runStore, type Io } from "../../../../../packages/scripts/src/playground/store"
import { extGit } from "../../../../../packages/settings/src/folder"
import { extensionsDir, scopeDir } from "../../../../../packages/settings/src/rendered"
import { CORE_READ_ONLY } from "../../../../../packages/settings/src/settings"
import { readSetting, setSetting } from "../../../../../packages/settings/src/settings-folder"

process.env.PLAYGROUND_LOGIN = "made-up-me"
const ME = "made-up-me"
const ORG = "acme"
const SLUG = `${ME}/playground-${ORG}`
const YES = async () => true
const WHO = { actor: "cli", author: "owner", inboxRef: null, reason: "set elsewhere" }

const scratch = mkdtempSync(join(tmpdir(), "ext-add-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
let n = 0

// A data folder set up by ext init, and a fake gh: signed in as the login, with a scratch bare repository standing in for each GitHub one it makes or already holds; no real repository is ever made.
const fixture = async ({ visibility = "PRIVATE" } = {}) => {
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
    if (area === "api") return { code: 0, out: `${ME}\n` }
    if (verb === "view")
      return repos.has(slug)
        ? { code: 0, out: `${slug.endsWith(ME) ? "PRIVATE" : visibility} ${repos.get(slug)}\n` }
        : { code: 1, out: "" }
    if (verb === "create")
      return repos.has(slug) ? { code: 1, out: "exists" } : (bare(slug), { code: 0, out: "" })
    return { code: 0, out: "" }
  }
  await extInit(data, run, YES)
  return { at, bare, calls, data, run }
}

// Another machine's clone of a repository, with one file pushed to its main.
const pushFrom = (at: string, url: string, file: string, text: string) => {
  const other = join(at, `other-${n++}`)
  Bun.spawnSync(["git", "clone", "-q", url, other])
  writeFileSync(join(other, file), text)
  for (const args of [
    ["add", file],
    ["-c", "user.name=x", "-c", "user.email=x", "commit", "-q", "-m", file],
    ["push", "-q", "origin", "HEAD:main"],
  ])
    Bun.spawnSync(["git", "-C", other, ...args])
}

const created = (calls: string[]) => calls.filter((call) => call.startsWith("gh repo create"))

test("ext add core exits 2 with core's read-only refusal, and writes nothing", async () => {
  const { data } = await fixture()
  const err: string[] = []
  const io = { data, out: () => {} } as unknown as Io
  expect(await runStore("ext", ["add", "core"], io, (line) => err.push(line))).toBe(2)
  expect(err.join("\n")).toContain(CORE_READ_ONLY)
  expect(existsSync(join(extensionsDir(data), "core"))).toBe(false)
})

test("with no repository, add makes it private, starts the extension's folder with it as origin, puts it last in the order linked to no org, and a second run changes nothing", async () => {
  const { calls, data, run } = await fixture()
  const dir = scopeDir(data, ORG)
  expect(await extAdd(data, ORG, undefined, run, YES)).toEqual([
    `made ${SLUG}, private, with issues, wiki and projects off`,
    `started ${dir} with a first commit`,
    `${ORG} is last in ext.order: playground ext order ${ORG} puts it first`,
    `${ORG} is linked to no org yet: playground ext link ${ORG} <org|*> links it`,
  ])
  expect(created(calls)).toContain(
    `gh repo create ${SLUG} --private --disable-issues --disable-wiki`,
  )
  expect(extGit(dir, ["remote", "get-url", "origin"]).out).toEndWith(
    `${SLUG.replace("/", "-")}.git`,
  )
  expect(readSetting(data, "ext.order")?.value).toEqual([ME, ORG])
  expect(await extAdd(data, ORG, undefined, run, YES)).toEqual([
    `${SLUG} is private`,
    `${dir} is already a clone`,
    `${ORG} is linked to no org yet: playground ext link ${ORG} <org|*> links it`,
  ])
  expect(created(calls)).toHaveLength(2)
})

test("with a repository another machine pushed to, add clones it and keeps the files already in the folder", async () => {
  const { at, bare, data, run } = await fixture()
  pushFrom(at, bare(SLUG), "shared.md", "from the other machine\n")
  const dir = scopeDir(data, ORG)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "mine.md"), "kept\n")
  expect((await extAdd(data, ORG, undefined, run, YES)).slice(0, 2)).toEqual([
    `${SLUG} is private`,
    `cloned ${SLUG} into ${dir}, keeping its own files`,
  ])
  expect(readFileSync(join(dir, "shared.md"), "utf8")).toBe("from the other machine\n")
  expect(readFileSync(join(dir, "mine.md"), "utf8")).toBe("kept\n")
  expect(extGit(dir, ["status", "--porcelain"]).out).toBe("")
  expect(extGit(dir, ["log", "--format=%s"]).out.trim().split("\n")).toHaveLength(2)
})

test("a named repository is the one cloned and recorded in ext.repos, and links already set are kept", async () => {
  const { at, bare, data, run } = await fixture()
  const named = `${ORG}/shared-settings`
  pushFrom(at, bare(named), "shared.md", "named\n")
  setSetting(data, { key: "ext.links", scope: ME, value: { [ORG]: ["acme-blue"] } }, WHO)
  expect(await extAdd(data, ORG, named, run, YES)).toEqual([
    `${named} is private`,
    `cloned ${named} into ${scopeDir(data, ORG)}`,
    `ext.repos now takes ${ORG} to ${named}`,
    `${ORG} is last in ext.order: playground ext order ${ORG} puts it first`,
  ])
  expect(readSetting(data, "ext.repos")?.value).toEqual({ [ORG]: named })
  expect(readSetting(data, "ext.links")?.value).toEqual({ [ORG]: ["acme-blue"] })
})

test("with no yes, add creates nothing on GitHub and writes nothing here", async () => {
  const { calls, data, run } = await fixture()
  const asked: string[] = []
  const no = async (question: string) => (asked.push(question), false)
  await expect(extAdd(data, ORG, undefined, run, no)).rejects.toThrow(
    `${SLUG} was not created: run playground ext add in a terminal and answer y, or pass --yes`,
  )
  expect(asked).toEqual([
    `playground ext add will create ${SLUG} on GitHub, private, with issues, wiki and projects off. Create it? [y/N]`,
  ])
  expect(created(calls)).toHaveLength(1)
  expect(existsSync(scopeDir(data, ORG))).toBe(false)
})

test("a public repository is refused, and nothing is written", async () => {
  const { bare, calls, data, run } = await fixture({ visibility: "PUBLIC" })
  bare(SLUG)
  await expect(extAdd(data, ORG, undefined, run, YES)).rejects.toThrow(
    `${SLUG} is public, and a scope syncs only with a private repository`,
  )
  expect(created(calls)).toHaveLength(1)
  expect(existsSync(scopeDir(data, ORG))).toBe(false)
  expect(readSetting(data, "ext.order")?.value).toEqual([])
})

test("the login's own extension is ext init's, and a name that is not lowercase letters, digits and dashes is refused", async () => {
  const { data, run } = await fixture()
  await expect(extAdd(data, ME, undefined, run, YES)).rejects.toThrow(
    `${ME} is your login's extension: playground ext init sets it up`,
  )
  await expect(extAdd(data, "Acme", undefined, run, YES)).rejects.toThrow(
    "Acme is not an extension's name: lowercase letters, digits and dashes",
  )
})

test("ext sync pulls an added org's clone like the login's", async () => {
  const { at, bare, data, run } = await fixture()
  const url = bare(SLUG)
  pushFrom(at, url, "shared.md", "first\n")
  await extAdd(data, ORG, undefined, run, YES)
  pushFrom(at, url, "later.md", "pulled\n")
  const out: string[] = []
  const io = { data, out: (line: string) => out.push(line) } as unknown as Io
  expect(await extVerb("sync", [ORG], io, run)).toBe(0)
  expect(readFileSync(join(scopeDir(data, ORG), "later.md"), "utf8")).toBe("pulled\n")
  expect(out[0]).toStartWith(`${ORG} synced with ${SLUG} at `)
})

test("playground ext link, order, unlink and remove print their line, exit 2 on wrong words and 1 on a refusal", async () => {
  const { data, run } = await fixture()
  await extAdd(data, ORG, undefined, run, YES)
  const out: string[] = []
  const err: string[] = []
  const io = { data, out: (line: string) => out.push(line) } as unknown as Io
  const ext = (words: string[]) => runStore("ext", words, io, (line) => err.push(line))
  expect(await ext(["link", "acme", "Acme-Inc"])).toBe(0)
  expect(await ext(["order", "acme"])).toBe(0)
  expect(await ext(["unlink", "acme", "acme-inc"])).toBe(0)
  expect(await ext(["remove", "acme"])).toBe(0)
  expect(out).toEqual([
    "acme is linked to acme-inc",
    `ext.order is now acme, ${ME}, core`,
    "acme is unlinked from acme-inc",
    `removed acme: no session reads it, and ${scopeDir(data, "acme")} stays until you delete it`,
  ])
  expect(await ext(["order"])).toBe(2)
  expect(await ext(["link", "acme"])).toBe(2)
  expect(await ext(["link", "nope", "acme"])).toBe(1)
  expect(err.join("\n")).toContain("no extension nope")
  out.length = 0
  expect(await ext(["list"])).toBe(0)
  expect(JSON.parse(out.join("\n")).map((each: { name: string }) => each.name)).toEqual([
    ME,
    "core",
  ])
})
