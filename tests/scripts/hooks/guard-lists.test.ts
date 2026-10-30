import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isStrings, loadList, storeMarker } from "../../../scripts/hooks/lists"
import { check as leakCheck } from "../../../scripts/hooks/no-playground-leak"
import { check as releaseCheck } from "../../../scripts/hooks/no-release-comment"
import { storeWith } from "./render-set"

const coreLists = join(import.meta.dir, "..", "..", "..", "extensions", "core", "lists")
let scratch = ""
// A data folder with the store's marker (a machine with a store) and one without (a stranger's clone).
let stored = ""
let stranger = ""
let config = ""

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "guard-lists-"))
  stored = join(scratch, "stored")
  stranger = join(scratch, "stranger")
  config = join(scratch, "config")
  await mkdir(stranger, { recursive: true })
  await mkdir(config, { recursive: true })
  await mkdir(storeMarker({ PLAYGROUND_DATA_DIR: stored }), { recursive: true })
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

// A folder holding the guard lists given, each as its text, or none for a list left out.
async function lists(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(scratch, name)
  await mkdir(dir, { recursive: true })
  for (const [file, text] of Object.entries(files)) await Bun.write(join(dir, file), text)
  return dir
}

const env = (data: string) => ({ CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: data })

// A data folder whose store holds the guard lists given, each as its text.
const store = (name: string, files: Record<string, string>) =>
  storeWith(join(scratch, name, "data"), files)

describe("loadList", () => {
  const load = (path: string, data: string) =>
    loadList("a-guard", path, isStrings, ["default"], env(data))

  test("a missing list on a stranger's clone takes the empty default", async () => {
    expect(await load(join(scratch, "none.json"), stranger)).toEqual({ list: ["default"] })
  })

  test("a missing list on a machine with a store refuses, naming the file", async () => {
    const { refusal } = await load(join(scratch, "none.json"), stored)
    expect(refusal).toContain(join(scratch, "none.json"))
    expect(refusal).toContain("is missing")
  })

  for (const [shape, text] of [
    ["a 0-byte file", ""],
    ["malformed JSON", "[not json"],
    ["the wrong shape", "{}"],
  ])
    test(`a list that is there but holds ${shape} refuses, store or not`, async () => {
      const dir = await lists(`load-${shape}`, { "list.json": text })
      for (const data of [stored, stranger])
        expect((await load(join(dir, "list.json"), data)).refusal).toContain("a-guard hook refused")
    })

  test("an explicit empty list is the owner's choice and loads", async () => {
    const dir = await lists("load-empty", { "list.json": "[]" })
    expect(await load(join(dir, "list.json"), stored)).toEqual({ list: [] })
  })
})

describe("no-playground-leak fails closed on its lists", () => {
  const TERMS = {
    aliases: ["pgx"],
    everyday: [],
    names: ["quillmark"],
    paths: [],
    probe: "probe",
    sessions: { roles: ["worker"], sins: ["envy"] },
  }
  const CLEARED = { C0000000001: { name: "#cleared" } }
  // A Linear comment, which the guard keeps dispatcher's terms out of whatever ext.links names.
  const write = (body: string) =>
    JSON.stringify({
      cwd: scratch,
      hook_event_name: "PreToolUse",
      tool_input: { body, issueId: "CEDAR-1" },
      tool_name: "mcp__linear-shared__save_comment",
    })
  const read = JSON.stringify({
    cwd: scratch,
    hook_event_name: "PreToolUse",
    tool_input: { command: "ls -la" },
    tool_name: "Bash",
  })
  const run = (raw: string, dir: string, data: string) =>
    leakCheck(raw, env(data), join(scratch, "no-checkout"), dir)

  const good = {
    "playground-terms.json": JSON.stringify(TERMS),
    "slack-cleared.json": JSON.stringify(CLEARED),
  }

  test("on a machine with a store it reads the store's set, not the checkout's lists", async () => {
    const checkout = await lists("leak-good-checkout", {})
    const data = store("leak-good", good)
    expect(await run(write("built by quillmark"), checkout, data)).toContain('"quillmark"')
    expect(await run(write("fixes the export button"), checkout, data)).toBeUndefined()
  })

  test("a stranger's clone reads the checkout's lists", async () => {
    const dir = await lists("leak-clone", good)
    expect(await run(write("built by quillmark"), dir, stranger)).toContain('"quillmark"')
  })

  for (const [shape, terms, cleared, file] of [
    ["its terms list missing", undefined, JSON.stringify(CLEARED), "playground-terms.json"],
    ["its terms list a 0-byte file", "", JSON.stringify(CLEARED), "playground-terms.json"],
    ["its terms list {}", "{}", JSON.stringify(CLEARED), "playground-terms.json"],
    ["its terms list malformed", "{ names: [", JSON.stringify(CLEARED), "playground-terms.json"],
    ["its Slack list missing", JSON.stringify(TERMS), undefined, "slack-cleared.json"],
    ["its Slack list malformed", JSON.stringify(TERMS), "[1", "slack-cleared.json"],
  ] as const)
    test(`with ${shape} in the store's set, it refuses a write and names the file, whatever the checkout holds`, async () => {
      const files: Record<string, string> = {}
      if (terms !== undefined) files["playground-terms.json"] = terms
      if (cleared !== undefined) files["slack-cleared.json"] = cleared
      const checkout = await lists(`leak-${shape}-checkout`, good)
      const reason = await run(
        write("fixes the export button"),
        checkout,
        store(`leak-${shape}`, files),
      )
      expect(reason).toContain("no-playground-leak hook refused this call:")
      expect(reason).toContain(`hooks/${file}`)
    })

  test("a broken list leaves a call that writes nowhere alone", async () => {
    const dir = await lists("leak-read", {})
    expect(
      await run(read, dir, store("leak-read", { "playground-terms.json": "{}" })),
    ).toBeUndefined()
  })

  test("explicit empty lists pass a company write", async () => {
    const data = store("leak-empty", {
      "playground-terms.json": JSON.stringify({
        aliases: [],
        everyday: [],
        names: [],
        paths: [],
        probe: "probe",
        sessions: { roles: [], sins: [] },
      }),
      "slack-cleared.json": "{}",
    })
    const dir = await lists("leak-empty-checkout", {})
    expect(await run(write("fixes the export button"), dir, data)).toBeUndefined()
  })

  test("a stranger's clone with no lists passes a company write and says nothing", async () => {
    const dir = await lists("leak-none", {})
    expect(await run(write("fixes the export button"), dir, stranger)).toBeUndefined()
  })
})

describe("no-release-comment fails closed on its owners list", () => {
  const comment = (body: string) =>
    JSON.stringify({
      cwd: scratch,
      hook_event_name: "PreToolUse",
      tool_input: { command: `gh pr comment 12 -R acme/gitpick -b "${body}"` },
      tool_name: "Bash",
    })
  const run = (raw: string, dir: string, data: string) => releaseCheck(raw, env(data), dir)

  test("an owner on the store's list is guarded, and the checkout's list is not read", async () => {
    const dir = await lists("release-good", { "release-owners.json": "[]" })
    const data = store("release-good", { "release-owners.json": '["acme"]' })
    expect(await run(comment("the release is out"), dir, data)).toContain(
      "no-release-comment hook refused",
    )
    expect(await run(comment("the ship is out"), dir, data)).toBeUndefined()
  })

  for (const [shape, text] of [
    ["missing", undefined],
    ["a 0-byte file", ""],
    ["{}", "{}"],
    ["malformed", '["acme"'],
  ] as const)
    test(`a list that is ${shape} in the store's set refuses a comment and names the file`, async () => {
      const dir = await lists(`release-${shape}`, { "release-owners.json": "[]" })
      const data = store(
        `release-${shape}`,
        text === undefined ? {} : { "release-owners.json": text },
      )
      const reason = await run(comment("the ship is out"), dir, data)
      expect(reason).toContain("no-release-comment hook refused this call:")
      expect(reason).toContain("hooks/release-owners.json")
    })

  test("an explicit empty list guards no owner", async () => {
    const dir = await lists("release-empty", {})
    const data = store("release-empty", { "release-owners.json": "[]" })
    expect(await run(comment("the release is out"), dir, data)).toBeUndefined()
  })

  test("a stranger's clone with no list guards no owner", async () => {
    const dir = await lists("release-none", {})
    expect(await run(comment("the release is out"), dir, stranger)).toBeUndefined()
  })

  test("core's list names no owner, so a fresh clone guards none until its extensions set one", async () => {
    expect(await Bun.file(join(coreLists, "release-owners.json")).json()).toEqual([])
    expect(
      await releaseCheck(
        comment("the release is out").replace("acme", "qmarsh"),
        env(stranger),
        coreLists,
      ),
    ).toBeUndefined()
  })
})
