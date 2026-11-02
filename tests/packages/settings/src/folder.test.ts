import { afterAll, expect, spyOn, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { MARKER } from "../../../../packages/safe-delete/src"
import {
  commitExt,
  deriveHooks,
  extensionsDir,
  extLog,
  GUARD_LISTS,
  lockPath,
  mustGit,
  scopeDir,
  scopesIn,
  withLock,
  writeFiles,
  writeTree,
} from "../../../../packages/settings/src"

const scratch = mkdtempSync(join(tmpdir(), "ext-folder-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const data = (name: string) => join(scratch, name)
const folder = join(import.meta.dir, "../../../../packages/settings/src/folder.ts")

test("a write lands as one commit in its scope, its author who asked, its message the reason, with its trailers", () => {
  const sha = writeFiles(
    data("one"),
    "tester",
    new Map([["settings.json", '{"a":1}\n']]),
    { author: "worker-x", reason: "turn a on", trailers: [["Setting", "a"]] },
    new Map([["policy.json", "{}"]]),
  )
  const dir = scopeDir(data("one"), "tester")
  expect(mustGit(dir, ["rev-parse", "HEAD"])).toBe(sha!)
  expect(mustGit(dir, ["log", "-1", "--format=%an|%s"])).toBe("worker-x|turn a on")
  expect(readFileSync(join(extensionsDir(data("one")), "policy.json"), "utf8")).toBe("{}")
  expect(scopesIn(data("one"))).toEqual(["tester"])
  expect(extLog(data("one"), "tester", ["Setting", "a"])).toEqual([
    {
      at: expect.any(String),
      author: "worker-x",
      reason: "turn a on",
      sha: sha!,
      trailers: [["Setting", "a"]],
    },
  ])
})

test("why reads only its scope's commits whose trailer matches the line exactly, newest first", () => {
  const write = (scope: string, text: string, key: string) =>
    writeFiles(data("log"), scope, new Map([["settings.json", text]]), {
      author: "owner",
      reason: `set ${key}`,
      trailers: [["Setting", key]],
    })
  const first = write("tester", "1", "ui.theme")
  write("tester", "2", "ui.themeDark")
  write("acme", "2", "ui.theme")
  const third = write("tester", "3", "ui.theme")
  expect(extLog(data("log"), "tester", ["Setting", "ui.theme"]).map((e) => e.sha)).toEqual([
    third!,
    first!,
  ])
  expect(extLog(data("none"), "tester", ["Setting", "ui.theme"])).toEqual([])
})

test("a write that changes nothing makes no commit, unless it asks for an empty one", () => {
  const files = new Map([["a.md", "a"]])
  const commit = { author: "owner", reason: "a" }
  expect(writeFiles(data("same"), "tester", files, commit)).toBeString()
  expect(writeFiles(data("same"), "tester", files, commit)).toBeUndefined()
  const empty = commitExt(
    data("same"),
    "tester",
    { ...commit, allowEmpty: true, reason: "score 4" },
    () => {},
  )
  expect(mustGit(scopeDir(data("same"), "tester"), ["log", "-1", "--format=%H %s"])).toBe(
    `${empty} score 4`,
  )
})

test("core is refused, since it ships with the checkout", () => {
  expect(() =>
    writeFiles(data("core"), "core", new Map([["a.md", "a"]]), { author: "o", reason: "r" }),
  ).toThrow("core is Playground's own")
})

test("a null removes its file and the folders it leaves empty", () => {
  const commit = { author: "owner", reason: "r" }
  writeFiles(
    data("rm"),
    "tester",
    new Map([
      ["rules/a.md", "a"],
      ["b.md", "b"],
    ]),
    commit,
  )
  writeFiles(data("rm"), "tester", new Map([["rules/a.md", null]]), commit)
  expect(existsSync(join(scopeDir(data("rm"), "tester"), "rules"))).toBe(false)
  expect(readFileSync(join(scopeDir(data("rm"), "tester"), "b.md"), "utf8")).toBe("b")
})

test("a tree replaces every file of its scope but those it keeps", () => {
  const commit = { author: "owner", reason: "r" }
  writeTree(
    data("tree"),
    "tester",
    new Map([
      ["a.md", "a"],
      ["proposed/b.md", "b"],
    ]),
    commit,
  )
  writeTree(data("tree"), "tester", new Map([["c.md", "c"]]), commit, (path) =>
    path.startsWith("proposed/"),
  )
  expect(mustGit(scopeDir(data("tree"), "tester"), ["ls-files"]).split("\n")).toEqual([
    "c.md",
    "proposed/b.md",
  ])
})

test("each guard's list derives from the login's lists, and one it lacks is removed and named", () => {
  const lists = new Map(GUARD_LISTS.slice(1).map((name) => [`lists/${name}.json`, `["${name}"]`]))
  writeFiles(data("hooks"), "tester", lists, { author: "o", reason: "lists" })
  expect(
    deriveHooks(data("hooks"), "tester", extensionsDir(data("hooks")), data("hooks-core")),
  ).toEqual([GUARD_LISTS[0]])
  const root = extensionsDir(data("hooks"))
  expect(readFileSync(join(root, `hooks/${GUARD_LISTS[1]}.json`), "utf8")).toBe(
    `["${GUARD_LISTS[1]}"]`,
  )
  expect(existsSync(join(root, `hooks/${GUARD_LISTS[0]}.json`))).toBe(false)
})

test("a guard's list is the union of the login's, each org's and core's, so a login list and a core list both reach it", () => {
  const [name, other] = GUARD_LISTS
  const core = data("union-core")
  mkdirSync(join(core, "lists"), { recursive: true })
  writeFileSync(join(core, "lists", `${name}.json`), '["core-term","shared"]')
  writeFileSync(join(core, "lists", `${other}.json`), '{"a":["core"],"b":["core"]}')
  const commit = { author: "o", reason: "lists" }
  writeFiles(
    data("union"),
    "tester",
    new Map([[`lists/${name}.json`, '["login-term","shared"]']]),
    commit,
  )
  writeFiles(data("union"), "tester", new Map([[`lists/${other}.json`, '{"a":["login"]}']]), commit)
  writeFiles(data("union"), "acme", new Map([[`lists/${name}.json`, '["org-term"]']]), commit)
  deriveHooks(data("union"), "tester", extensionsDir(data("union")), core)
  const hook = (list: string) =>
    JSON.parse(readFileSync(join(extensionsDir(data("union")), `hooks/${list}.json`), "utf8"))
  expect(hook(name!)).toEqual(["login-term", "shared", "org-term", "core-term"])
  expect(hook(other!)).toEqual({ a: ["login", "core"], b: ["core"] })
})

test("a lock left behind by a write that died goes once stale", () => {
  mkdirSync(lockPath(data("locked")), { recursive: true })
  writeFileSync(join(lockPath(data("locked")), MARKER), "")
  const old = new Date(Date.now() - 10 * 60_000)
  utimesSync(lockPath(data("locked")), old, old)
  expect(
    writeFiles(data("locked"), "tester", new Map([["a.md", "a"]]), { author: "o", reason: "r" }),
  ).toBeString()
  expect(existsSync(lockPath(data("locked")))).toBe(false)
})

test("a write's lock carries makeScratch's marker while it runs, and is gone after (#545)", () => {
  const lock = lockPath(data("marked"))
  expect(withLock(data("marked"), () => existsSync(join(lock, MARKER)))).toBe(true)
  expect(existsSync(lock)).toBe(false)
  expect(readdirSync(dirname(lock)).filter((name) => name.startsWith(basename(lock)))).toEqual([])
})

test("an unmarked lock left behind goes aside once stale, and stays there with its refusal logged (#545)", () => {
  const lock = lockPath(data("unmarked"))
  mkdirSync(lock, { recursive: true })
  writeFileSync(join(lock, "left"), "")
  const old = new Date(Date.now() - 10 * 60_000)
  utimesSync(lock, old, old)
  const said = spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(withLock(data("unmarked"), () => "ran", 1_000)).toBe("ran")
    const left = readdirSync(dirname(lock)).filter((name) => name.startsWith(basename(lock)))
    expect(left).toHaveLength(1)
    expect(left[0]).toStartWith(`${basename(lock)}.stale-`)
    expect(String(said.mock.calls[0]?.[0])).toContain(`has no ${MARKER} marker`)
  } finally {
    said.mockRestore()
  }
})

test("a lock taken after a wait reads as just taken, so its stale bound starts at the take (#545)", async () => {
  const at = data("waited")
  const lock = lockPath(at)
  const holder = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { withLock } from ${JSON.stringify(folder)}\nwithLock(${JSON.stringify(at)}, () => { console.log("held"); Bun.sleepSync(1_500) })`,
    ],
    { stdout: "pipe" },
  )
  const reader = holder.stdout.getReader()
  await reader.read()
  const age = withLock(at, () => Date.now() - statSync(lock).mtimeMs)
  await holder.exited
  expect(age).toBeLessThan(500)
})

test("two processes writing at once both land, one commit each", async () => {
  const at = data("race")
  writeFiles(at, "tester", new Map([["seed.md", "seed"]]), { author: "o", reason: "seed" })
  const script = (name: string) =>
    `import { writeFiles } from ${JSON.stringify(folder)}
for (let i = 0; i < 5; i++) writeFiles(${JSON.stringify(at)}, "tester", new Map([["${name}-" + i + ".md", "x"]]), { author: "${name}", reason: "${name} " + i })`
  const runs = ["api", "cli"].map((name) =>
    Bun.spawn([process.execPath, "-e", script(name)], { stderr: "pipe" }),
  )
  const codes = await Promise.all(runs.map((run) => run.exited))
  expect(codes).toEqual([0, 0])
  const dir = scopeDir(at, "tester")
  expect(mustGit(dir, ["rev-list", "--count", "HEAD"])).toBe("11")
  expect(mustGit(dir, ["ls-files"]).split("\n")).toHaveLength(11)
  expect(mustGit(dir, ["status", "--porcelain"])).toBe("")
})
