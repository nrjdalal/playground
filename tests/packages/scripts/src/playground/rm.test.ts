import { afterAll, expect, test } from "bun:test"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { CARVE_OUTS, listTrash } from "../../../../../packages/safe-delete/src"
import {
  clonesOf,
  processesOf,
  RM_USAGE,
  type PrState,
  prStateOf,
  type RmDeps,
  rmArgs,
  rmDeps,
  runRm,
} from "../../../../../packages/scripts/src/playground/rm"

test("rm takes one path, or --worktree's with an optional --discard and --pr, with an optional reason", () => {
  expect(rmArgs(["old"])).toEqual({
    discard: false,
    path: "old",
    reason: "playground rm",
    worktree: false,
  })
  expect(rmArgs(["--worktree", "wt", "--reason", "merged"])).toEqual({
    discard: false,
    path: "wt",
    reason: "merged",
    worktree: true,
  })
  expect(rmArgs(["--worktree", "wt", "--discard"])).toEqual({
    discard: true,
    path: "wt",
    reason: "playground rm",
    worktree: true,
  })
  expect(rmArgs(["--worktree", "wt", "--pr", "https://github.com/o/r/pull/1"])).toEqual({
    discard: false,
    path: "wt",
    pr: "https://github.com/o/r/pull/1",
    reason: "playground rm",
    worktree: true,
  })
})

test("rm takes --list or --restore <id> alone", () => {
  expect(rmArgs(["--list"])).toEqual({ list: true })
  expect(rmArgs(["--restore", "20261102T120000Z-s/1"])).toEqual({ restore: "20261102T120000Z-s/1" })
})

test.each([
  [[]],
  [["a", "b"]],
  [["--worktree"]],
  [["--force", "a"]],
  [["--list", "a"]],
  [["a", "--worktree", "b"]],
  [["a", "--discard"]],
  [["--worktree", "wt", "--discard", "--discard"]],
  [["--worktree", "wt", "--decision", "#i9"]],
  [["--worktree", "wt", "--discard", "--decision"]],
  [["--worktree", "wt", "--discard", "--decision", "#i9"]],
  [["a", "--pr", "https://github.com/o/r/pull/1"]],
  [["--worktree", "wt", "--pr"]],
])("rm refuses %j with its usage", (words) => {
  expect(rmArgs(words)).toEqual({ error: RM_USAGE })
})

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString().trim()
}

const file = (path: string, text = "x"): void => {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text)
}

// A mkdtemp machine: HOME with its main checkout and data folder, and deps that record each notify line.
const machine = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rm-")))
  dirs.push(root)
  const home = join(root, "home")
  const main = join(home, "playground")
  const data = join(home, ".playground")
  mkdirSync(join(main, ".claude", "worktrees"), { recursive: true })
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, "roster.json"), JSON.stringify({ agents: [] }))
  const told: string[] = []
  const deps: RmDeps = {
    clones: () => [],
    procs: () => [],
    data,
    home,
    main,
    merged: () => false,
    notify: (text) => void told.push(text),
    places: () => [],
    prState: async () => null,
    session: async () => "j6rjgy-worker",
  }
  return { deps, home, main, root, told }
}

test("runRm moves a path, lists it and restores it, telling no one", async () => {
  const { deps, home, told } = machine()
  const path = join(home, "old.txt")
  writeFileSync(path, "x")
  expect(await runRm([path], deps)).toBe(0)
  expect(existsSync(path)).toBe(false)
  expect(await runRm(["--list"], deps)).toBe(0)
  const [batch] = readdirSync(join(deps.data, "trash"))
  expect(await runRm(["--restore", `${batch}/1`], deps)).toBe(0)
  expect(existsSync(path)).toBe(true)
  expect(told).toEqual([])
})

test("rm of a tree leaves its node_modules and web/next/.next out of the trash, keeps every other file, and the move and restore lines name the install", async () => {
  const { deps, home } = machine()
  const tree = join(home, "review-clone")
  file(join(tree, "node_modules", "left-pad", "index.js"))
  file(join(tree, "packages", "web", "node_modules", "react", "index.js"))
  file(join(tree, "web", "next", ".next", "build-manifest.json"))
  file(join(tree, "web", "next", ".next-cache", "y.js"))
  file(join(tree, "src", "index.ts"))
  const log = console.log
  const said: string[] = []
  console.log = (line: string) => void said.push(line)
  const code = await runRm([tree, "--reason", "scratch"], deps)
  expect(code).toBe(0)
  const trash = join(deps.data, "trash")
  const [batch] = readdirSync(trash)
  const item = join(trash, batch, "1", "review-clone")
  expect(existsSync(join(item, "node_modules"))).toBe(false)
  expect(existsSync(join(item, "packages", "web", "node_modules"))).toBe(false)
  expect(existsSync(join(item, "web", "next", ".next"))).toBe(false)
  expect(existsSync(join(item, "web", "next", ".next-cache", "y.js"))).toBe(true)
  expect(existsSync(join(item, "src", "index.ts"))).toBe(true)
  expect(said.join("\n")).toContain("bun install")
  expect(await runRm(["--restore", `${batch}/1`], deps)).toBe(0)
  console.log = log
  expect(existsSync(join(tree, "src", "index.ts"))).toBe(true)
  expect(existsSync(join(tree, "node_modules"))).toBe(false)
  expect(said.join("\n")).toContain("bun install")
})

test("a strip that stops partway still moves the tree, and the move line names it", async () => {
  const { deps, home } = machine()
  const tree = join(home, "review-clone")
  file(join(tree, "node_modules", "locked", "child.js"))
  file(join(tree, "node_modules", "ok", "child.js"))
  file(join(tree, "src", "index.ts"))
  chmodSync(join(tree, "node_modules", "locked"), 0o555)
  const log = console.log
  const said: string[] = []
  console.log = (line: string) => void said.push(line)
  expect(await runRm([tree, "--reason", "scratch"], deps)).toBe(0)
  console.log = log
  expect(said.join("\n")).toContain("the strip stopped")
  const trash = join(deps.data, "trash")
  const [batch] = readdirSync(trash)
  expect(existsSync(join(trash, batch, "1", "review-clone", "src", "index.ts"))).toBe(true)
  chmodSync(join(trash, batch, "1", "review-clone", "node_modules", "locked"), 0o755)
})

test("the restore of a batch the strip took rebuildables from names the install", async () => {
  const { deps, home } = machine()
  const trash = join(deps.data, "trash")
  const batch = "20261101T120000Z-xssrgq"
  file(join(trash, batch, "1", "review-clone", "node_modules", "left-pad", "index.js"))
  file(join(trash, batch, "1", "review-clone", "src", "index.ts"))
  writeFileSync(
    join(trash, batch, "manifest.jsonl"),
    `${JSON.stringify({
      at: "2026-11-01T12:00:00.000Z",
      files: 2,
      id: `${batch}/1`,
      path: join(home, "review-clone"),
      reason: "playground rm",
      session: "xssrgq",
      size: 20,
      stripped: 1,
    })}\n`,
  )
  const log = console.log
  const said: string[] = []
  console.log = (line: string) => void said.push(line)
  expect(await runRm(["--restore", `${batch}/1`], deps)).toBe(0)
  console.log = log
  expect(existsSync(join(home, "review-clone", "src", "index.ts"))).toBe(true)
  expect(said.join("\n")).toContain("bun install")
})

test("runRm tells the dispatcher once when a session hits the per-minute cap, however many tries it refuses", async () => {
  const { deps, home, told } = machine()
  const paths = Array.from({ length: 14 }, (_, i) => {
    const path = join(home, `old-${i}.txt`)
    writeFileSync(path, "x")
    return path
  })
  const codes: number[] = []
  for (const path of paths) codes.push(await runRm([path], deps))
  expect(codes).toEqual([0, 0, 0, ...Array(11).fill(1)])
  expect(told).toEqual([
    "j6rjgy-worker: j6rjgy-worker quarantined 3 paths in the last minute, the most one session may",
  ])
})

test("runRm clears the caller's own scratch folder", async () => {
  const { deps, home } = machine()
  const scratch = join(home, ".playground", "scratch", "j6rjgy-worker")
  mkdirSync(join(scratch, "tmp"), { recursive: true })
  writeFileSync(join(scratch, "tmp", "work.txt"), "x")
  expect(await runRm([scratch], deps)).toBe(0)
  expect(existsSync(scratch)).toBe(false)
})

test("runRm refuses another session's scratch folder", async () => {
  const { deps, home } = machine()
  const other = join(home, ".playground", "scratch", "a4b5c6-worker")
  mkdirSync(other, { recursive: true })
  expect(await runRm([other], deps)).toBe(1)
  expect(existsSync(other)).toBe(true)
})

test("runRm refuses a .. escape out of the caller's own scratch folder", async () => {
  const { deps, home } = machine()
  const scratch = join(home, ".playground", "scratch", "j6rjgy-worker")
  const other = join(home, ".playground", "scratch", "a4b5c6-worker")
  mkdirSync(other, { recursive: true })
  expect(await runRm([`${scratch}/../a4b5c6-worker`], deps)).toBe(1)
  expect(existsSync(other)).toBe(true)
})

test("runRm refuses a symlink inside the caller's own scratch folder that points out of it", async () => {
  const { deps, home } = machine()
  const scratch = join(home, ".playground", "scratch", "j6rjgy-worker")
  mkdirSync(join(home, ".ssh"), { recursive: true })
  mkdirSync(scratch, { recursive: true })
  symlinkSync(join(home, ".ssh"), join(scratch, "keys"))
  expect(await runRm([join(scratch, "keys")], deps)).toBe(1)
  expect(existsSync(join(scratch, "keys"))).toBe(true)
})

// The machine's scratchpad, with a roster of the given rows.
const pads = (rows: { name: string; status: string }[]) => {
  const m = machine()
  writeFileSync(join(m.deps.data, "roster.json"), JSON.stringify({ agents: rows }))
  return { ...m, pad: join(m.deps.data, "scratchpad") }
}

test("runRm clears a path in the caller's own scratchpad folder", async () => {
  const { deps, pad } = pads([{ name: "j6rjgy-worker", status: "working" }])
  mkdirSync(join(pad, "j6rjgy-worker", "1929"), { recursive: true })
  writeFileSync(join(pad, "j6rjgy-worker", "1929", "probe.log"), "x")
  expect(await runRm([join(pad, "j6rjgy-worker", "1929")], deps)).toBe(0)
  expect(existsSync(join(pad, "j6rjgy-worker", "1929"))).toBe(false)
  expect(existsSync(join(pad, "j6rjgy-worker"))).toBe(true)
})

test("runRm clears the whole scratchpad folder of a session the roster lists as finished, or lists not at all, and --restore brings it back", async () => {
  const { deps, pad } = pads([
    { name: "a4b5c6-reviewer", status: "ended" },
    { name: "d7e8f9-runner", status: "parked" },
  ])
  for (const name of ["a4b5c6-reviewer", "d7e8f9-runner", "q1w2e3"]) {
    mkdirSync(join(pad, name, "shots"), { recursive: true })
    writeFileSync(join(pad, name, "shots", "a.png"), "x")
    expect(await runRm([join(pad, name)], deps)).toBe(0)
    expect(existsSync(join(pad, name))).toBe(false)
  }
  expect(existsSync(pad)).toBe(true)
  const moved = listTrash(join(deps.data, "trash")).find(
    (entry) => entry.path === join(pad, "q1w2e3"),
  )!
  expect(await runRm(["--restore", moved.id], deps)).toBe(0)
  expect(existsSync(join(pad, "q1w2e3", "shots", "a.png"))).toBe(true)
})

test("runRm refuses a live session's scratchpad folder, every path in it, and its bare id's folder while any of that id's rows is live, to any other session", async () => {
  const { deps, pad, told } = pads([
    { name: "j6rjgy-worker", status: "working" },
    { name: "a4b5c6-reviewer", status: "waiting" },
    { name: "h1j2k3-tester", status: "starting" },
    { name: "p4q5r6-worker", status: "ended" },
    { name: "p4q5r6-reviewer", status: "working" },
  ])
  for (const path of [
    join(pad, "a4b5c6-reviewer"),
    join(pad, "a4b5c6-reviewer", "r1.md"),
    join(pad, "h1j2k3-tester"),
    join(pad, "h1j2k3"),
    join(pad, "p4q5r6"),
  ]) {
    mkdirSync(join(pad, "a4b5c6-reviewer"), { recursive: true })
    mkdirSync(join(pad, "h1j2k3-tester"), { recursive: true })
    mkdirSync(join(pad, "h1j2k3"), { recursive: true })
    mkdirSync(join(pad, "p4q5r6"), { recursive: true })
    writeFileSync(join(pad, "a4b5c6-reviewer", "r1.md"), "x")
    expect(await runRm([path], deps)).toBe(1)
    expect(existsSync(path)).toBe(true)
  }
  expect(told.every((line) => line.includes("is inside the protected"))).toBe(true)
})

// A folder of one file more than the tripwire's count, spread over subfolders.
const overCount = (dir: string) => {
  for (let i = 0; i <= 5000; i++) {
    const sub = join(dir, "clone", String(i % 50))
    if (i < 50) mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, String(i)), "x")
  }
}

test("runRm clears an ended session's whole scratchpad folder over the tripwire's file count, and --restore brings back every file", async () => {
  const { deps, pad } = pads([{ name: "a4b5c6-worker", status: "ended" }])
  const folder = join(pad, "a4b5c6-worker")
  overCount(folder)
  expect(await runRm([folder], deps)).toBe(0)
  expect(existsSync(folder)).toBe(false)
  const moved = listTrash(join(deps.data, "trash")).find((entry) => entry.path === folder)!
  expect(moved.files).toBe(5001)
  expect(await runRm(["--restore", moved.id], deps)).toBe(0)
  expect(
    readdirSync(folder, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()),
  ).toHaveLength(5001)
})

// the file count does not apply to an ended session's whole folder, so its refusal names the byte cap alone
test("runRm refuses an ended session's whole scratchpad folder over 2 GB, naming the 2 GB cap alone", async () => {
  const { deps, pad, told } = pads([{ name: "a4b5c6-worker", status: "ended" }])
  const folder = join(pad, "a4b5c6-worker")
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "big.bin"), "")
  truncateSync(join(folder, "big.bin"), 2 * 1024 ** 3 + 1)
  expect(await runRm([folder], deps)).toBe(1)
  expect(existsSync(join(folder, "big.bin"))).toBe(true)
  expect(told.filter((line) => line.includes("past the tripwire"))).toEqual([
    expect.stringContaining(" holds over 2 GB, past the tripwire"),
  ])
})

test("runRm keeps the tripwire's file count for the caller's own scratchpad folder, a path inside an ended folder and any other path", async () => {
  for (const at of [
    (pad: string) => join(pad, "j6rjgy-worker"),
    (pad: string) => join(pad, "a4b5c6-worker", "1938"),
    (pad: string) => join(pad, "..", "..", "big"),
  ]) {
    const { deps, pad, told } = pads([
      { name: "j6rjgy-worker", status: "working" },
      { name: "a4b5c6-worker", status: "ended" },
    ])
    const path = at(pad)
    overCount(path)
    expect(await runRm([path], deps)).toBe(1)
    expect(existsSync(join(path, "clone", "0", "0"))).toBe(true)
    expect(told.some((line) => line.includes("past the tripwire"))).toBe(true)
  }
})

test("--restore refuses a path inside an ended folder while a symlink stands at that folder or at a folder between", async () => {
  const { deps, home, pad } = pads([])
  mkdirSync(join(home, "kept"), { recursive: true })
  for (const [moved, link] of [
    [join(pad, "q1w2e3", "shots"), join(pad, "q1w2e3")],
    [join(pad, "z9x8c7", "a", "shots"), join(pad, "z9x8c7", "a")],
  ] as const) {
    mkdirSync(moved, { recursive: true })
    writeFileSync(join(moved, "a.png"), "x")
    expect(await runRm([moved], deps)).toBe(0)
    const entry = listTrash(join(deps.data, "trash")).find((e) => e.path === moved)!
    rmSync(link, { recursive: true })
    symlinkSync(join(home, "kept"), link)
    expect(await runRm(["--restore", entry.id], deps)).toBe(1)
    expect(existsSync(join(home, "kept", "shots"))).toBe(false)
  }
})

test("runRm refuses the scratchpad folder itself, every other path in the data folder, an ended session's folder that is a symlink, and any of them while the roster cannot be read", async () => {
  const { deps, home, pad } = pads([{ name: "a4b5c6-reviewer", status: "ended" }])
  mkdirSync(join(pad, "a4b5c6-reviewer"), { recursive: true })
  mkdirSync(join(deps.data, "briefs"), { recursive: true })
  mkdirSync(join(home, "kept"), { recursive: true })
  symlinkSync(join(deps.data, "briefs"), join(pad, "x9y8z7-worker"))
  symlinkSync(join(home, "kept"), join(pad, "m5n6b7-worker"))
  for (const path of [
    pad,
    join(deps.data, "roster.json"),
    join(deps.data, "briefs"),
    join(pad, "x9y8z7-worker"),
    join(pad, "m5n6b7-worker"),
  ]) {
    expect(await runRm([path], deps)).toBe(1)
    expect(existsSync(path)).toBe(true)
  }
  writeFileSync(join(deps.data, "roster.json"), "{")
  expect(await runRm([join(pad, "a4b5c6-reviewer")], deps)).toBe(1)
  expect(existsSync(join(pad, "a4b5c6-reviewer"))).toBe(true)
})

test("runRm tells the dispatcher of a protected path, and not of a missing one", async () => {
  const { deps, home, told } = machine()
  expect(await runRm([home], deps)).toBe(1)
  expect(told).toEqual([`j6rjgy-worker: ${home} is protected`])
  expect(await runRm([join(home, "gone")], deps)).toBe(1)
  expect(told.length).toBe(1)
  expect(await runRm(["a", "b"], deps)).toBe(2)
})

// A carve-out is its own script's alone: playground rm names none, so an entry in each carve-out's folder stays protected and nothing moves.
test.each(Object.entries(CARVE_OUTS))(
  "runRm takes no carve-out: an entry in %s's folder stays protected",
  async (_, carve) => {
    const { deps, told } = machine()
    const entry = join(deps.data, carve.folder, "entry")
    mkdirSync(entry, { recursive: true })
    expect(await runRm([entry], deps)).toBe(1)
    expect(existsSync(entry)).toBe(true)
    expect(told).toEqual([`j6rjgy-worker: ${entry} is inside the protected ${deps.data}`])
  },
)

test("runRm --worktree checks the holders, moves the worktree and prunes it from git", async () => {
  const { deps, main, root } = machine()
  git(root, "init", "--bare", "-q", join(root, "remote.git"))
  git(main, "init", "-q", "-b", "canary")
  writeFileSync(join(main, "README.md"), "x")
  git(main, "add", ".")
  git(main, "commit", "-qm", "init")
  git(main, "remote", "add", "origin", join(root, "remote.git"))
  git(main, "push", "-q", "origin", "canary")
  const wt = join(main, ".claude", "worktrees", "pg-1")
  git(main, "worktree", "add", "-q", "-b", "PG-1-thing", wt)
  git(wt, "push", "-q", "origin", "PG-1-thing")
  const held = { command: "zsh", cwd: wt, pid: 7, sockets: [] }
  expect(await runRm(["--worktree", wt], { ...deps, procs: () => [held] })).toBe(1)
  expect(existsSync(wt)).toBe(true)
  const url = "https://github.com/o/r/pull/1"
  const merging = { name: "abc123-worker", pr: url, status: "working" }
  writeFileSync(join(deps.data, "roster.json"), JSON.stringify({ agents: [merging] }))
  expect(await runRm(["--worktree", wt], deps)).toBe(1)
  expect(await runRm(["--worktree", wt, "--pr", `${url}0`], deps)).toBe(1)
  expect(existsSync(wt)).toBe(true)
  expect(await runRm(["--worktree", wt, "--pr", url], deps)).toBe(0)
  expect(existsSync(wt)).toBe(false)
  expect(git(main, "worktree", "list")).not.toContain("pg-1")
})

// #1348: --discard needs no decision, and keeps the commits no remote holds in a bundle in the trash first
test("runRm --worktree refuses a worktree with uncommitted work, naming --discard, which passes with no decision, keeping its commit no remote holds in a bundle that brings it back", async () => {
  const { deps, main, root } = machine()
  git(root, "init", "--bare", "-q", join(root, "remote.git"))
  git(main, "init", "-q", "-b", "canary")
  writeFileSync(join(main, "README.md"), "x")
  git(main, "add", ".")
  git(main, "commit", "-qm", "init")
  git(main, "remote", "add", "origin", join(root, "remote.git"))
  git(main, "push", "-q", "origin", "canary")
  const wt = join(main, ".claude", "worktrees", "pg-1")
  git(main, "worktree", "add", "-q", "-b", "PG-1-thing", wt)
  writeFileSync(join(wt, "done.txt"), "x")
  git(wt, "add", ".")
  git(wt, "commit", "-qm", "work no remote holds")
  const head = git(wt, "rev-parse", "HEAD")
  writeFileSync(join(wt, "wip.txt"), "x")
  const said: string[] = []
  const [error, log] = [console.error, console.log]
  console.error = (line: string) => void said.push(line)
  console.log = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--worktree", wt], deps)).toBe(1)
    expect(said).toEqual([
      `playground: ${wt} holds 1 uncommitted change (wip.txt): playground rm --worktree ${wt} --discard removes it anyway, its commits no remote holds kept first in a git bundle beside it in the trash`,
    ])
    expect(existsSync(wt)).toBe(true)
    said.length = 0
    expect(await runRm(["--worktree", wt, "--discard"], deps)).toBe(0)
  } finally {
    console.error = error
    console.log = log
  }
  expect(existsSync(wt)).toBe(false)
  const [entry] = listTrash(join(deps.data, "trash"))
  const bundle = entry!.bundle!
  expect(bundle).toBe(
    join(dirname(realpathSync(join(deps.data, "trash", entry!.id))), "pg-1.bundle"),
  )
  expect(said.at(-1)).toContain(
    `; its commits no remote holds are kept in ${bundle}, which git -C ${main} fetch ${bundle} HEAD brings back`,
  )
  expect(readFileSync(join(dirname(bundle), "pg-1.shas"), "utf8")).toBe(`${head} HEAD\n`)
  git(main, "worktree", "prune")
  git(main, "branch", "-D", "PG-1-thing")
  git(main, "fetch", "-q", bundle, "HEAD:refs/heads/PG-1-thing")
  expect(git(main, "rev-parse", "PG-1-thing")).toBe(head)
})

// A main checkout on canary with worktree pg-1 holding one uncommitted file.
const dirtyWorktree = (main: string) => {
  git(main, "init", "-q", "-b", "canary")
  writeFileSync(join(main, "README.md"), "x")
  git(main, "add", ".")
  git(main, "commit", "-qm", "init")
  const wt = join(main, ".claude", "worktrees", "pg-1")
  git(main, "worktree", "add", "-q", "-b", "PG-1-thing", wt)
  writeFileSync(join(wt, "wip.txt"), "x")
  return { wt }
}

// runRm's exit and what it printed to stderr.
const discardBy = async (wt: string, deps: RmDeps) => {
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    return { code: await runRm(["--worktree", wt, "--discard"], deps), said }
  } finally {
    console.error = error
  }
}

// A session's --discard with the worktree's PR state stubbed, and each (path, pr) it was asked for.
const statedSession = (deps: RmDeps, state: PrState | null) => {
  const asked: [string, string | undefined][] = []
  const session: RmDeps = {
    ...deps,
    prState: async (path, pr) => (
      asked.push([path, pr]),
      state === null ? null : { head: git(path, "rev-parse", "HEAD"), number: 1, state }
    ),
  }
  return { asked, session }
}

// PG-1165: a merged or closed PR's worktree goes to the trash with no Inbox delete decision
test("a session's --discard passes with no --decision on a worktree whose PR merged or closed", async () => {
  for (const state of ["MERGED", "CLOSED"] as const) {
    const { deps, main } = machine()
    const { wt } = dirtyWorktree(main)
    const { asked, session } = statedSession(deps, state)
    expect(await discardBy(wt, session)).toEqual({ code: 0, said: [] })
    expect(existsSync(wt)).toBe(false)
    expect(asked).toEqual([[wt, undefined]])
  }
  const { deps, main } = machine()
  const { wt } = dirtyWorktree(main)
  const { asked, session } = statedSession(deps, "MERGED")
  const url = "https://github.com/o/r/pull/1"
  expect(await runRm(["--worktree", wt, "--discard", "--pr", url], session)).toBe(0)
  expect(asked).toEqual([[wt, url]])
})

// #1348: an open or missing PR's worktree goes with no decision too, its work kept in the trash
test("a session's --discard on an OPEN PR's worktree, or one whose PR state reads as none (no PR, or GitHub unreadable), passes with no decision", async () => {
  for (const state of ["OPEN", null] as const) {
    const { deps, main } = machine()
    const { wt } = dirtyWorktree(main)
    const { asked, session } = statedSession(deps, state)
    expect(await discardBy(wt, session)).toEqual({ code: 0, said: [] })
    expect(asked).toEqual([[wt, undefined]])
    expect(existsSync(wt)).toBe(false)
  }
})

// runRm's exit and each line it printed, with the worktree's PR stubbed as #<number> in that state at <head> (its own HEAD unless given; none for null), and a live roster row given
const heldRun = async (
  deps: RmDeps,
  words: string[],
  state: PrState | null,
  row: Record<string, string>,
  number = 1,
  head = git(words[1]!, "rev-parse", "HEAD"),
) => {
  writeFileSync(join(deps.data, "roster.json"), JSON.stringify({ agents: [row] }))
  const prState = async () => (state === null ? null : { head, number, state })
  const out: string[] = []
  const [error, log] = [console.error, console.log]
  console.error = (line: string) => void out.push(line)
  console.log = (line: string) => void out.push(line)
  try {
    const session = { ...deps, prState }
    return { code: await runRm(words, session), out }
  } finally {
    console.error = error
    console.log = log
  }
}

// PG-1419: a working row that kept a finished PR's branch no longer holds that PR's worktree
test("a worktree whose PR merged or closed passes a working roster row naming its branch, and says which PR freed it", async () => {
  for (const state of ["MERGED", "CLOSED"] as const) {
    const { deps, main } = machine()
    const { wt } = dirtyWorktree(main)
    const row = { branch: "PG-1-thing", name: "abc123-worker", status: "working" }
    const words = ["--worktree", wt, "--discard"]
    const { code, out } = await heldRun(deps, words, state, row, 7)
    expect({ code, said: out[0] }).toEqual({
      code: 0,
      said: `playground: ${wt} is freed by #7, which reads ${state}, past abc123-worker's roster row (working)`,
    })
    expect(existsSync(wt)).toBe(false)
  }
})

// PG-1419: the freed removal goes through the 7-day trash like any other, and --restore brings the worktree back, the work --discard let go with it
test("a freed worktree's removal is restorable: --restore brings it back on its branch, at its commit, listed, its discarded work back as untracked", async () => {
  const { deps, main } = machine()
  const { wt } = dirtyWorktree(main)
  const sha = git(wt, "rev-parse", "HEAD")
  const row = { branch: "PG-1-thing", name: "abc123-worker", status: "working" }
  const words = ["--worktree", wt, "--discard"]
  const { out } = await heldRun(deps, words, "MERGED", row, 7)
  const [batch] = readdirSync(join(deps.data, "trash"))
  const id = `${batch}/1`
  expect(out[1]).toContain(`playground rm --restore ${id} brings it back`)
  expect(await runRm(["--restore", id], deps)).toBe(0)
  expect(gitSees(main, wt)).toEqual({
    branch: "PG-1-thing",
    head: sha,
    listed: true,
    status: "?? wip.txt",
  })
})

// PG-1419: commits past the merged PR's head keep the row's hold, so --discard cannot take unmerged work, and the run names them
test("a worktree with a commit past its merged PR's head stays held by a working row naming its branch, its commit named", async () => {
  const { deps, main } = machine()
  const { wt } = dirtyWorktree(main)
  writeFileSync(join(wt, "more.txt"), "x")
  git(wt, "add", ".")
  git(wt, "commit", "-qm", "more")
  const past = git(wt, "rev-parse", "HEAD~1")
  const row = { branch: "PG-1-thing", name: "abc123-worker", status: "working" }
  const words = ["--worktree", wt, "--discard"]
  const { code, out } = await heldRun(deps, words, "MERGED", row, 7, past)
  expect({ code, said: out[0] }).toEqual({
    code: 1,
    said: `playground: ${wt} is held by abc123-worker, which the roster lists as working, and its commits past merged PR #7's head stay: ${git(wt, "rev-parse", "--short", "HEAD")}`,
  })
  expect(existsSync(wt)).toBe(true)
})

test("a working roster row naming the branch still holds a worktree whose PR is open or reads as none (no PR, or GitHub unreadable)", async () => {
  for (const state of ["OPEN", null] as const) {
    const { deps, main } = machine()
    const { wt } = dirtyWorktree(main)
    const row = { branch: "PG-1-thing", name: "abc123-worker", status: "working" }
    const words = ["--worktree", wt, "--discard"]
    expect(await heldRun(deps, words, state, row)).toEqual({
      code: 1,
      out: [`playground: ${wt} is held by abc123-worker, which the roster lists as working`],
    })
    expect(existsSync(wt)).toBe(true)
  }
})

test("a review clone at a merged PR's head stays held by a live row that names it by another PR, its next one, which is open", async () => {
  const { deps, main } = machine()
  dirtyWorktree(main)
  const clone = join(main, ".claude", "worktrees", "review-8")
  git(main, "worktree", "add", "-q", "--detach", clone)
  const row = { name: "abc123-reviewer", pr: "https://github.com/o/r/pull/8", status: "working" }
  const words = ["--worktree", clone, "--discard", "--pr", "https://github.com/o/r/pull/7"]
  expect(await heldRun(deps, words, "MERGED", row, 7)).toEqual({
    code: 1,
    out: [`playground: ${clone} is held by abc123-reviewer, which the roster lists as working`],
  })
  expect(existsSync(clone)).toBe(true)
})

test("a worktree's PR state counts only when exactly one PR answers, as a branch used twice finds two, that PR is the worktree's own by branch or head, and its head is HEAD or an ancestor of it", () => {
  const holds = (sha: string) => sha === "head" || sha === "older"
  const at = { branch: "PG-1-thing", head: "head" }
  const pr = (headRefOid: string, state: PrState, headRefName = "PG-1-thing") => ({
    headRefName,
    headRefOid,
    number: 1,
    state,
  })
  expect(prStateOf([pr("head", "MERGED")], at, holds)).toEqual({
    head: "head",
    number: 1,
    state: "MERGED",
  })
  expect(prStateOf([pr("older", "CLOSED")], at, holds)).toEqual({
    head: "older",
    number: 1,
    state: "CLOSED",
  })
  expect(prStateOf([pr("other", "MERGED")], at, holds)).toBeNull()
  expect(prStateOf([pr("head", "MERGED"), pr("older", "OPEN")], at, holds)).toBeNull()
  // #1962: gh's clean answer of no PR reads as none, apart from a read gh could not make
  expect(prStateOf([], at, holds)).toBe("none")
  expect(prStateOf(null, at, holds)).toBeNull()
  // a stacked child: its parent's PR is another branch's, whose head is only an ancestor of HEAD
  expect(prStateOf([pr("older", "MERGED", "PG-0-parent")], at, holds)).toBeNull()
  // a review clone on its own review-<n> branch, or detached, counts by the exact head alone
  expect(prStateOf([pr("head", "MERGED", "PG-0-parent")], at, holds)).toEqual({
    head: "head",
    number: 1,
    state: "MERGED",
  })
  const detached = { branch: null, head: "head" }
  expect(prStateOf([pr("head", "MERGED")], detached, holds)).toEqual({
    head: "head",
    number: 1,
    state: "MERGED",
  })
  expect(prStateOf([pr("older", "MERGED")], detached, holds)).toBeNull()
})

// PG-1066: a folder outside the worktrees folder takes plain playground rm, which no --discard gate guards
test("a session's --worktree --discard on a folder outside the worktrees folder is refused naming playground rm", async () => {
  const { deps, home } = machine()
  const outside = join(home, "scratch", "old-site")
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, "index.html"), "x")
  const worktrees = join(deps.main, ".claude", "worktrees")
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--worktree", outside, "--discard"], deps)).toBe(1)
  } finally {
    console.error = error
  }
  expect(said).toEqual([
    `playground: --worktree takes a folder in ${worktrees} or a git worktree in another repo's .claude/worktrees, not ${outside}: playground rm ${outside} moves a folder outside it to the trash, with no --worktree or --discard, up to 5,000 files or 2 GB; leave a bigger tree in place for your lead's cleanup`,
  ])
  expect(existsSync(outside)).toBe(true)
  expect(await runRm([outside], deps)).toBe(0)
  expect(existsSync(outside)).toBe(false)
})

// Another repo in HOME, on main with a remote, and its worktree <repo>/.claude/worktrees/app-1 on APP-1-thing, holding one commit not pushed and an installed node_modules.
const otherRepo = (root: string, home: string) => {
  const repo = join(home, "code", "app")
  git(root, "init", "--bare", "-q", join(root, "app.git"))
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  file(join(repo, ".gitignore"), "node_modules\n")
  git(repo, "add", ".")
  git(repo, "commit", "-qm", "init")
  git(repo, "remote", "add", "origin", join(root, "app.git"))
  git(repo, "push", "-q", "origin", "main")
  const worktrees = join(repo, ".claude", "worktrees")
  const wt = join(worktrees, "app-1")
  git(repo, "worktree", "add", "-q", "-b", "APP-1-thing", wt)
  file(join(wt, "work.txt"))
  git(wt, "add", ".")
  git(wt, "commit", "-qm", "work")
  file(join(wt, "node_modules", "dep", "index.js"))
  return { repo, worktrees, wt }
}

// runRm's exit, and what it printed to stderr.
const rmSaid = async (words: string[], deps: RmDeps) => {
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    return { code: await runRm(words, deps), said }
  } finally {
    console.error = error
  }
}

// PG-1942: a finished worktree of another repo, in that repo's own .claude/worktrees, goes as one of this checkout's does
test("--worktree takes another repo's worktree once its PR merged or closed: git in its own repo forgets it, its node_modules stays out of the trash, and --restore brings it back there", async () => {
  for (const state of ["MERGED", "CLOSED"] as const) {
    const { deps, home, root } = machine()
    const { repo, wt } = otherRepo(root, home)
    const head = git(wt, "rev-parse", "HEAD")
    const asked: string[] = []
    const finished: RmDeps = {
      ...deps,
      merged: (sha, at) => (asked.push(`merged ${at}`), state === "MERGED" && sha === head),
      prState: async (path) => (asked.push(`pr ${path}`), { head, number: 7, state }),
    }
    expect(await rmSaid([wt], finished)).toEqual({
      code: 1,
      said: [`playground: ${wt} is a worktree: playground rm --worktree removes it`],
    })
    const words = state === "MERGED" ? ["--worktree", wt] : ["--worktree", wt, "--discard"]
    expect(await rmSaid(words, finished)).toEqual({ code: 0, said: [] })
    expect(existsSync(wt)).toBe(false)
    expect(asked.every((line) => line.endsWith(` ${wt}`))).toBe(true)
    expect(asked).toContain(`pr ${wt}`)
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain(wt)
    const [entry] = listTrash(join(deps.data, "trash"))
    expect(entry).toMatchObject({ path: wt, stripped: 1 })
    expect(existsSync(join(deps.data, "trash", entry!.id, "app-1", "work.txt"))).toBe(true)
    expect(existsSync(join(deps.data, "trash", entry!.id, "app-1", "node_modules"))).toBe(false)
    expect(await runRm(["--restore", entry!.id], finished)).toBe(0)
    expect(git(wt, "symbolic-ref", "--short", "HEAD")).toBe("APP-1-thing")
    expect(git(wt, "rev-parse", "HEAD")).toBe(head)
    expect(git(repo, "worktree", "list", "--porcelain")).toContain(`worktree ${wt}\n`)
  }
})

test("--worktree refuses another repo's worktree with unpushed commits and an open PR as it refuses one here, and --discard takes it with no decision, its commit kept in a bundle", async () => {
  const { deps: base, home, root } = machine()
  const { repo, wt } = otherRepo(root, home)
  const head = git(wt, "rev-parse", "HEAD")
  const deps: RmDeps = { ...base, prState: async () => ({ head, number: 7, state: "OPEN" }) }
  const discard = `playground rm --worktree ${wt} --discard removes it anyway, its commits no remote holds kept first in a git bundle beside it in the trash`
  expect(await rmSaid(["--worktree", wt], deps)).toEqual({
    code: 1,
    said: [
      `playground: ${wt}'s HEAD holds work not landed on origin/canary (fetch origin canary if it merged since): ${discard}`,
    ],
  })
  expect(existsSync(wt)).toBe(true)
  expect(await rmSaid(["--worktree", wt, "--discard"], deps)).toEqual({ code: 0, said: [] })
  expect(existsSync(wt)).toBe(false)
  expect(git(repo, "worktree", "list", "--porcelain")).not.toContain(wt)
  const [entry] = listTrash(join(deps.data, "trash"))
  git(repo, "branch", "-D", "APP-1-thing")
  git(repo, "fetch", "-q", entry!.bundle!, "HEAD:refs/heads/APP-1-thing")
  expect(git(repo, "rev-parse", "APP-1-thing")).toBe(head)
})

// The folder playground rm archives another repo's worktree in, by its repo, its folder and its HEAD, and the commit each of its patches' From line names.
const archiveOf = (data: string, repo: string, wt: string) =>
  join(
    data,
    "scratchpad",
    "archive",
    basename(repo),
    `${basename(wt)}-${git(wt, "rev-parse", "HEAD").slice(0, 7)}`,
  )
const patchesIn = (dir: string) =>
  readdirSync(dir).map((f) => /^From ([0-9a-f]+) /.exec(readFileSync(join(dir, f), "utf8"))?.[1])
const unlanded = (wt: string) => git(wt, "rev-list", "HEAD", "--not", "--remotes").split("\n")
// rm's PR read of otherRepo's worktree as rmDeps reads it, through prStateOf, from what gh lists: [] for no PR, null for a list gh could not read
const readPrs =
  (prs: Parameters<typeof prStateOf>[0]): RmDeps["prState"] =>
  async () =>
    prStateOf(prs, { branch: "APP-1-thing", head: "h" }, () => false)

// #1962
test("--worktree archives another repo's worktree with no PR and commits no remote holds under the data folder's scratchpad/archive, then takes it with no decision", async () => {
  const { deps, home, root } = machine()
  const { repo, wt } = otherRepo(root, home)
  file(join(wt, "more.txt"))
  git(wt, "add", ".")
  git(wt, "commit", "-qm", "more")
  const shas = unlanded(wt)
  expect(shas).toHaveLength(2)
  const archive = archiveOf(deps.data, repo, wt)
  const session = { ...deps, prState: readPrs([]) }
  expect(await rmSaid(["--worktree", wt], session)).toEqual({ code: 0, said: [] })
  expect(existsSync(wt)).toBe(false)
  expect(patchesIn(archive).sort()).toEqual([...shas].sort())
  expect(git(repo, "worktree", "list", "--porcelain")).not.toContain(wt)
  expect(listTrash(join(deps.data, "trash"))).toMatchObject([{ path: wt }])
})

// #1962
test("--worktree keeps another repo's worktree with no PR whose archive holds patches other than its commits no remote holds, naming why, and writes over no archive already there", async () => {
  const { deps, home, root } = machine()
  const { repo, wt } = otherRepo(root, home)
  const archive = archiveOf(deps.data, repo, wt)
  mkdirSync(archive, { recursive: true })
  writeFileSync(
    join(archive, "0001-other.patch"),
    `From ${"0".repeat(40)} Mon Sep 17 00:00:00 2001\n`,
  )
  const discard = `playground rm --worktree ${wt} --discard removes it anyway, its commits no remote holds kept first in a git bundle beside it in the trash`
  expect(await rmSaid(["--worktree", wt], { ...deps, prState: readPrs([]) })).toEqual({
    code: 1,
    said: [
      `playground: ${wt}'s HEAD holds work not landed on origin/canary (fetch origin canary if it merged since), and its archive at ${archive} holds 1 patch, 0 of its 1 commit no remote holds: ${discard}`,
    ],
  })
  expect(existsSync(wt)).toBe(true)
  expect(readdirSync(archive)).toEqual(["0001-other.patch"])
})

// #1962: the archive route runs only on gh's clean answer of no PR; a read gh could not make, two PRs answering, or one that is not the worktree's own keep canary's refusal
test.each([
  ["a PR read gh could not make", null],
  [
    "two PRs answering",
    [
      { headRefName: "APP-1-thing", headRefOid: "a", number: 1, state: "OPEN" as const },
      { headRefName: "APP-1-thing", headRefOid: "b", number: 2, state: "CLOSED" as const },
    ],
  ],
  [
    "a PR whose head is not HEAD or an ancestor of it",
    [{ headRefName: "APP-1-thing", headRefOid: "f".repeat(40), number: 1, state: "OPEN" as const }],
  ],
])(
  "--worktree refuses another repo's worktree with commits no remote holds on %s, writing no archive",
  async (_, prs) => {
    const { deps, home, root } = machine()
    const { wt } = otherRepo(root, home)
    const discard = `playground rm --worktree ${wt} --discard removes it anyway, its commits no remote holds kept first in a git bundle beside it in the trash`
    expect(await rmSaid(["--worktree", wt], { ...deps, prState: readPrs(prs) })).toEqual({
      code: 1,
      said: [
        `playground: ${wt}'s HEAD holds work not landed on origin/canary (fetch origin canary if it merged since): ${discard}`,
      ],
    })
    expect(existsSync(wt)).toBe(true)
    expect(existsSync(join(deps.data, "scratchpad"))).toBe(false)
  },
)

// #1962's controls: a live session's tree and one holding an untracked file, in another repo, and this checkout's own worktree, each with a commit no remote holds and no PR, are refused as before, with no archive written
test("--worktree refuses, with no PR and a commit no remote holds, a live session's tree and an untracked file's in another repo, and this checkout's own worktree, writing no archive", async () => {
  const { deps: base, home, main, root } = machine()
  const deps = { ...base, prState: readPrs([]) }
  const { repo, wt } = otherRepo(root, home)
  const held = { command: "zsh", cwd: wt, pid: 7, sockets: [] }
  expect(await rmSaid(["--worktree", wt], { ...deps, procs: () => [held] })).toEqual({
    code: 1,
    said: [`playground: ${wt} is held by pid 7 (zsh) working in ${wt}`],
  })
  file(join(wt, "wip.ts"))
  expect((await rmSaid(["--worktree", wt], deps)).said[0]).toStartWith(
    `playground: ${wt} holds 1 uncommitted change (wip.ts): `,
  )
  expect(existsSync(wt)).toBe(true)
  git(main, "init", "-q", "-b", "canary")
  file(join(main, "README.md"))
  git(main, "add", ".")
  git(main, "commit", "-qm", "init")
  const own = join(main, ".claude", "worktrees", "pg-1")
  git(main, "worktree", "add", "-q", "-b", "PG-1-thing", own)
  file(join(own, "work.txt"))
  git(own, "add", ".")
  git(own, "commit", "-qm", "work")
  expect((await rmSaid(["--worktree", own], deps)).said[0]).toStartWith(
    `playground: ${own}'s HEAD holds work not landed on origin/canary (fetch origin canary if it merged since): `,
  )
  expect(existsSync(own)).toBe(true)
  expect(existsSync(join(deps.data, "scratchpad"))).toBe(false)
  expect(repo).not.toBe(main)
})

test("--worktree refuses, in another repo, a folder in its .claude/worktrees git does not list as its worktree, the repo's own checkout, and its worktree outside .claude/worktrees", async () => {
  const { deps, home, root } = machine()
  const { repo, worktrees, wt } = otherRepo(root, home)
  const plain = join(worktrees, "plain")
  file(join(plain, "index.html"))
  const clone = join(worktrees, "clone")
  mkdirSync(clone)
  git(clone, "init", "-q", "-b", "main")
  const forged = join(worktrees, "forged")
  mkdirSync(forged)
  writeFileSync(join(forged, ".git"), readFileSync(join(wt, ".git")))
  const third = join(home, "code", "third")
  mkdirSync(third, { recursive: true })
  git(third, "init", "-q", "-b", "main")
  file(join(third, "README.md"))
  git(third, "add", ".")
  git(third, "commit", "-qm", "init")
  const stranger = join(worktrees, "stranger")
  git(third, "worktree", "add", "-q", "-b", "other", stranger)
  const outside = join(home, "code", "app-wt")
  git(repo, "worktree", "add", "-q", "-b", "APP-2-thing", outside)
  const session = {
    ...deps,
    merged: () => true,
    prState: async () => ({ head: "x", number: 7, state: "MERGED" as const }),
  }
  const ours = join(deps.main, ".claude", "worktrees")
  for (const path of [plain, clone, forged, stranger, repo, outside])
    for (const words of [
      ["--worktree", path],
      ["--worktree", path, "--discard"],
    ]) {
      expect(await rmSaid(words, session)).toEqual({
        code: 1,
        said: [
          `playground: --worktree takes a folder in ${ours} or a git worktree in another repo's .claude/worktrees, not ${path}: playground rm ${path} moves a folder outside it to the trash, with no --worktree or --discard, up to 5,000 files or 2 GB; leave a bigger tree in place for your lead's cleanup`,
        ],
      })
      expect(existsSync(path)).toBe(true)
    }
  expect(git(repo, "worktree", "list", "--porcelain")).toContain(`worktree ${outside}\n`)
})

// run-slot's clone lane copies <source>/node_modules from its caller's folder, so only its holder record names the source (PG-699)
test("runRm --worktree refuses a worktree a running clone reads from, naming the clone, and moves it once the record is gone", async () => {
  const { deps, main, root } = machine()
  git(root, "init", "--bare", "-q", join(root, "remote.git"))
  git(main, "init", "-q", "-b", "canary")
  writeFileSync(join(main, "README.md"), "x")
  git(main, "add", ".")
  git(main, "commit", "-qm", "init")
  git(main, "remote", "add", "origin", join(root, "remote.git"))
  git(main, "push", "-q", "origin", "canary")
  const wt = join(main, ".claude", "worktrees", "pg-1")
  git(main, "worktree", "add", "-q", "-b", "PG-1-thing", wt)
  git(wt, "push", "-q", "origin", "PG-1-thing")
  const into = join(main, ".claude", "worktrees", "pg-2")
  const reading = { destination: into, pid: 4242, source: wt, who: "k3m9px-worker" }
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--worktree", wt], { ...deps, clones: () => [reading] })).toBe(1)
  } finally {
    console.error = error
  }
  expect(said).toEqual([
    `playground: ${wt} is held by k3m9px-worker's node_modules clone (pid 4242) from ${wt} into ${into}`,
  ])
  expect(existsSync(wt)).toBe(true)
  expect(await runRm(["--worktree", wt], deps)).toBe(0)
  expect(existsSync(wt)).toBe(false)
})

// A main checkout with a remote and a worktree on PG-1-thing holding one commit of its own, which the deps call merged, so rm --worktree moves it, after a step of the caller's own and with its extra words; and the trash id of the move.
const trashedWorktree = async (
  before = (_wt: string, _main: string) => {},
  words: string[] = [],
) => {
  const { deps, main, root } = machine()
  git(root, "init", "--bare", "-q", join(root, "remote.git"))
  git(main, "init", "-q", "-b", "canary")
  writeFileSync(join(main, "README.md"), "x")
  git(main, "add", ".")
  git(main, "commit", "-qm", "init")
  git(main, "remote", "add", "origin", join(root, "remote.git"))
  git(main, "push", "-q", "origin", "canary")
  const wt = join(main, ".claude", "worktrees", "pg-1")
  git(main, "worktree", "add", "-q", "-b", "PG-1-thing", wt)
  writeFileSync(join(wt, "work.txt"), "work")
  git(wt, "add", ".")
  git(wt, "commit", "-qm", "work")
  const sha = git(wt, "rev-parse", "HEAD")
  const merged = { ...deps, merged: () => true }
  before(wt, main)
  expect(await runRm(["--worktree", wt, ...words], merged)).toBe(0)
  expect(existsSync(wt)).toBe(false)
  const [batch] = readdirSync(join(deps.data, "trash"))
  return { deps: merged, id: `${batch}/1`, main, sha, wt }
}

// What git reads in a restored worktree: its status, its branch, its HEAD, and whether the main checkout lists it.
const gitSees = (main: string, wt: string) => ({
  branch: git(wt, "symbolic-ref", "--short", "HEAD"),
  head: git(wt, "log", "-1", "--format=%H"),
  listed: git(main, "worktree", "list", "--porcelain").includes(`worktree ${wt}\n`),
  status: git(wt, "status", "--porcelain"),
})

test("runRm --restore brings a worktree back as git reads it: on its branch, at the commit it held, listed", async () => {
  const { deps, id, main, sha, wt } = await trashedWorktree()
  expect(await runRm(["--restore", id], deps)).toBe(0)
  expect(gitSees(main, wt)).toEqual({ branch: "PG-1-thing", head: sha, listed: true, status: "" })
})

test("runRm --restore recreates the worktree's branch at the commit it held when the branch has gone", async () => {
  const { deps, id, main, sha, wt } = await trashedWorktree()
  git(main, "branch", "-D", "PG-1-thing")
  expect(await runRm(["--restore", id], deps)).toBe(0)
  expect(gitSees(main, wt)).toEqual({ branch: "PG-1-thing", head: sha, listed: true, status: "" })
  expect(git(main, "rev-parse", "PG-1-thing")).toBe(sha)
})

test("runRm --restore refuses a worktree whose branch and commit have both gone, naming the commit, and moves nothing", async () => {
  const { deps, id, main, sha, wt } = await trashedWorktree()
  git(main, "branch", "-D", "PG-1-thing")
  git(main, "reflog", "expire", "--expire=now", "--all")
  git(main, "gc", "-q", "--prune=now")
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--restore", id], deps)).toBe(1)
  } finally {
    console.error = error
  }
  expect(said).toHaveLength(1)
  expect(said[0]).toContain(sha)
  expect(said[0]).toContain(`git -C ${main} branch PG-1-thing ${sha}`)
  expect(existsSync(wt)).toBe(false)
  expect(readdirSync(join(deps.data, "trash", id))).toEqual(["pg-1"])
})

test("runRm --restore leaves a worktree's git record as it is when it is still there, so a staged change stays staged", async () => {
  let saved = ""
  const { deps, id, main, wt } = await trashedWorktree(
    (wt, main) => {
      writeFileSync(join(wt, "staged.txt"), "s")
      git(wt, "add", "staged.txt")
      saved = join(main, "..", "pg-1-record")
      cpSync(join(main, ".git", "worktrees", "pg-1"), saved, { recursive: true })
    },
    ["--discard"],
  )
  cpSync(saved, join(main, ".git", "worktrees", "pg-1"), { recursive: true })
  expect(await runRm(["--restore", id], deps)).toBe(0)
  expect(git(wt, "diff", "--cached", "--name-only")).toBe("staged.txt")
})

test("runRm --restore refuses a worktree whose branch now points at another commit, naming both, and moves nothing", async () => {
  const { deps, id, main, sha, wt } = await trashedWorktree()
  git(main, "branch", "-f", "PG-1-thing", "canary")
  const moved = git(main, "rev-parse", "canary")
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--restore", id], deps)).toBe(1)
  } finally {
    console.error = error
  }
  expect(said).toHaveLength(1)
  expect(said[0]).toContain(sha)
  expect(said[0]).toContain(moved)
  expect(said[0]).not.toContain("branch -f")
  expect(existsSync(wt)).toBe(false)
  expect(git(main, "rev-parse", "PG-1-thing")).toBe(moved)
})

test("runRm --restore brings a detached worktree back detached, at the commit it held", async () => {
  const { deps, id, main, sha, wt } = await trashedWorktree((wt) =>
    git(wt, "checkout", "-q", "--detach"),
  )
  expect(await runRm(["--restore", id], deps)).toBe(0)
  expect(readFileSync(join(main, ".git", "worktrees", "pg-1", "HEAD"), "utf8")).toBe(`${sha}\n`)
  expect(git(wt, "rev-parse", "HEAD")).toBe(sha)
  expect(git(wt, "status", "--porcelain")).toBe("")
  expect(git(main, "worktree", "list", "--porcelain")).toContain(`worktree ${wt}\n`)
})

test("runRm --restore refuses a detached worktree whose commit has gone, naming the commit and no branch", async () => {
  const { deps, id, main, sha, wt } = await trashedWorktree((wt) =>
    git(wt, "checkout", "-q", "--detach"),
  )
  git(main, "branch", "-D", "PG-1-thing")
  git(main, "reflog", "expire", "--expire=now", "--all")
  git(main, "gc", "-q", "--prune=now")
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--restore", id], deps)).toBe(1)
  } finally {
    console.error = error
  }
  expect(said).toHaveLength(1)
  expect(said[0]).toContain(sha)
  expect(said[0]).not.toContain("git -C")
  expect(existsSync(wt)).toBe(false)
})

test("runRm --restore exits 1 naming the step when git cannot recreate the branch after the move", async () => {
  const { deps, id, main, wt } = await trashedWorktree()
  git(main, "branch", "-D", "PG-1-thing")
  writeFileSync(join(main, ".git", "refs", "heads", "PG-1-thing.lock"), "")
  const said: string[] = []
  const error = console.error
  console.error = (line: string) => void said.push(line)
  try {
    expect(await runRm(["--restore", id], deps)).toBe(1)
  } finally {
    console.error = error
  }
  expect(said).toHaveLength(1)
  expect(said[0]).toStartWith(
    `playground: restored ${wt}, but git cannot read it yet: git branch PG-1-thing `,
  )
  expect(existsSync(wt)).toBe(true)
})

test("clonesOf reads run-slot's clone holder line while its pid lives, and a line with no source as none", () => {
  const line = "k3m9px-worker 4242 2026-11-03T05:21:53Z\t/a/src\t/a/dst\n"
  expect(clonesOf(line, () => true)).toEqual([
    { destination: "/a/dst", pid: 4242, source: "/a/src", who: "k3m9px-worker" },
  ])
  expect(clonesOf(line, () => false)).toEqual([])
  expect(clonesOf("k3m9px-worker 4242 2026-11-03T05:21:53Z\n", () => true)).toEqual([])
  expect(clonesOf("", () => true)).toEqual([])
})

test("rmDeps' notify queues a safe-delete line for the dispatcher through notify.sh", () => {
  const { root } = machine()
  const data = join(root, "data")
  const before = process.env.PLAYGROUND_DATA_DIR
  process.env.PLAYGROUND_DATA_DIR = data
  try {
    rmDeps(join(import.meta.dir, "..", "..", "..", "..", "..")).notify("s: /x is protected")
  } finally {
    if (before === undefined) delete process.env.PLAYGROUND_DATA_DIR
    else process.env.PLAYGROUND_DATA_DIR = before
  }
  const line = JSON.parse(
    readFileSync(join(data, "ops", "outbox", "ops-safe-delete.jsonl"), "utf8"),
  )
  expect(line).toMatchObject({ job: "safe-delete", text: "s: /x is protected" })
})

test("rmDeps' clones reads run-slot's clone holder line from the data folder's ops, and no line as no clone", () => {
  const { root } = machine()
  const data = join(root, "data")
  mkdirSync(join(data, "ops"), { recursive: true })
  const before = process.env.PLAYGROUND_DATA_DIR
  process.env.PLAYGROUND_DATA_DIR = data
  try {
    const deps = rmDeps(join(import.meta.dir, "..", "..", "..", "..", ".."))
    expect(deps.clones()).toEqual([])
    writeFileSync(
      join(data, "ops", "run-slot-clone.holder"),
      `k3m9px-worker ${process.pid} 2026-11-03T05:21:53Z\t/a/src\t/a/dst\n`,
    )
    expect(deps.clones()).toEqual([
      { destination: "/a/dst", pid: process.pid, source: "/a/src", who: "k3m9px-worker" },
    ])
  } finally {
    if (before === undefined) delete process.env.PLAYGROUND_DATA_DIR
    else process.env.PLAYGROUND_DATA_DIR = before
  }
})

test("processesOf joins lsof's working folders with ps's command lines and each process's sockets", () => {
  const cwds = "p41\nfcwd\nn/wt/api\np43\nfcwd\nn/wt\np50\nfcwd\n"
  const ps = "   41 bun run dev\n   43 /x/agent-browser-darwin-arm64\n   50 launchd\n"
  const sockets = "p43\nf6\nn->0xe55b\nf10\nn/h/.agent-browser/s1.sock\n"
  expect(processesOf(cwds, ps, sockets)).toEqual([
    { command: "bun run dev", cwd: "/wt/api", pid: 41, sockets: [] },
    {
      command: "/x/agent-browser-darwin-arm64",
      cwd: "/wt",
      pid: 43,
      sockets: ["/h/.agent-browser/s1.sock"],
    },
  ])
})
