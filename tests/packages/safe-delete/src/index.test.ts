import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CARVE_OUTS,
  type CarveOut,
  type Clone,
  isProtected,
  LIMITS,
  linkPlaces,
  listTrash,
  MARKER,
  makeScratch,
  type Proc,
  purgeTrash,
  quarantine,
  type Quarantined,
  removeScratch,
  restore,
  type Roots,
  worktreeRefusal,
} from "../../../../packages/safe-delete/src"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A made-up process for the holder check: no process starts, the list is data.
const proc = (pid: number, command: string, cwd: string, sockets: string[] = []): Proc => ({
  command,
  cwd,
  pid,
  sockets,
})

// A fake machine on a mkdtemp root of its own: a HOME, a main checkout in it, and the trash in its state folder.
const machine = (): Roots & { root: string } => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "safe-delete-")))
  dirs.push(root)
  const home = join(root, "home")
  const main = join(home, "playground")
  mkdirSync(join(main, ".claude", "worktrees"), { recursive: true })
  for (const dir of [".config", ".ssh", ".gnupg", ".claude", "Library", "Music", ".playground"])
    mkdirSync(join(home, dir), { recursive: true })
  writeFileSync(join(home, ".ssh", "id_ed25519"), "key")
  return { home, main, root, trash: join(home, ".playground", "trash") }
}

const file = (path: string, text = "x"): string => {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text)
  return path
}

const NOW = new Date("2026-11-02T12:00:00Z")
const opts = { reason: "test", session: "j6rjgy-worker" }

describe("isProtected", () => {
  test.each([
    ["HOME", (r: Roots) => r.home],
    ["a folder that holds HOME", (r: Roots) => join(r.home, "..")],
    ["~/.config", (r: Roots) => join(r.home, ".config")],
    ["a key in ~/.ssh", (r: Roots) => join(r.home, ".ssh", "id_ed25519")],
    ["~/.gnupg", (r: Roots) => join(r.home, ".gnupg")],
    ["~/.claude", (r: Roots) => join(r.home, ".claude")],
    ["~/Library", (r: Roots) => join(r.home, "Library")],
    ["~/Music", (r: Roots) => join(r.home, "Music")],
    ["~/.playground", (r: Roots) => join(r.home, ".playground")],
    ["a file in ~/.playground", (r: Roots) => join(r.home, ".playground", "roster.json")],
    ["the trash root", (r: Roots) => r.trash],
    ["a path in the trash", (r: Roots) => join(r.trash, "20261102T120000Z-a", "1")],
    ["the main checkout", (r: Roots) => r.main],
    ["a file in the main checkout", (r: Roots) => join(r.main, "AGENTS.md")],
    ["the worktrees folder", (r: Roots) => join(r.main, ".claude", "worktrees")],
  ])("refuses %s", (_, pick) => {
    const roots = machine()
    expect(isProtected(pick(roots), roots)).toBeString()
  })

  test("refuses a symlink whose target is protected, and one inside a protected folder", () => {
    const roots = machine()
    const link = join(roots.root, "scratch", "keys")
    mkdirSync(join(roots.root, "scratch"))
    symlinkSync(join(roots.home, ".ssh"), link)
    expect(isProtected(link, roots)).toContain(".ssh")
    const inside = join(roots.home, ".config", "pointer")
    symlinkSync(join(roots.root, "scratch"), inside)
    expect(isProtected(inside, roots)).toContain(".config")
  })

  test("refuses ~/.playground and the trash root's parent when the trash sits elsewhere", () => {
    const roots = machine()
    const elsewhere = { ...roots, trash: join(roots.root, "data", "trash") }
    expect(isProtected(join(roots.home, ".playground", "x"), elsewhere)).toBeString()
    expect(isProtected(join(roots.root, "data", "notes.md"), elsewhere)).toBeString()
  })

  test("lets a session's scratch folder, a worktree and a file in a worktree go", () => {
    const roots = machine()
    expect(isProtected(join(roots.root, "scratch"), roots)).toBeNull()
    expect(isProtected(join(roots.home, "notes"), roots)).toBeNull()
    expect(isProtected(join(roots.main, ".claude", "worktrees", "wt"), roots)).toBeNull()
    expect(isProtected(join(roots.main, ".claude", "worktrees", "wt", ".next"), roots)).toBeNull()
  })
})

describe("quarantine, listTrash and restore", () => {
  test("renames a path into the trash with a manifest line, lists it, and restores it", () => {
    const roots = machine()
    const doomed = join(roots.home, "work", "old")
    file(join(doomed, "a.txt"), "hello")
    file(join(doomed, "b", "c.txt"), "hi")
    const moved = quarantine(doomed, opts, roots, { now: NOW })
    if ("refused" in moved) throw new Error(moved.refused)
    expect(moved.id).toBe("20261102T120000Z-j6rjgy-worker/1")
    expect(moved).toMatchObject({ files: 2, size: 7 })
    expect(existsSync(doomed)).toBe(false)
    expect(readFileSync(join(roots.trash, moved.id, "old", "a.txt"), "utf8")).toBe("hello")
    const manifest = readFileSync(
      join(roots.trash, "20261102T120000Z-j6rjgy-worker", "manifest.jsonl"),
      "utf8",
    )
    expect(JSON.parse(manifest)).toMatchObject({
      files: 2,
      id: moved.id,
      path: doomed,
      reason: "test",
      session: "j6rjgy-worker",
      size: 7,
    })
    expect(listTrash(roots.trash).map((entry) => entry.id)).toEqual([moved.id])
    expect(restore(moved.id, roots)).toEqual({ path: doomed })
    expect(readFileSync(join(doomed, "b", "c.txt"), "utf8")).toBe("hi")
    expect(listTrash(roots.trash)).toEqual([])
  })

  test("numbers a second path of the same second and session 2", () => {
    const roots = machine()
    quarantine(file(join(roots.home, "one")), opts, roots, { now: NOW })
    const second = quarantine(file(join(roots.home, "two")), opts, roots, { now: NOW })
    expect(second).toMatchObject({ id: "20261102T120000Z-j6rjgy-worker/2" })
  })

  test("restore refuses when something stands at the original path, or the id is unknown", () => {
    const roots = machine()
    const path = file(join(roots.home, "note"))
    const moved = quarantine(path, opts, roots, { now: NOW })
    if ("refused" in moved) throw new Error(moved.refused)
    file(path, "new")
    expect(restore(moved.id, roots)).toMatchObject({ refused: expect.stringContaining(path) })
    expect(restore("20261102T120000Z-j6rjgy-worker/9", roots)).toHaveProperty("refused")
    expect(restore("../../etc", roots)).toHaveProperty("refused")
  })

  test("restore refuses a manifest path that is protected", () => {
    const roots = machine()
    const moved = quarantine(file(join(roots.home, "note")), opts, roots, { now: NOW })
    if ("refused" in moved) throw new Error(moved.refused)
    const manifest = join(roots.trash, "20261102T120000Z-j6rjgy-worker", "manifest.jsonl")
    const edited = {
      ...JSON.parse(readFileSync(manifest, "utf8")),
      path: join(roots.home, ".ssh", "note"),
    }
    writeFileSync(manifest, `${JSON.stringify(edited)}\n`)
    expect(restore(moved.id, roots)).toMatchObject({ kind: "protected" })
    expect(existsSync(join(roots.home, ".ssh", "note"))).toBe(false)
  })

  test("refuses a protected path, a missing path and a bad session name", () => {
    const roots = machine()
    expect(quarantine(join(roots.home, ".ssh"), opts, roots)).toMatchObject({ kind: "protected" })
    expect(quarantine(join(roots.home, "gone"), opts, roots)).toMatchObject({ kind: "refused" })
    const path = file(join(roots.home, "x"))
    expect(quarantine(path, { ...opts, session: "a/b" }, roots)).toMatchObject({ kind: "refused" })
  })

  test("refuses a move that would cross volumes, and leaves the path in place", () => {
    const roots = machine()
    const path = file(join(roots.home, "elsewhere"))
    const dev = (p: string) => (p === path ? 1 : 2)
    expect(quarantine(path, opts, roots, { dev, now: NOW })).toMatchObject({
      kind: "refused",
      refused: expect.stringContaining("volume"),
    })
    expect(existsSync(path)).toBe(true)
  })

  test("refuses a worktree without --worktree, and --worktree on a plain folder", () => {
    const roots = machine()
    const wt = join(roots.main, ".claude", "worktrees", "wt")
    file(join(wt, "a"))
    expect(quarantine(wt, opts, roots)).toMatchObject({
      refused: expect.stringContaining("--worktree"),
    })
    const plain = file(join(roots.home, "plain"))
    const holders = {
      clones: () => [],
      discard: false,
      live: ["working"],
      merged: () => true,
      places: () => [],
      procs: [],
      roster: join(roots.root, "roster.json"),
    }
    expect(quarantine(plain, { ...opts, worktree: holders }, roots)).toHaveProperty("refused")
  })

  // PG-1066: the route the refusal names is the one a big tree still takes: the lead's cleanup, past what plain rm moves
  test("--worktree on a plain folder past the tripwire names its cap and the lead's cleanup, as plain rm then refuses it", () => {
    const roots = machine()
    const big = join(roots.home, "scratch", "big")
    mkdirSync(big, { recursive: true })
    for (let i = 0; i <= 5000; i++) writeFileSync(join(big, String(i)), "")
    const holders = {
      clones: () => [],
      discard: true,
      live: ["working"],
      merged: () => true,
      places: () => [],
      procs: [],
      roster: join(roots.root, "roster.json"),
    }
    const worktrees = join(roots.main, ".claude", "worktrees")
    expect(quarantine(big, { ...opts, worktree: holders }, roots, { now: NOW })).toEqual({
      kind: "refused",
      refused: `--worktree takes a folder in ${worktrees}, not ${big}: playground rm ${big} moves a folder outside it to the trash, with no --worktree or --discard, up to 5,000 files or 2 GB; leave a bigger tree in place for your lead's cleanup`,
    })
    expect(quarantine(big, opts, roots, { now: NOW })).toMatchObject({ kind: "tripwire" })
    expect(existsSync(big)).toBe(true)
  })
})

describe("the tripwire", () => {
  test("refuses a path of more than 5,000 files", () => {
    const roots = machine()
    const big = join(roots.home, "big")
    mkdirSync(big)
    for (let i = 0; i <= 5000; i++) writeFileSync(join(big, String(i)), "")
    expect(quarantine(big, opts, roots, { now: NOW })).toMatchObject({ kind: "tripwire" })
    expect(existsSync(big)).toBe(true)
  })

  test("refuses a path of more than 2 GB", () => {
    const roots = machine()
    const path = file(join(roots.home, "huge.bin"), "")
    truncateSync(path, 2 * 1024 ** 3 + 1)
    expect(quarantine(path, opts, roots, { now: NOW })).toMatchObject({ kind: "tripwire" })
  })

  test("counts a quarantine whose second-cut stamp sits just outside the minute", () => {
    const roots = machine()
    const at = new Date("2026-11-02T12:00:00.900Z")
    for (const name of ["a", "b", "c"])
      expect(quarantine(file(join(roots.home, name)), opts, roots, { now: at })).toHaveProperty(
        "id",
      )
    const later = new Date("2026-11-02T12:01:00.500Z")
    expect(quarantine(file(join(roots.home, "d")), opts, roots, { now: later })).toMatchObject({
      kind: "tripwire",
    })
  })

  test("a session at the cap alerts once a burst: its first refused try is a tripwire, every later one inside it a plain refusal, and the next burst alerts again", () => {
    const roots = machine()
    for (const name of ["a", "b", "c"])
      expect(quarantine(file(join(roots.home, name)), opts, roots, { now: NOW })).toHaveProperty(
        "id",
      )
    const kinds = Array.from({ length: 11 }, (_, i) => {
      const done = quarantine(file(join(roots.home, `x${i}`)), opts, roots, {
        now: new Date(NOW.getTime() + 2_000 + i * 2_500),
      })
      return "kind" in done ? done.kind : "moved"
    })
    expect(kinds).toEqual(["tripwire", ...Array(10).fill("refused")])
    const later = new Date(NOW.getTime() + 61_000)
    for (const name of ["d", "e", "f"])
      expect(quarantine(file(join(roots.home, name)), opts, roots, { now: later })).toHaveProperty(
        "id",
      )
    expect(
      quarantine(file(join(roots.home, "g")), opts, roots, {
        now: new Date(later.getTime() + 1_000),
      }),
    ).toMatchObject({ kind: "tripwire" })
    expect(listTrash(roots.trash)).toHaveLength(6)
  })

  test("refuses a fourth quarantine within a minute from one session, and lets another go", () => {
    const roots = machine()
    for (const name of ["a", "b", "c"])
      expect(quarantine(file(join(roots.home, name)), opts, roots, { now: NOW })).toHaveProperty(
        "id",
      )
    const fourth = file(join(roots.home, "d"))
    const later = new Date(NOW.getTime() + 30_000)
    expect(quarantine(fourth, opts, roots, { now: later })).toMatchObject({ kind: "tripwire" })
    expect(quarantine(fourth, { ...opts, session: "other" }, roots, { now: later })).toHaveProperty(
      "id",
    )
    const fifth = file(join(roots.home, "e"))
    const minuteOn = new Date(NOW.getTime() + 61_000)
    expect(quarantine(fifth, opts, roots, { now: minuteOn })).toHaveProperty("id")
  })
})

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString().trim()
}

// A main checkout with a remote, and a worktree on branch PG-1-thing whose one commit is not pushed; its holders call that commit's PR merged, so a test of the holders meets no landed check.
const withWorktree = () => {
  const roots = machine()
  const remote = join(roots.root, "remote.git")
  git(roots.root, "init", "--bare", "-q", remote)
  git(roots.main, "init", "-q", "-b", "canary")
  file(join(roots.main, "README.md"))
  git(roots.main, "add", ".")
  git(roots.main, "commit", "-qm", "init")
  git(roots.main, "remote", "add", "origin", remote)
  git(roots.main, "push", "-q", "origin", "canary")
  const wt = join(roots.main, ".claude", "worktrees", "pg-1")
  git(roots.main, "worktree", "add", "-q", "-b", "PG-1-thing", wt)
  file(join(wt, "new.txt"))
  git(wt, "add", ".")
  git(wt, "commit", "-qm", "work")
  const roster = join(roots.root, "roster.json")
  writeFileSync(roster, JSON.stringify({ agents: [] }))
  const holders = {
    clones: (): Clone[] => [],
    discard: false,
    live: ["working"],
    merged: (_sha: string, _at: string): boolean | null => true,
    places: (): string[] => [],
    procs: [] as Proc[] | null,
    roster,
  }
  return { holders, roots, wt }
}

// A carve-out table for the mechanism's own cases: one script's builds folder, under a cap of 3 files and 100 bytes.
const TABLE: Record<string, CarveOut> = {
  builder: { bytes: 100, files: 3, folder: "ops/builds" },
  trashy: { bytes: 100, files: 3, folder: "." },
}
const carved = { ...opts, carveOut: "builder" }

describe("a carve-out", () => {
  test("lets an entry directly in its folder through, records it, and restore puts it back", () => {
    const roots = machine()
    const path = file(join(roots.home, ".playground", "ops", "builds", "abc", "web"))
    const moved = quarantine(join(path, ".."), carved, roots, { carveOuts: TABLE, now: NOW })
    expect(moved).toMatchObject({ files: 1 })
    expect(existsSync(path)).toBe(false)
    const [entry] = listTrash(roots.trash)
    expect(entry).toMatchObject({ carveOut: "builder", path: join(path, "..") })
    expect(restore(entry!.id, roots, TABLE)).toEqual({ path: join(path, "..") })
    expect(readFileSync(path, "utf8")).toBe("x")
  })

  test("without its name the same entry stays protected", () => {
    const roots = machine()
    const path = file(join(roots.home, ".playground", "ops", "builds", "abc"))
    expect(quarantine(path, opts, roots, { carveOuts: TABLE, now: NOW })).toMatchObject({
      kind: "protected",
    })
    expect(existsSync(path)).toBe(true)
  })

  test.each([
    ["its folder itself", (home: string) => join(home, ".playground", "ops", "builds")],
    ["its parent", (home: string) => join(home, ".playground", "ops")],
    [
      "a sibling folder's entry",
      (home: string) => join(home, ".playground", "ops", "other", "abc"),
    ],
    [
      "an entry deeper in its folder",
      (home: string) => join(home, ".playground", "ops", "builds", "abc", "web"),
    ],
  ])("refuses %s and moves nothing", (_, pathOf) => {
    const roots = machine()
    file(join(roots.home, ".playground", "ops", "builds", "abc", "web", "x"))
    file(join(roots.home, ".playground", "ops", "other", "abc", "x"))
    const path = pathOf(roots.home)
    expect(quarantine(path, carved, roots, { carveOuts: TABLE, now: NOW })).toMatchObject({
      kind: "protected",
    })
    expect(existsSync(path)).toBe(true)
    expect(listTrash(roots.trash)).toEqual([])
  })

  test.each([
    ["files", (dir: string) => ["a", "b", "c", "d"].forEach((name) => file(join(dir, name)))],
    ["bytes", (dir: string) => void file(join(dir, "big"), "x".repeat(101))],
  ])("refuses an entry over its cap in %s as a tripwire", (_, fill) => {
    const roots = machine()
    const dir = join(roots.home, ".playground", "ops", "builds", "abc")
    fill(dir)
    expect(quarantine(dir, carved, roots, { carveOuts: TABLE, now: NOW })).toMatchObject({
      kind: "tripwire",
      refused: expect.stringContaining("builder carve-out's cap"),
    })
    expect(existsSync(dir)).toBe(true)
  })

  test("follows a data folder outside HOME", () => {
    const roots = { ...machine(), trash: "" }
    roots.trash = join(roots.root, "data", "trash")
    const path = file(join(roots.root, "data", "ops", "builds", "abc"))
    expect(quarantine(path, carved, roots, { carveOuts: TABLE, now: NOW })).toMatchObject({
      files: 1,
    })
    const home = file(join(roots.home, ".playground", "ops", "builds", "abc"))
    expect(quarantine(home, carved, roots, { carveOuts: TABLE, now: NOW })).toMatchObject({
      kind: "protected",
    })
  })

  test("refuses a name no carve-out has, a link out of its folder, and the trash in its folder", () => {
    const roots = machine()
    const path = file(join(roots.home, ".playground", "ops", "builds", "abc"))
    expect(
      quarantine(path, { ...opts, carveOut: "nobody" }, roots, { carveOuts: TABLE, now: NOW }),
    ).toMatchObject({
      kind: "protected",
      refused: expect.stringContaining("no carve-out is named"),
    })
    const link = join(roots.home, ".playground", "ops", "builds", "ssh")
    symlinkSync(join(roots.home, ".ssh"), link)
    expect(quarantine(link, carved, roots, { carveOuts: TABLE, now: NOW })).toMatchObject({
      kind: "protected",
    })
    mkdirSync(roots.trash, { recursive: true })
    expect(
      quarantine(roots.trash, { ...opts, carveOut: "trashy" }, roots, {
        carveOuts: TABLE,
        now: NOW,
      }),
    ).toMatchObject({ kind: "protected" })
    expect(existsSync(join(roots.home, ".ssh", "id_ed25519"))).toBe(true)
    expect(existsSync(roots.trash)).toBe(true)
  })
})

// Every real carve-out: one exact folder in the data folder, a cap within the tripwire's, its own entry let through, and its parent, a sibling and an entry over its cap refused.
describe.each(Object.entries(CARVE_OUTS))("the %s carve-out", (name, carve) => {
  test("names one exact folder in the data folder, beside the trash, under a cap within the tripwire's", () => {
    const parts = carve.folder.split("/")
    expect(parts.every((part) => part && part !== "." && part !== "..")).toBe(true)
    expect(parts[0]).not.toBe("trash")
    expect(carve.files).toBeLessThanOrEqual(LIMITS.files)
    expect(carve.bytes).toBeLessThanOrEqual(LIMITS.bytes)
  })

  test("lets its own entry through and refuses its parent, a sibling and an entry over its cap", () => {
    const roots = machine()
    const folder = join(roots.home, ".playground", carve.folder)
    const own = file(join(folder, "own"))
    const sibling = file(join(folder, "..", "sibling-of-carve-out", "own"))
    const over = join(folder, "over")
    file(join(over, "big"), "x".repeat(Math.min(carve.bytes + 1, 4096)))
    if (carve.bytes >= 4096) for (let i = 0; i <= carve.files; i++) file(join(over, `f${i}`))
    const named = { ...opts, carveOut: name }
    expect(quarantine(own, named, roots, { now: NOW })).toMatchObject({ files: 1 })
    expect(quarantine(join(folder, ".."), named, roots, { now: NOW })).toMatchObject({
      kind: "protected",
    })
    expect(quarantine(sibling, named, roots, { now: NOW })).toMatchObject({ kind: "protected" })
    expect(quarantine(over, { ...named, session: "over-cap" }, roots, { now: NOW })).toMatchObject({
      kind: "tripwire",
    })
  })
})

test("linkPlaces lists each marked scratch folder in a temp folder, and each session's scratchpad with the folders directly in it", () => {
  const roots = machine()
  const tmp = join(roots.root, "tmp")
  mkdirSync(tmp)
  const marked = makeScratch("audit-base-", tmp)
  mkdirSync(join(tmp, "unmarked"))
  const pad = join(roots.root, "claude-501", "-Users-x-playground", "session-1", "scratchpad")
  mkdirSync(join(pad, "canary"), { recursive: true })
  file(join(pad, "notes.md"))
  mkdirSync(join(roots.root, "claude-501", "-Users-x-playground", "session-2"))
  expect(linkPlaces([tmp, tmp], join(roots.root, "claude-501"))).toEqual([
    marked,
    pad,
    join(pad, "canary"),
  ])
  expect(linkPlaces([join(roots.root, "none")], join(roots.root, "none"))).toEqual([])
})

describe("worktreeRefusal", () => {
  test("refuses when the roster cannot be read", () => {
    const { holders, roots, wt } = withWorktree()
    writeFileSync(holders.roster, "{not json")
    expect(worktreeRefusal(wt, roots, holders)).toContain("roster")
    expect(worktreeRefusal(wt, roots, { ...holders, roster: join(roots.root, "none") })).toContain(
      "roster",
    )
  })

  test("refuses a folder outside .claude/worktrees", () => {
    const { holders, roots } = withWorktree()
    expect(worktreeRefusal(join(roots.home, "x"), roots, holders)).toContain(".claude/worktrees")
  })

  // PG-1419: a merged or closed PR frees its worktree from a row naming its branch or that PR's own number, and says so
  test("a freed worktree passes a live row naming it by branch or by the freed PR, and a row by name or by another PR still holds it", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    const rosterOf = (agents: object[]) => writeFileSync(holders.roster, JSON.stringify({ agents }))
    const said: string[] = []
    const freedBy = (number: number, head = git(wt, "rev-parse", "HEAD")) => ({
      ...holders,
      freed: { head, number, state: "MERGED" as const },
      note: (line: string) => void said.push(line.slice(line.indexOf(" is freed"))),
    })
    rosterOf([{ branch: "PG-1-thing", name: "abc123-worker", status: "working" }])
    expect(worktreeRefusal(wt, roots, freedBy(1))).toBeNull()
    rosterOf([{ name: "x9y8z7-reviewer", pr: "https://github.com/o/r/pull/1", status: "working" }])
    expect(worktreeRefusal(wt, roots, freedBy(1))).toBeNull()
    expect(said).toEqual([
      " is freed by #1, which reads MERGED, past abc123-worker's roster row (working)",
      " is freed by #1, which reads MERGED, past x9y8z7-reviewer's roster row (working)",
    ])
    expect(worktreeRefusal(wt, roots, freedBy(2))).toContain("x9y8z7-reviewer")
    rosterOf([{ name: "pg-1", status: "working" }])
    expect(worktreeRefusal(wt, roots, freedBy(1))).toContain("pg-1")
  })

  // PG-1419: commits past the merged PR's head keep the row's hold, named with them, so a discard cannot take unmerged work
  test("a freed PR whose head the worktree has moved past keeps a row naming its branch, its commit named, and a row by name still holds it plainly", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    const freed = { head: git(wt, "rev-parse", "HEAD~1"), number: 1, state: "MERGED" as const }
    const rosterOf = (agents: object[]) => writeFileSync(holders.roster, JSON.stringify({ agents }))
    rosterOf([{ branch: "PG-1-thing", name: "abc123-worker", status: "working" }])
    expect(worktreeRefusal(wt, roots, { ...holders, freed })).toBe(
      `${wt} is held by abc123-worker, which the roster lists as working, and its commits past merged PR #1's head stay: ${git(wt, "rev-parse", "--short", "HEAD")}`,
    )
    rosterOf([{ name: "pg-1", status: "working" }])
    expect(worktreeRefusal(wt, roots, { ...holders, freed })).toBe(
      `${wt} is held by pg-1, which the roster lists as working`,
    )
  })

  test("refuses a worktree a live session holds by branch, by name, or by a process's folder", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    const rosterOf = (agents: object[]) => writeFileSync(holders.roster, JSON.stringify({ agents }))
    rosterOf([{ branch: "PG-1-thing", name: "abc123-worker", status: "working" }])
    expect(worktreeRefusal(wt, roots, holders)).toContain("abc123-worker")
    rosterOf([{ name: "pg-1", status: "working" }])
    expect(worktreeRefusal(wt, roots, holders)).toContain("pg-1")
    rosterOf([
      null,
      { name: "x9y8z7-reviewer", pr: "https://github.com/o/r/pull/1", status: "working" },
    ])
    expect(worktreeRefusal(wt, roots, holders)).toContain("x9y8z7-reviewer")
    rosterOf([{ name: "x9y8z7-reviewer", pr: "https://github.com/o/r/pull/11", status: "working" }])
    expect(worktreeRefusal(wt, roots, holders)).toBeNull()
    // the merging worker of the PR whose checker used the worktree holds it by that PR's number alone, which counts for any other PR
    rosterOf([{ name: "abc123-worker", pr: "https://github.com/o/r/pull/1", status: "working" }])
    const of = (pr: string) => worktreeRefusal(wt, roots, { ...holders, pr })
    expect(of("https://github.com/o/r/pull/1")).toBeNull()
    expect(of("https://github.com/o/r/pull/2")).toContain("abc123-worker")
    rosterOf([
      {
        branch: "PG-1-thing",
        name: "abc123-worker",
        pr: "https://github.com/o/r/pull/1",
        status: "working",
      },
    ])
    expect(of("https://github.com/o/r/pull/1")).toContain("abc123-worker")
    rosterOf([{ branch: "PG-1-thing", name: "abc123-worker", status: "ended" }])
    expect(worktreeRefusal(wt, roots, holders)).toBeNull()
    expect(
      worktreeRefusal(wt, roots, { ...holders, procs: [proc(7, "zsh", join(wt, "packages"))] }),
    ).toContain("pid 7")
    expect(worktreeRefusal(wt, roots, { ...holders, procs: null })).toContain("process")
  })

  test("a live session holds a folder by its name only when the slug after PG-<n>- is that name or starts with it and a dash", () => {
    const { holders, roots } = withWorktree()
    // [folder, branch, live session, held]
    const cases: [string, string, string, boolean][] = [
      ["PG-864-second-dispatcher", "PG-864-second-dispatcher", "dispatcher", false],
      ["PG-5-stops", "PG-5-stops", "ops", false],
      ["PG-6-opsdesk", "PG-6-opsdesk", "ops", false],
      ["PG-12-ops", "PG-12-ops", "ops", true],
      ["PG-13-ops-job", "PG-13-ops-job", "ops", true],
      ["PG-14-misc", "PG-14-ops-fix", "ops", true],
    ]
    const seen = cases.map(([folder, branch, name]) => {
      const at = join(roots.main, ".claude", "worktrees", folder)
      git(roots.main, "worktree", "add", "-q", "-b", branch, at)
      writeFileSync(holders.roster, JSON.stringify({ agents: [{ name, status: "working" }] }))
      const holds = `${at} is held by ${name}, which the roster lists as working`
      return [folder, worktreeRefusal(at, roots, holders) === holds]
    })
    expect(seen).toEqual(cases.map(([folder, , , held]) => [folder, held]))
  })

  test("refuses a worktree a running node_modules clone reads from or copies into, naming the clone, and lets it go once the clone is gone", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    const other = join(roots.main, ".claude", "worktrees", "pg-2")
    const clone = (source: string, destination: string): Clone => ({
      destination,
      pid: 4242,
      source,
      who: "k3m9px-worker",
    })
    expect(worktreeRefusal(wt, roots, { ...holders, clones: () => [clone(wt, other)] })).toBe(
      `${wt} is held by k3m9px-worker's node_modules clone (pid 4242) from ${wt} into ${other}`,
    )
    expect(worktreeRefusal(wt, roots, { ...holders, clones: () => [clone(other, wt)] })).toContain(
      `from ${other} into ${wt}`,
    )
    expect(
      worktreeRefusal(wt, roots, { ...holders, clones: () => [clone(other, roots.main)] }),
    ).toBeNull()
    expect(worktreeRefusal(wt, roots, holders)).toBeNull()
  })

  test("names a holder's pid and command, and an agent-browser daemon's session and the close that frees it", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    const refusal = (...procs: Proc[]) => worktreeRefusal(wt, roots, { ...holders, procs })
    const away = proc(3, "zsh", roots.home)
    expect(refusal(away)).toBeNull()
    expect(refusal(away, proc(41, "bun run dev", join(wt, "api")))).toBe(
      `${wt} is held by pid 41 (bun run dev) working in ${join(wt, "api")}`,
    )
    const long = `/opt/chrome/Google Chrome for Testing --type=renderer ${"--flag ".repeat(30)}`
    expect(refusal(proc(42, long, wt))).toBe(
      `${wt} is held by pid 42 (${long.slice(0, 117)}...) working in ${wt}`,
    )
    const daemon = "/x/node_modules/agent-browser/bin/agent-browser-darwin-arm64"
    const bySocket = proc(43, daemon, wt, ["/h/.agent-browser/verify-1-shots.sock"])
    expect(refusal(proc(42, long, wt), bySocket)).toBe(
      `${wt} is held by pid 43 (${daemon}) working in ${wt}: agent-browser session verify-1-shots, which agent-browser --session verify-1-shots close frees`,
    )
    expect(refusal(proc(44, "agent-browser --session s2 open http://x", wt))).toContain(
      "agent-browser --session s2 close",
    )
    expect(refusal(proc(45, daemon, wt))).toContain(
      "agent-browser session default, which agent-browser --session default close frees",
    )
  })

  test("refuses a worktree another worktree's node_modules links into, naming the link", () => {
    const { holders, roots, wt } = withWorktree()
    mkdirSync(join(wt, "node_modules"))
    const sibling = join(roots.main, ".claude", "worktrees", "pg-2")
    mkdirSync(sibling)
    const link = join(sibling, "node_modules")
    symlinkSync(join(wt, "node_modules"), link)
    expect(worktreeRefusal(wt, roots, holders)).toBe(
      `${wt} is linked into by ${link} -> ${join(wt, "node_modules")}: repoint or remove each link first`,
    )
    expect(worktreeRefusal(wt, roots, { ...holders, discard: true })).toContain("is linked into by")
  })

  test("refuses a worktree a scratch folder's copy links into, one level down its node_modules", () => {
    const { holders, roots, wt } = withWorktree()
    mkdirSync(join(wt, "node_modules", "zod"), { recursive: true })
    const copy = join(roots.root, "scratch", "canary")
    mkdirSync(join(copy, "node_modules"), { recursive: true })
    const link = join(copy, "node_modules", "zod")
    symlinkSync(join(wt, "node_modules", "zod"), link)
    expect(worktreeRefusal(wt, roots, { ...holders, places: () => [copy] })).toBe(
      `${wt} is linked into by ${link} -> ${join(wt, "node_modules", "zod")}: repoint or remove each link first`,
    )
  })

  test("names the first three links and counts the rest", () => {
    const { holders, roots, wt } = withWorktree()
    const copy = join(roots.root, "scratch", "canary")
    mkdirSync(copy, { recursive: true })
    for (const n of [1, 2, 3, 4, 5]) symlinkSync(wt, join(copy, `l${n}`))
    const refusal = worktreeRefusal(wt, roots, { ...holders, places: () => [copy] })
    expect(refusal).toStartWith(`${wt} is linked into by ${join(copy, "l1")} -> ${wt}, `)
    expect(refusal).toEndWith(", and 2 more: repoint or remove each link first")
  })

  test("moves a worktree no link points into: a missing target, another worktree and its own links pass", () => {
    const { holders, roots, wt } = withWorktree()
    writeFileSync(join(roots.main, ".git", "info", "exclude"), "node_modules\n")
    mkdirSync(join(wt, "node_modules"))
    symlinkSync(join(wt, "README.md"), join(wt, "node_modules", "own"))
    const other = join(roots.main, ".claude", "worktrees", "pg-3")
    mkdirSync(join(other, "node_modules"), { recursive: true })
    const sibling = join(roots.main, ".claude", "worktrees", "pg-2")
    mkdirSync(sibling)
    symlinkSync(join(other, "node_modules"), join(sibling, "node_modules"))
    symlinkSync(join(wt, "gone"), join(sibling, "dangling"))
    const copy = join(roots.root, "scratch", "canary")
    mkdirSync(copy, { recursive: true })
    symlinkSync(join(roots.root, "remote.git"), join(copy, "remote"))
    const places = () => [copy, join(roots.root, "missing")]
    expect(worktreeRefusal(wt, roots, { ...holders, places })).toBeNull()
    expect(quarantine(wt, { ...opts, worktree: { ...holders, places } }, roots)).toHaveProperty(
      "id",
    )
  })

  test("quarantine runs the holder check itself, so a held worktree stays", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    writeFileSync(
      holders.roster,
      JSON.stringify({
        agents: [
          { name: "x9y8z7-reviewer", pr: "https://github.com/o/r/pull/1", status: "working" },
        ],
      }),
    )
    expect(quarantine(wt, { ...opts, worktree: holders }, roots, { now: NOW })).toMatchObject({
      refused: expect.stringContaining("x9y8z7-reviewer"),
    })
    expect(existsSync(wt)).toBe(true)
  })

  test("quarantine reads the clones again right before the move, so a clone that starts during the walk keeps the worktree", () => {
    const { holders, roots, wt } = withWorktree()
    git(wt, "push", "-q", "origin", "PG-1-thing")
    const other = join(roots.main, ".claude", "worktrees", "pg-2")
    const running: Clone[] = []
    const late = { ...holders, clones: () => running }
    // the volume check runs after the walk and before the move, so a clone registered there started inside the window
    const dev = () => {
      running.splice(0, running.length, {
        destination: other,
        pid: 4242,
        source: wt,
        who: "k3m9px-worker",
      })
      return 1
    }
    expect(quarantine(wt, { ...opts, worktree: late }, roots, { dev, now: NOW })).toEqual({
      kind: "refused",
      refused: `${wt} is held by k3m9px-worker's node_modules clone (pid 4242) from ${wt} into ${other}`,
    })
    expect(existsSync(wt)).toBe(true)
    const moved = quarantine(wt, { ...opts, worktree: holders }, roots, { dev: () => 1, now: NOW })
    expect("refused" in moved ? moved.refused : "moved").toBe("moved")
    const { files, size } = moved as Quarantined
    expect(files).toBeGreaterThan(1)
    expect(size).toBeGreaterThan(0)
    expect(listTrash(roots.trash).find((e) => e.path === wt)).toMatchObject({ files, size })
  })

  test("refuses a dirty worktree, naming its changes and --discard, and --discard lets it go", () => {
    const { holders, roots, wt } = withWorktree()
    file(join(wt, "wip.txt"))
    expect(worktreeRefusal(wt, roots, holders)).toBe(
      `${wt} holds 1 uncommitted change (wip.txt): playground rm --worktree ${wt} --discard removes it anyway, which a session runs as it is once the worktree's PR has merged or closed, else with --decision <id> once an Inbox delete decision naming it is approved`,
    )
    for (const name of ["new.txt", "b", "c", "d"]) file(join(wt, name), "changed")
    expect(worktreeRefusal(wt, roots, holders)).toBe(
      `${wt} holds 5 uncommitted changes (new.txt, b, c, and 2 more): playground rm --worktree ${wt} --discard removes it anyway, which a session runs as it is once the worktree's PR has merged or closed, else with --decision <id> once an Inbox delete decision naming it is approved`,
    )
    expect(worktreeRefusal(wt, roots, { ...holders, discard: true })).toBeNull()
    const moved = quarantine(wt, { ...opts, worktree: { ...holders, discard: true } }, roots, {
      now: NOW,
    })
    expect(moved).toHaveProperty("id")
    expect(existsSync(wt)).toBe(false)
  })

  test("refuses a worktree whose branch has not landed on canary, pushed or not, and --discard lets it go", () => {
    const { holders, roots, wt } = withWorktree()
    const unmerged = { ...holders, merged: () => false }
    expect(worktreeRefusal(wt, roots, unmerged)).toBe(
      `${wt}'s HEAD holds work not landed on origin/canary (fetch origin canary if it merged since): playground rm --worktree ${wt} --discard removes it anyway, which a session runs as it is once the worktree's PR has merged or closed, else with --decision <id> once an Inbox delete decision naming it is approved`,
    )
    git(wt, "push", "-q", "origin", "PG-1-thing")
    expect(worktreeRefusal(wt, roots, unmerged)).toContain("not landed on origin/canary")
    expect(worktreeRefusal(wt, roots, { ...holders, merged: () => null })).toContain("not landed")
    expect(worktreeRefusal(wt, roots, { ...unmerged, discard: true })).toBeNull()
    expect(quarantine(wt, { ...opts, worktree: unmerged }, roots, { now: NOW })).toHaveProperty(
      "refused",
    )
    expect(existsSync(wt)).toBe(true)
  })

  test("removes a clean worktree whose branch canary squash-merged, and asks for a merged PR once canary changes its files again", () => {
    const { holders, roots, wt } = withWorktree()
    const head = git(wt, "rev-parse", "HEAD")
    const asked: string[] = []
    const merged = (sha: string, at: string) => {
      asked.push(at)
      return sha === head
    }
    const unmerged = { ...holders, merged: () => false }
    file(join(roots.main, "new.txt"))
    git(roots.main, "add", ".")
    git(roots.main, "commit", "-qm", "the squash of PG-1-thing")
    git(roots.main, "push", "-q", "origin", "canary")
    expect(worktreeRefusal(wt, roots, unmerged)).toBeNull()
    file(join(roots.main, "new.txt"), "changed on canary since")
    git(roots.main, "commit", "-qam", "a later change")
    git(roots.main, "push", "-q", "origin", "canary")
    expect(worktreeRefusal(wt, roots, unmerged)).toContain("not landed")
    expect(worktreeRefusal(wt, roots, { ...holders, merged })).toBeNull()
    expect(asked).toEqual([wt])
    const moved = quarantine(wt, { ...opts, worktree: { ...holders, merged } }, roots, { now: NOW })
    expect(moved).toHaveProperty("id")
    expect(existsSync(wt)).toBe(false)
  })

  test("refuses unlanded work in a file whose name git quotes, and names a dirty one as it is", () => {
    const { holders, roots, wt } = withWorktree()
    const unmerged = { ...holders, merged: () => false }
    file(join(roots.main, "new.txt"))
    git(roots.main, "add", ".")
    git(roots.main, "commit", "-qm", "the squash of PG-1-thing")
    git(roots.main, "push", "-q", "origin", "canary")
    expect(worktreeRefusal(wt, roots, unmerged)).toBeNull()
    file(join(wt, "caf\u00e9.txt"))
    expect(worktreeRefusal(wt, roots, unmerged)).toContain("1 uncommitted change (caf\u00e9.txt)")
    git(wt, "add", ".")
    git(wt, "commit", "-qm", "more work")
    expect(worktreeRefusal(wt, roots, unmerged)).toContain("not landed")
  })

  test("removes a review clone detached at a merged PR's head, and a branch with no work of its own", () => {
    const { holders, roots, wt } = withWorktree()
    const unmerged = { ...holders, merged: () => false }
    git(wt, "checkout", "-q", "--detach")
    expect(worktreeRefusal(wt, roots, unmerged)).toContain("not landed")
    file(join(roots.main, "new.txt"))
    git(roots.main, "add", ".")
    git(roots.main, "commit", "-qm", "the squash of PG-1-thing")
    git(roots.main, "push", "-q", "origin", "canary")
    expect(worktreeRefusal(wt, roots, unmerged)).toBeNull()
    const fresh = join(roots.main, ".claude", "worktrees", "pg-2")
    git(roots.main, "worktree", "add", "-q", "-b", "PG-2-next", fresh, "HEAD~1")
    file(join(roots.main, "later.txt"))
    git(roots.main, "add", ".")
    git(roots.main, "commit", "-qm", "canary moves on")
    git(roots.main, "push", "-q", "origin", "canary")
    expect(worktreeRefusal(fresh, roots, unmerged)).toBeNull()
  })
})

describe("removeScratch", () => {
  test("removes a folder makeScratch made in the temp folder", () => {
    const { root } = machine()
    const tmp = join(root, "tmp")
    mkdirSync(tmp)
    const dir = makeScratch("job-", tmp)
    file(join(dir, "deep", "x"))
    expect(existsSync(join(dir, MARKER))).toBe(true)
    expect(removeScratch(dir, tmp)).toBeNull()
    expect(existsSync(dir)).toBe(false)
  })

  test("refuses a folder with no marker, one outside the temp folder, and a symlink", () => {
    const { home, root } = machine()
    const tmp = join(root, "tmp")
    mkdirSync(join(tmp, "plain"), { recursive: true })
    expect(removeScratch(join(tmp, "plain"), tmp)).toContain(MARKER)
    const away = join(home, "away")
    file(join(away, MARKER))
    expect(removeScratch(away, tmp)).toContain("temp folder")
    const made = makeScratch("job-", tmp)
    symlinkSync(made, join(tmp, "link"))
    expect(removeScratch(join(tmp, "link"), tmp)).toBeString()
    expect(existsSync(made)).toBe(true)
  })
})

describe("purgeTrash", () => {
  const DAY = 86_400_000
  const GB = 1e9
  const batchAt = (trash: string, at: Date, session = "s") => {
    const stamp = at.toISOString().replace(/[-:]|\.\d{3}/g, "")
    file(join(trash, `${stamp}-${session}`, "1", "item"))
    return `${stamp}-${session}`
  }

  test("removes batches over 7 days old and keeps the rest while space is plenty", () => {
    const { trash } = machine()
    const old = batchAt(trash, new Date(NOW.getTime() - 8 * DAY))
    const young = batchAt(trash, new Date(NOW.getTime() - 6 * DAY))
    const done = purgeTrash(trash, { free: () => 100 * GB, now: NOW })
    expect(done.removed).toEqual([old])
    expect(existsSync(join(trash, old))).toBe(false)
    expect(existsSync(join(trash, young))).toBe(true)
  })

  test("removes the oldest batches early while free space is under 50 GB", () => {
    const { trash } = machine()
    const first = batchAt(trash, new Date(NOW.getTime() - 3 * DAY))
    const second = batchAt(trash, new Date(NOW.getTime() - 2 * DAY))
    const third = batchAt(trash, new Date(NOW.getTime() - DAY))
    const free = () => (existsSync(join(trash, second)) ? 40 * GB : 60 * GB)
    const done = purgeTrash(trash, { free, now: NOW })
    expect(done.removed).toEqual([first, second])
    expect(existsSync(join(trash, third))).toBe(true)
  })

  test("removes nothing outside the trash: a symlinked batch is skipped", () => {
    const { home, trash } = machine()
    const keep = join(home, "keep")
    file(join(keep, "x"))
    mkdirSync(trash, { recursive: true })
    symlinkSync(keep, join(trash, "20200101T000000Z-s"))
    const done = purgeTrash(trash, { free: () => 100 * GB, now: NOW })
    expect(done.removed).toEqual([])
    expect(done.skipped).toEqual(["20200101T000000Z-s"])
    expect(existsSync(join(keep, "x"))).toBe(true)
  })

  test("a missing trash folder purges nothing", () => {
    const { trash } = machine()
    expect(purgeTrash(trash, { free: () => 0, now: NOW }).removed).toEqual([])
  })

  // the load cap (#1413): free between the floor and 50 GB, so only the cap decides; at or over it nothing goes, and the batches it left come back named
  test("removes no batch at or over the load cap, and names what it left", () => {
    const { trash } = machine()
    const old = batchAt(trash, new Date(NOW.getTime() - 8 * DAY))
    const done = purgeTrash(trash, {
      free: () => 20 * GB,
      load: () => 15,
      loadCap: 15,
      now: NOW,
    })
    expect(done.removed).toEqual([])
    expect(done.leftForLoad).toEqual([old])
    expect(existsSync(join(trash, old))).toBe(true)
  })

  test("stops between batches when the load reaches the cap mid-purge", () => {
    const { trash } = machine()
    const first = batchAt(trash, new Date(NOW.getTime() - 9 * DAY), "a")
    const second = batchAt(trash, new Date(NOW.getTime() - 8 * DAY), "b")
    const third = batchAt(trash, new Date(NOW.getTime() - 8 * DAY), "c")
    let reads = 0
    const load = () => (reads++ < 2 ? 10 : 15)
    const done = purgeTrash(trash, {
      free: () => 20 * GB,
      load,
      loadCap: 15,
      now: NOW,
    })
    expect(done.removed).toEqual([first, second])
    expect(done.leftForLoad).toEqual([third])
    expect(existsSync(join(trash, third))).toBe(true)
  })

  test("removes batches at any load when the disk is under the hard floor", () => {
    const { trash } = machine()
    const old = batchAt(trash, new Date(NOW.getTime() - 8 * DAY))
    const young = batchAt(trash, new Date(NOW.getTime() - 2 * DAY))
    const done = purgeTrash(trash, {
      free: () => 4 * GB,
      load: () => 20,
      loadCap: 15,
      now: NOW,
    })
    expect(done.removed).toEqual([old, young])
    expect(done.leftForLoad).toEqual([])
    expect(existsSync(join(trash, young))).toBe(false)
  })
})
