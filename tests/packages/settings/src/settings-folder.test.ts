import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "../../../../packages/settings/node_modules/zod"
import {
  CORE_READ_ONLY,
  defineSettings,
  listSettings,
  readSetting,
  resetSetting,
  setSetting,
  settingHistory,
  extGit,
  extensionsDir,
  scopeDir,
  type Who,
} from "../../../../packages/settings/src"

process.env.PLAYGROUND_LOGIN = "made-up-me"
const ME = "made-up-me"
const REPO = join(import.meta.dir, "../../../..")

defineSettings({
  "folderFixture.count": {
    aliases: ["folderFixture.oldCount"],
    default: 1,
    description: "A made-up count.",
    schema: z.number().int().min(0),
  },
  "folderFixture.name": { default: "", description: "A made-up name.", schema: z.string() },
})

const scratch = mkdtempSync(join(tmpdir(), "settings-folder-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
let n = 0
const fresh = () => join(scratch, `data-${n++}`)

const who = (reason: string, author = "owner"): Who => ({
  actor: "cli",
  author,
  inboxRef: null,
  reason,
})
const set = (data: string, key: string, scope: string, value: unknown, by: Who) =>
  setSetting(data, { key, scope, value }, by)
const file = (data: string, path: string) =>
  JSON.parse(readFileSync(join(extensionsDir(data), path), "utf8"))
const git = (data: string, scope: string, args: string[]) => extGit(scopeDir(data, scope), args)
const commits = (data: string, scope = ME) =>
  git(data, scope, ["rev-list", "--count", "HEAD"]).out.trim()

describe("settings over the extensions folder", () => {
  test("set writes the scope's settings.json in one commit there, by who asked, with the reason, and policy.json at the root", () => {
    const data = fresh()
    expect(set(data, "folderFixture.count", ME, 4, who("four for me"))).toEqual({
      key: "folderFixture.count",
      ok: true,
      scope: ME,
      value: 4,
    })
    set(data, "folderFixture.count", "acme", 6, who("six for acme", "builder"))
    expect(file(data, `${ME}/settings.json`)).toEqual({ "folderFixture.count": 4 })
    expect(file(data, "acme/settings.json")).toEqual({ "folderFixture.count": 6 })
    expect([commits(data), commits(data, "acme")]).toEqual(["1", "1"])
    const head = git(data, "acme", ["log", "-1", "--format=%an%n%s%n%(trailers:only,unfold)"]).out
    expect(head).toContain("builder\nsix for acme\n")
    expect(head).toContain("Setting: folderFixture.count")
    expect(head).toContain("Actor: cli")
    expect(git(data, ME, ["status", "--porcelain"]).out.trim()).toBe("")
    expect(file(data, "policy.json")).toMatchObject({
      orgs: {},
      values: { "folderFixture.count": 4 },
    })
    set(data, "ext.links", ME, { acme: ["acme-inc"] }, who("acme's repos read acme"))
    set(data, "ext.order", ME, ["acme", ME], who("acme first"))
    expect(file(data, "policy.json")).toMatchObject({
      orgs: { "acme-inc": { "folderFixture.count": 6 } },
      values: { "folderFixture.count": 4 },
    })
  })

  test("get reads the login's value over a linked extension's, that one's over the default, and the default when none is set", () => {
    const data = fresh()
    expect(readSetting(data, "folderFixture.count")).toEqual({
      default: 1,
      key: "folderFixture.count",
      rows: [],
      value: 1,
    })
    set(data, "ext.links", ME, { acme: ["acme"] }, who("acme's repos read acme"))
    set(data, "folderFixture.count", "acme", 9, who("acme"))
    expect(readSetting(data, "folderFixture.count")?.value).toBe(1)
    expect(readSetting(data, "folderFixture.count", "acme")?.value).toBe(1)
    set(data, "ext.order", ME, [ME, "acme"], who("acme after me"))
    expect(readSetting(data, "folderFixture.count", "acme")?.value).toBe(9)
    set(data, "folderFixture.count", ME, 2, who("mine"))
    expect(readSetting(data, "folderFixture.count", "acme")?.value).toBe(2)
    set(data, "folderFixture.count", "other", 5, who("not linked"))
    expect(readSetting(data, "folderFixture.count", "acme")?.rows.map((row) => row.scope)).toEqual([
      "acme",
      ME,
      "other",
    ])
    expect(readSetting(data, "folderFixture.nope")).toBeNull()
  })

  test("core reads from the checkout's extensions/core/settings.json, and a write to core is refused as read-only", () => {
    const data = fresh()
    expect(scopeDir(data, "core")).toBe(join(REPO, "extensions/core"))
    expect(JSON.parse(readFileSync(join(REPO, "extensions/core/settings.json"), "utf8"))).toEqual(
      {},
    )
    const refused = set(data, "folderFixture.count", "core", 1, who("x"))
    expect(refused).toEqual({ message: CORE_READ_ONLY, ok: false, status: 409 })
    expect(resetSetting(data, { key: "folderFixture.count", scope: "core" }, who("x"))).toEqual(
      refused,
    )
  })

  test("an alias writes and reads under the current name, and an empty string is a value of its own", () => {
    const data = fresh()
    expect(set(data, "folderFixture.oldCount", ME, 3, who("old name"))).toMatchObject({
      key: "folderFixture.count",
      ok: true,
    })
    expect(readSetting(data, "folderFixture.oldCount")?.value).toBe(3)
    set(data, "folderFixture.name", ME, "", who("unset on purpose"))
    expect(file(data, `${ME}/settings.json`)).toEqual({
      "folderFixture.count": 3,
      "folderFixture.name": "",
    })
  })

  test("a value its schema refuses, a secret, an unknown key or a scope GitHub would not name is refused, and nothing is committed", () => {
    const data = fresh()
    set(data, "folderFixture.count", ME, 1, who("first"))
    const refusals = [
      set(data, "folderFixture.count", ME, -1, who("x")),
      set(data, "folderFixture.name", ME, `ghp_${"a".repeat(36)}`, who("x")),
      set(data, "folderFixture.nope", ME, 1, who("x")),
      set(data, "folderFixture.count", "org:acme", 1, who("x")),
      set(data, "folderFixture.count", "../up", 1, who("x")),
    ]
    expect(refusals.map((r) => (r.ok ? "ok" : r.status))).toEqual([400, 400, 400, 400, 400])
    expect(refusals[1]!.ok ? "" : refusals[1]!.message).toContain("a GitHub token")
    expect(commits(data)).toBe("1")
  })

  test("reset drops the key and its aliases from the scope's file, and one at its default is refused", () => {
    const data = fresh()
    set(data, "folderFixture.count", ME, 5, who("five"))
    set(data, "folderFixture.name", ME, "kept", who("kept"))
    expect(resetSetting(data, { key: "folderFixture.count", scope: ME }, who("back"))).toEqual({
      key: "folderFixture.count",
      ok: true,
      scope: ME,
    })
    expect(file(data, `${ME}/settings.json`)).toEqual({ "folderFixture.name": "kept" })
    expect(file(data, "policy.json").values).toEqual({ "folderFixture.name": "kept" })
    const again = resetSetting(data, { key: "folderFixture.count", scope: ME }, who("again"))
    expect(again.ok ? 0 : again.status).toBe(409)
    expect(commits(data)).toBe("3")
  })

  test("a key no piece defines stays in its scope's file when another key is written", async () => {
    const data = fresh()
    set(data, "folderFixture.count", ME, 2, who("two"))
    await Bun.write(
      join(scopeDir(data, ME), "settings.json"),
      JSON.stringify({ "folderFixture.count": 2, "retired.key": true }),
    )
    set(data, "folderFixture.name", ME, "x", who("x"))
    expect(file(data, `${ME}/settings.json`)["retired.key"]).toBe(true)
    expect(listSettings(data).rows.map((row) => row.key)).toContain("retired.key")
  })

  test("why reads the commits that changed a key, in every scope, under its name and its alias, newest first, with the value before and after", () => {
    const data = fresh()
    set(data, "folderFixture.count", ME, 2, who("two"))
    set(data, "folderFixture.name", ME, "y", who("not this key"))
    set(data, "folderFixture.count", ME, 7, who("seven", "builder"))
    resetSetting(data, { key: "folderFixture.count", scope: ME }, who("back to one"))
    const history = settingHistory(data, "folderFixture.oldCount")!
    expect(
      history.map(({ author, newValue, oldValue, reason, scope }) => ({
        author,
        newValue,
        oldValue,
        reason,
        scope,
      })),
    ).toEqual([
      { author: "owner", newValue: null, oldValue: 7, reason: "back to one", scope: ME },
      { author: "builder", newValue: 7, oldValue: 2, reason: "seven", scope: ME },
      { author: "owner", newValue: 2, oldValue: null, reason: "two", scope: ME },
    ])
    expect(history[0]!.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(settingHistory(data, "folderFixture.nope")).toBeNull()
  })

  test("list names every defined key with its default and aliases, and every row set", () => {
    const data = fresh()
    set(data, "folderFixture.count", ME, 2, who("two"))
    const listed = listSettings(data)
    expect(listed.keys.find((k) => k.key === "folderFixture.count")).toEqual({
      aliases: ["folderFixture.oldCount"],
      default: 1,
      description: "A made-up count.",
      key: "folderFixture.count",
    })
    expect(listed.rows).toEqual([{ key: "folderFixture.count", scope: ME, value: 2 }])
  })

  // A fresh machine's Settings page opens before ext init names a login, so its reads answer the defaults and its writes say what to run.
  test("with no login yet, a read answers the default and a write is refused naming ext init, writing nothing", () => {
    const data = fresh()
    delete process.env.PLAYGROUND_LOGIN
    try {
      expect(readSetting(data, "folderFixture.count")).toMatchObject({ rows: [], value: 1 })
      const refused = {
        message:
          "settings are written to your extensions, which need a login: run playground ext init",
        ok: false,
        status: 409,
      } as const
      expect(set(data, "folderFixture.count", ME, 2, who("two"))).toEqual(refused)
      expect(resetSetting(data, { key: "folderFixture.count", scope: ME }, who("x"))).toEqual(
        refused,
      )
      expect(existsSync(extensionsDir(data))).toBe(false)
    } finally {
      process.env.PLAYGROUND_LOGIN = ME
    }
  })
})
