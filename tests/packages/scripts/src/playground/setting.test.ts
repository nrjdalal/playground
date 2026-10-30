import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  factoryRepo,
  factoryRepoOf,
  originRepo,
  settingExit,
} from "../../../../../packages/scripts/src/playground/setting"
import { writeRoot } from "../../../../../packages/settings/src/folder"
import { extensionsDir } from "../../../../../packages/settings/src/rendered"

const scratch = mkdtempSync(join(tmpdir(), "setting-cli-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const render = (name: string, values: Record<string, unknown>): string => {
  const text = JSON.stringify({ orgs: {}, schemaVersion: 1, values })
  writeRoot(extensionsDir(join(scratch, name)), new Map([["policy.json", text]]))
  return join(scratch, name)
}
const exit = async (words: string[], data: string) => {
  const out: string[] = []
  const err: string[] = []
  const code = await settingExit(
    words,
    { PLAYGROUND_DATA_DIR: data },
    (l) => out.push(l),
    (l) => err.push(l),
  )
  return { code, err: err.join("\n"), out: out.join("\n") }
}
const checkout = (name: string, url?: string): string => {
  const dir = join(scratch, name)
  mkdirSync(dir)
  Bun.spawnSync(["git", "init", "-q", dir])
  if (url) Bun.spawnSync(["git", "-C", dir, "remote", "add", "origin", url])
  return dir
}

test("exit 0 prints the value as JSON, its default with no store, and exit 2 names why", async () => {
  expect(await exit(["ext.repos"], join(scratch, "none"))).toEqual({
    code: 0,
    err: "",
    out: "{}",
  })
  const data = render("set", { "ext.repos": { acme: "made-up-me/acme-copy" } })
  expect((await exit(["ext.repos"], data)).out).toBe('{"acme":"made-up-me/acme-copy"}')
  expect(await exit(["no.such"], data)).toEqual({
    code: 2,
    err: "no setting no.such; playground settings list names them",
    out: "",
  })
  await Bun.write(join(extensionsDir(data), "policy.json"), "{")
  const refused = await exit(["ext.repos"], data)
  expect(refused.code).toBe(2)
  expect(refused.err).toContain("does not parse")
})

test("several keys print a line each, --text a string as it is and a list joined by spaces", async () => {
  const none = join(scratch, "none")
  expect((await exit(["ext.repos", "models.claude"], none)).out).toBe(
    '{}\n["claude-opus-5-5","claude-fable-5-1","claude-sonnet-5-5","claude-haiku-5-5"]',
  )
  expect((await exit(["--text", "models.default", "models.claude"], none)).out).toBe(
    "claude-opus-5-5\nclaude-opus-5-5 claude-fable-5-1 claude-sonnet-5-5 claude-haiku-5-5",
  )
  expect(await exit(["models.default", "no.such"], none)).toEqual({
    code: 2,
    err: "no setting no.such; playground settings list names them",
    out: "",
  })
  expect((await exit([], none)).code).toBe(2)
})

test("factory.repo is its set value, else the checkout's origin, lowercase", () => {
  const host = "github.com"
  const ssh = checkout("ssh", `git@${host}:Acme/Factory.git`)
  const https = checkout("https", "https://github.com/acme/factory-two")
  const none = checkout("none")
  const unset = { schemaVersion: 1 as const, values: {} }
  expect(originRepo(ssh)).toBe("acme/factory")
  expect(originRepo(https)).toBe("acme/factory-two")
  expect(originRepo(none)).toBe("")
  expect(factoryRepo(unset, ssh)).toBe("acme/factory")
  expect(factoryRepo({ schemaVersion: 1, values: { "factory.repo": "Acme/Set" } }, ssh)).toBe(
    "acme/set",
  )
})

test("with factory.repo unset and no GitHub origin, factoryRepoOf refuses, naming the store and the key, so no gate reads no repo as the factory's", async () => {
  const none = checkout("orphan")
  const data = join(scratch, "unset-store")
  const refused = factoryRepoOf({ PLAYGROUND_DATA_DIR: data }, none)
  await expect(refused).rejects.toThrow(`factory.repo is unset in ${data}`)
  await expect(refused).rejects.toThrow("playground settings set factory.repo <owner>/<name>")
  expect(
    await factoryRepoOf(
      { PLAYGROUND_DATA_DIR: data },
      checkout("orphan-ssh", "git@github.com:Acme/Factory.git"),
    ),
  ).toBe("acme/factory")
})

test("the CLI prints factory.repo resolved, the checkout's origin when unset", async () => {
  expect(JSON.parse((await exit(["factory.repo"], join(scratch, "none"))).out)).toBe(originRepo())
})

test("factory.iceboxIssue is no setting, and a store that still holds it reads every other key", async () => {
  const data = render("icebox", { "factory.iceboxIssue": 42, "factory.repo": "acme/made-up" })
  expect(await exit(["factory.iceboxIssue"], data)).toMatchObject({ code: 2, out: "" })
  expect(await exit(["--text", "factory.repo"], data)).toEqual({
    code: 0,
    err: "",
    out: "acme/made-up",
  })
})

test("a folder ext init made, with no policy.json written yet, reads each key's default, as spawn.sh's model and gate read takes them", async () => {
  const data = join(scratch, "unwritten")
  mkdirSync(join(data, "extensions", "made-up-me"), { recursive: true })
  await Bun.write(join(data, "extensions", "login"), "made-up-me\n")
  const read = await exit(["--text", "models.default", "context.window"], data)
  expect(read).toEqual({ code: 0, err: "", out: "claude-opus-5-5\n400000" })
})

test("a policy.json that is there and does not parse still exits 2 naming it", async () => {
  const data = join(scratch, "broken")
  mkdirSync(extensionsDir(data), { recursive: true })
  await Bun.write(join(extensionsDir(data), "policy.json"), "{")
  const read = await exit(["models.default"], data)
  expect(read.code).toBe(2)
  expect(read.err).toContain("policy.json does not parse")
})

test("--guarded-orgs prints every org ext.links links, none with no store, and exits 2 on a value its schema refuses", async () => {
  expect(await exit(["--guarded-orgs"], join(scratch, "none"))).toEqual({
    code: 0,
    err: "",
    out: "[]",
  })
  const data = render("links", { "ext.links": { acme: ["acme-co", "*"], other: ["zeta"] } })
  expect((await exit(["--guarded-orgs"], data)).out).toBe('["acme-co","zeta"]')
  const refused = await exit(
    ["--guarded-orgs"],
    render("bad-links", { "ext.links": { acme: ["Acme Co"] } }),
  )
  expect(refused.code).toBe(2)
  expect(refused.err).toContain("ext.links cannot be read")
})
