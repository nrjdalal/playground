import { afterAll, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listTrash } from "../../../../../packages/safe-delete/src"
import {
  RM_USAGE,
  type RmDeps,
  rmArgs,
  runRm,
} from "../../../../../packages/scripts/src/playground/rm"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

// #3083: a made-up HOME whose main checkout is a git repo holding one tracked file, an ignore rule that leaves .claude/ out and its worktrees folder, with a data folder beside it; the caller is session
const machine = (session = "ops") => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rm-stray-")))
  dirs.push(root)
  const home = join(root, "home")
  const main = join(home, "playground")
  const data = join(home, ".playground")
  mkdirSync(join(main, ".claude", "worktrees"), { recursive: true })
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, "roster.json"), JSON.stringify({ agents: [] }))
  writeFileSync(join(main, ".gitignore"), ".env\n")
  writeFileSync(join(main, "README.md"), "x\n")
  git(main, "init", "-q")
  git(main, "add", ".")
  git(main, "commit", "-q", "-m", "init")
  const told: string[] = []
  const deps: RmDeps = {
    clones: () => [],
    data,
    defaultBranch: () => null,
    home,
    liveBranch: () => "live/dashboard",
    main,
    merged: () => false,
    mergedHead: () => null,
    notify: (text) => void told.push(text),
    places: () => [],
    prState: async () => null,
    procs: () => [],
    session: async () => session,
  }
  const trash = () => listTrash(join(data, "trash"))
  const trashed = () => trash().map((entry) => entry.path)
  return { data, deps, main, root, trash, trashed }
}

test("rm --stray takes one path, with an optional reason, and nothing else", () => {
  expect(rmArgs(["--stray", "/m/a", "--reason", "upkeep"])).toEqual({
    discard: false,
    path: "/m/a",
    reason: "upkeep",
    stray: true,
    worktree: false,
  })
  for (const words of [
    ["--stray"],
    ["--stray", "/m/a", "/m/b"],
    ["--stray", "/m/a", "--stray", "/m/b"],
    ["/m/a", "--stray", "/m/b"],
    ["--stray", "/m/a", "--card", "c1"],
    ["--stray", "/m/a", "--discard"],
    ["--worktree", "/m/a", "--stray", "/m/b"],
  ])
    expect(rmArgs(words)).toEqual({ error: RM_USAGE })
})

test("rm --stray moves an untracked file and an empty untracked folder in the main checkout to the trash", async () => {
  const m = machine()
  const file = join(m.main, "a")
  const folder = join(m.main, "scratchpad", "gone-worker")
  writeFileSync(file, "x\n")
  mkdirSync(folder, { recursive: true })
  expect(await runRm(["--stray", file, "--reason", "upkeep"], m.deps)).toBe(0)
  expect(await runRm(["--stray", folder, "--reason", "upkeep"], m.deps)).toBe(0)
  expect(existsSync(file)).toBe(false)
  expect(existsSync(folder)).toBe(false)
  expect(m.trashed()).toEqual(expect.arrayContaining([file, folder]))
})

test.each([
  ["a tracked file", (main: string) => join(main, "README.md")],
  [
    "a folder holding a tracked file",
    (main: string) => {
      mkdirSync(join(main, "docs"))
      writeFileSync(join(main, "docs", "x.md"), "x\n")
      git(main, "add", "docs")
      git(main, "commit", "-q", "-m", "docs")
      writeFileSync(join(main, "docs", "y.md"), "y\n")
      return join(main, "docs")
    },
  ],
  [
    "an ignored file",
    (main: string) => {
      writeFileSync(join(main, ".env"), "SECRET=1\n")
      return join(main, ".env")
    },
  ],
  [
    "a folder holding an ignored file",
    (main: string) => {
      mkdirSync(join(main, "stray"))
      writeFileSync(join(main, "stray", ".env"), "SECRET=1\n")
      return join(main, "stray")
    },
  ],
  [
    "a worktree folder",
    (main: string) => {
      mkdirSync(join(main, ".claude", "worktrees", "wt"))
      return join(main, ".claude", "worktrees", "wt")
    },
  ],
  [
    "the folder holding the worktrees folder",
    (main: string) => {
      mkdirSync(join(main, ".claude", "worktrees", "wt"))
      return join(main, ".claude")
    },
  ],
  [
    "a symlink to a file outside the main checkout",
    (main: string) => {
      writeFileSync(join(main, "..", "target"), "x\n")
      symlinkSync(join(main, "..", "target"), join(main, "link"))
      return join(main, "link")
    },
  ],
  ["the main checkout itself", (main: string) => main],
  ["its git folder", (main: string) => join(main, ".git")],
  [
    "a path outside it",
    (main: string) => {
      writeFileSync(join(main, "..", "outside"), "x\n")
      return join(main, "..", "outside")
    },
  ],
  [
    "a path written relative",
    (main: string) => {
      writeFileSync(join(main, "a"), "x\n")
      return "a"
    },
  ],
])("rm --stray refuses %s", async (_, plant) => {
  const m = machine()
  const path = plant(m.main)
  expect(await runRm(["--stray", path], m.deps)).toBe(1)
  expect(existsSync(path.startsWith("/") ? path : join(m.main, path))).toBe(true)
  expect(m.trashed()).toEqual([])
})

test("rm --restore brings a path rm --stray moved back to its place", async () => {
  const m = machine()
  const file = join(m.main, "a")
  writeFileSync(file, "x\n")
  expect(await runRm(["--stray", file, "--reason", "upkeep"], m.deps)).toBe(0)
  const [item] = m.trash()
  expect(await runRm(["--restore", item!.id], m.deps)).toBe(0)
  expect(await Bun.file(file).text()).toBe("x\n")
  expect(m.trash()).toEqual([])
})

test("rm --restore of a path rm --stray moved refuses every caller but ops", async () => {
  const m = machine()
  const file = join(m.main, "a")
  writeFileSync(file, "x\n")
  expect(await runRm(["--stray", file, "--reason", "upkeep"], m.deps)).toBe(0)
  const [item] = m.trash()
  const worker = { ...m.deps, session: async () => "j6rjgy-worker" }
  expect(await runRm(["--restore", item!.id], worker)).toBe(1)
  expect(existsSync(file)).toBe(false)
  expect(m.trash().map((entry) => entry.id)).toEqual([item!.id])
})

test("rm --stray refuses every caller but ops", async () => {
  const m = machine("j6rjgy-worker")
  const file = join(m.main, "a")
  writeFileSync(file, "x\n")
  expect(await runRm(["--stray", file], m.deps)).toBe(1)
  expect(existsSync(file)).toBe(true)
})

test("plain rm still refuses an untracked stray in the main checkout, for ops too", async () => {
  const m = machine()
  const file = join(m.main, "a")
  writeFileSync(file, "x\n")
  expect(await runRm([file], m.deps)).toBe(1)
  expect(existsSync(file)).toBe(true)
})
