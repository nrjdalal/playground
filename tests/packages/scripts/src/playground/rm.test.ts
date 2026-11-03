import { afterAll, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CARVE_OUTS } from "../../../../../packages/safe-delete/src"
import {
  clonesOf,
  processesOf,
  RM_USAGE,
  type RmDeps,
  rmArgs,
  rmDeps,
  runRm,
} from "../../../../../packages/scripts/src/playground/rm"

test("rm takes one path, or --worktree's, with an optional reason", () => {
  expect(rmArgs(["old"])).toEqual({ path: "old", reason: "playground rm", worktree: false })
  expect(rmArgs(["--worktree", "wt", "--reason", "merged"])).toEqual({
    path: "wt",
    reason: "merged",
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
    notify: (text) => void told.push(text),
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
  expect(await runRm(["--worktree", wt], deps)).toBe(0)
  expect(existsSync(wt)).toBe(false)
  expect(git(main, "worktree", "list")).not.toContain("pg-1")
})

// run-slot's clone lane copies <source>/node_modules with its cwd in the destination, so only its holder record names the source (PG-699)
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
