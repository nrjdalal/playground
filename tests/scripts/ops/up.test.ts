import { afterAll, expect, test } from "bun:test"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { CMUX_APP, cmuxHeldOf, processTableOf } from "../../../api/hono/src/lib/dashboard/cmux"

const upPy = join(import.meta.dir, "..", "..", "..", "scripts", "ops", "up.py")
const scratch = mkdtempSync(join(tmpdir(), "ops-up-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The data folder up.py reads under a config folder: its jobs.json, roster and up.log.
const dataOf = (config: string) => join(config, "playground")

// Loads up.py from the path given first, the opening of every harness below.
const LOAD = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("up", sys.argv[1])
up = importlib.util.module_from_spec(spec)
spec.loader.exec_module(up)
`

// Loads up.py with every read of the machine stubbed: an auto job runs healthy outside cmux under each pid given, one pass a pid, and each notify.sh call is printed rather than run.
const HARNESS = `${LOAD}holders = [int(p) for p in sys.argv[2:]]
calls = []
up.workspaces = lambda: {}
up.healthy = lambda job, procs, cmux: (True, "")
up.cmux_held = lambda procs: True
up.ptable.cmux_of = lambda pid, procs: None
up.run = lambda argv, timeout=60: (argv[0] != "lsof" and calls.append(argv), (0, ""))[1]
for holder in holders:
    up.ptable.table = lambda holder=holder: {holder: None}
    up.once.running = lambda name, marker, holder=holder: holder
    up.up(True)
print(json.dumps(calls))
`

// Loads up.py and prints cmux_held for the process table given, with ps's starts stubbed to the one start every session gives.
const HELD = `${LOAD}up.ptable.starts = lambda pids: {pid: sys.argv[3] for pid in pids}
print(json.dumps(up.cmux_held({int(pid): tuple(row) for pid, row in json.loads(sys.argv[2]).items()})))
`

const passes = (...holders: number[]): string[][] => {
  const config = join(scratch, `config-${holders.join("-")}`)
  const ops = join(dataOf(config), "ops")
  mkdirSync(ops, { recursive: true })
  const job = {
    auto: true,
    command: "bash /x/ops/ops-dashboard/loop.sh",
    name: "ops-dashboard",
    runtime: "auto",
  }
  writeFileSync(join(ops, "jobs.json"), JSON.stringify({ jobs: [job] }))
  const child = Bun.spawnSync(["python3", "-I", "-c", HARNESS, upPy, ...holders.map(String)], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: scratch,
      PATH: "/usr/bin:/bin",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(child.stderr.toString()).toBe("")
  return JSON.parse(child.stdout.toString())
}

// the warning reaches the owner off the Dashboard as one macOS banner a holder, through notify.sh with NOTIFY_MAC set.
test("a job outside cmux while cmux holds a factory session shows one banner per holder", () => {
  const banner = [
    "env",
    "NOTIFY_MAC=1",
    join(import.meta.dir, "..", "..", "..", "scripts", "ops", "notify.sh"),
    "up",
    "ops-dashboard runs outside cmux while cmux holds a factory session; a pass inside cmux moves it back, so open a cmux terminal",
  ]
  expect(passes(4101, 4101, 4101)).toEqual([banner])
  expect(passes(4201, 4201, 4202)).toEqual([banner, banner])
})

// an auto job stays in cmux only while cmux holds a factory session, by the rule the dashboard's cmuxHeldOf() reads.
test("cmux_held counts the factory's sessions alone, as cmuxHeldOf does", () => {
  const config = join(scratch, "held")
  mkdirSync(join(config, "sessions"), { recursive: true })
  mkdirSync(dataOf(config), { recursive: true })
  const roster = [{ kind: "builder", name: "x7mh4d-builder" }]
  writeFileSync(join(dataOf(config), "roster.json"), JSON.stringify({ agents: roster }))
  const START = "Mon Oct 19 01:00:00 2026"
  const table = processTableOf(
    [
      `    1     0 ${START}     /sbin/launchd`,
      `  500     1 ${START}     ${CMUX_APP}`,
      `  510   500 ${START}     /Users/me/.bun/bin/claude`,
      `  520   500 ${START}     /Users/me/.bun/bin/claude`,
      `  530   500 ${START}     /Users/me/.bun/bin/claude`,
      `  540   500 ${START}     /Users/me/.bun/bin/claude`,
    ].join("\n"),
  )
  const procs = Object.fromEntries([...table].map(([pid, row]) => [pid, [row.ppid, row.exe]]))
  const files: { pid: number; text: string }[] = []
  const register = (
    pid: number,
    name: string,
    text = JSON.stringify({ name, pid, procStart: START, sessionId: `s-${pid}` }),
  ) => {
    writeFileSync(join(config, "sessions", `${pid}.json`), text)
    files.push({ pid, text })
  }
  const held = (path = `${dirname(process.execPath)}:/usr/bin:/bin`): boolean => {
    const child = Bun.spawnSync(["python3", "-I", "-c", HELD, upPy, JSON.stringify(procs), START], {
      env: {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
        HOME: scratch,
        PATH: path,
      },
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(child.stderr.toString()).toBe("")
    return JSON.parse(child.stdout.toString())
  }
  register(510, "fix the sidebar")
  expect(held()).toBe(false)
  expect(cmuxHeldOf(files, table, roster)).toEqual([])
  // a Bun call that cannot run counts as held, as an unreadable ps does
  expect(held("/usr/bin:/bin")).toBe(true)
  register(530, "")
  expect(held()).toBe(false)
  expect(cmuxHeldOf(files, table, roster)).toEqual([])
  register(540, "", "{")
  expect(held()).toBe(true)
  expect(cmuxHeldOf(files, table, roster)).toEqual(["pid 540"])
  rmSync(join(config, "sessions", "540.json"))
  files.pop()
  register(520, "x7mh4d-builder")
  expect(held()).toBe(true)
  expect(cmuxHeldOf(files, table, roster)).toEqual(["x7mh4d-builder"])
})

// Loads up.py and runs --sessions with every live session's pid alive, outside the factory's folders, and running a claude with no --settings.
const SESSIONS = `${LOAD}up.alive = lambda pid: True
up.covered = lambda cwd: False
up.run = lambda argv, timeout=60: (0, "/Users/me/.bun/bin/claude --resume s")
up.sessions()
`

// --sessions reads the factory rule from kinds.ts alone, so a kind added there reaches it with no Python copy to keep.
test("--sessions names a session of a kind only kinds.ts knows", () => {
  const repo = join(scratch, "kinds-repo")
  const ops = join(repo, "scripts", "ops")
  mkdirSync(ops, { recursive: true })
  for (const file of ["beat.py", "once.py", "ptable.py", "up.py"])
    copyFileSync(join(dirname(upPy), file), join(ops, file))
  const kinds = readFileSync(
    join(dirname(upPy), "..", "..", "packages", "config", "src", "kinds.ts"),
    "utf8",
  )
  const added = kinds
    .replace(/(export const ROSTER_KINDS = \[)/, '$1\n  "auditor",')
    .replace(
      /(export const FACTORY_ROLE_OF_KIND: Record<RosterKind, string> = \{)/,
      '$1\n  auditor: "worker",',
    )
  expect(added.match(/auditor/g)).toHaveLength(2)
  mkdirSync(join(repo, "packages", "config", "src"), { recursive: true })
  writeFileSync(join(repo, "packages", "config", "src", "kinds.ts"), added)
  const config = join(scratch, "kinds-config")
  mkdirSync(join(config, "sessions"), { recursive: true })
  mkdirSync(dataOf(config), { recursive: true })
  writeFileSync(
    join(dataOf(config), "roster.json"),
    JSON.stringify({
      agents: [{ kind: "auditor", name: "a1-audit", status: "working" }],
    }),
  )
  writeFileSync(
    join(config, "sessions", "7001.json"),
    JSON.stringify({
      cwd: "/nowhere",
      name: "a1-audit",
      pid: 7001,
      sessionId: "s-7001",
    }),
  )
  const child = Bun.spawnSync(["python3", "-I", "-c", SESSIONS, join(ops, "up.py")], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: scratch,
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(child.stderr.toString()).toBe("")
  expect(child.stdout.toString()).toContain(
    "a1-audit (pid 7001, /nowhere) runs without the factory's hooks",
  )
})

// Loads up.py and runs a plain pass (main()) over the jobs given, every job healthy or every job down, inside cmux or outside it; each start succeeds, herdr's included.
const EXIT = `${LOAD}inside, ok = sys.argv[2] == "inside", sys.argv[3] == "healthy"
up.workspaces = lambda: {}
up.healthy = lambda job, procs, cmux: (ok, "" if ok else "no heartbeat")
up.cmux_held = lambda procs: True
up.ptable.table = lambda: {4101: None}
up.ptable.cmux_of = lambda pid, procs: 1 if inside else None
up.once.running = lambda name, marker: 4101 if ok else None
up.run = lambda argv, timeout=60: (0, "")
up.start = lambda job, existing: True
up.herdr = lambda: ("/x/herdr", "")
sys.argv = sys.argv[:1]
up.main()
`

const exitOf = (jobs: object[], where: "inside" | "outside", state: "down" | "healthy"): number => {
  const config = mkdtempSync(join(scratch, "exit-"))
  mkdirSync(join(dataOf(config), "ops"), { recursive: true })
  writeFileSync(join(dataOf(config), "ops", "jobs.json"), JSON.stringify({ jobs }))
  const child = Bun.spawnSync(["python3", "-I", "-c", EXIT, upPy, where, state], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: scratch,
      PATH: "/usr/bin:/bin",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(child.stderr.toString()).toBe("")
  return child.exitCode
}

// dispatcher stops on up.py's exit 3 rather than wait for a Dashboard that a pass outside cmux cannot start.
test("a pass exits 3 only when the Dashboard's cmux job is down and the pass runs outside cmux", () => {
  const cmuxJob = {
    command: "bash /x/ops/ops-dashboard/loop.sh",
    name: "ops-dashboard",
    needsCmux: true,
    runtime: "cmux",
    stop: "dashboard",
  }
  const herdrJob = { ...cmuxJob, needsCmux: false, runtime: "herdr" }
  const otherJob = {
    command: "bash /x/ops/ops-x/loop.sh",
    name: "ops-x",
    needsCmux: true,
    runtime: "cmux",
  }
  const autoJob = {
    auto: true,
    command: "bash /x/ops/ops-dashboard/loop.sh",
    name: "ops-dashboard",
    runtime: "auto",
  }
  const launchdJob = { launchd: "blue.acme.x", name: "x" }
  expect(exitOf([cmuxJob], "outside", "down")).toBe(3)
  expect(exitOf([cmuxJob], "inside", "down")).toBe(0)
  expect(exitOf([cmuxJob], "outside", "healthy")).toBe(0)
  // a job that names no runtime starts in herdr, so a pass outside cmux brings the Dashboard up
  expect(exitOf([{ ...cmuxJob, runtime: undefined }], "outside", "down")).toBe(0)
  // another cmux job left down while the Dashboard's job starts in herdr: the Dashboard still comes up
  expect(exitOf([herdrJob, otherJob], "outside", "down")).toBe(0)
  // the banner case: healthy outside cmux while cmux holds a factory session
  expect(exitOf([autoJob], "outside", "healthy")).toBe(0)
  expect(exitOf([launchdJob], "outside", "down")).toBe(0)
})

// Loads up.py and runs main() with the arguments after its path, every job down and outside cmux, each start printed rather than made.
const RESTARTED = `${LOAD}started = []
up.workspaces = lambda: {}
up.healthy = lambda job, procs, cmux: (False, "no heartbeat")
up.cmux_held = lambda procs: True
up.ptable.table = lambda: {}
up.ptable.cmux_of = lambda pid, procs: None
up.once.running = lambda name, marker: None
up.run = lambda argv, timeout=60: (0, "")
up.start = lambda job, existing: started.append(job["name"]) or True
up.herdr = lambda: ("/x/herdr", "")
sys.argv = sys.argv[1:]
up.main()
print(json.dumps(started))
`

// ops-restart stops a job up.py may have started within GRACE, so --restarted drops its start under up.lock, waiting out a running pass whose own write would put it back, as the lock holder's write here does.
test("--restarted drops the named jobs' starts once any running pass ends, and starts them", async () => {
  const config = mkdtempSync(join(scratch, "restarted-"))
  const ops = join(dataOf(config), "ops")
  mkdirSync(ops, { recursive: true })
  const job = (name: string) => ({ command: `bash /x/${name}.sh`, name, runtime: "herdr" })
  writeFileSync(join(ops, "jobs.json"), JSON.stringify({ jobs: [job("ops-x"), job("ops-y")] }))
  const now = Date.now() / 1000
  writeFileSync(join(ops, "up-state.json"), JSON.stringify({ "ops-x": now, "ops-y": now }))
  const env = {
    CLAUDE_CONFIG_DIR: config,
    PLAYGROUND_DATA_DIR: join(config, "playground"),
    HOME: scratch,
    PATH: "/usr/bin:/bin",
  }
  const pass = (...args: string[]) => {
    const child = Bun.spawnSync(["python3", "-I", "-c", RESTARTED, upPy, ...args], {
      env,
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(child.stderr.toString()).toBe("")
    return JSON.parse(child.stdout.toString().trim().split("\n").at(-1)!)
  }
  expect(pass()).toEqual([])
  const holder = Bun.spawn(
    [
      "python3",
      "-I",
      "-c",
      "import fcntl, sys, time\nf = open(sys.argv[1], 'w')\nfcntl.flock(f, fcntl.LOCK_EX)\nprint('held', flush=True)\ntime.sleep(3)\nopen(sys.argv[2], 'w').write(sys.argv[3])",
      join(ops, "up.lock"),
      join(ops, "up-state.json"),
      JSON.stringify({ "ops-x": now, "ops-y": now, "ops-z": now }),
    ],
    { stdout: "pipe" },
  )
  const reader = holder.stdout.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("held")
  expect(pass()).toEqual([])
  expect(pass("--restarted", "ops-x")).toEqual(["ops-x"])
  expect(await holder.exited).toBe(0)
  expect(Object.keys(JSON.parse(readFileSync(join(ops, "up-state.json"), "utf8")))).toEqual([
    "ops-y",
    "ops-z",
    "ops-x",
  ])
})

// Loads up.py and runs two passes with every job healthy by its heartbeat, lsof answering the fake listing given and every other call recorded; a TERM'd pid dies, and starts are recorded rather than made.
const DELETED = `${LOAD}listing = sys.argv[2]
calls, kills, started = [], [], []
up.workspaces = lambda: {}
up.healthy = lambda job, procs, cmux: (True, "ok")
up.cmux_held = lambda procs: True
up.ptable.table = lambda: {pid: None for pid in (4301, 4302, 4401, 4501, 4601, 4602, 4701)}
up.ptable.cmux_of = lambda pid, procs: None
up.once.running = lambda name, marker: {"ops-x": 4301, "ops-y": 4501, "ops-z": 4601}.get(name)
up.run = lambda argv, timeout=60: (0, listing) if argv[0] == "lsof" else (calls.append(argv), (0, ""))[1]
up.os.kill = lambda pid, sig: kills.append([pid, sig])
up.alive = lambda pid: [pid, 15] not in kills
up.start = lambda job, existing: started.append(job["name"]) or True
up.herdr = lambda: ("/x/herdr", "")
up.in_grid = lambda job, existing, binary=None: True
up.up(True)
up.up(True)
print(json.dumps({"calls": calls, "kills": kills, "started": started}))
`

// an update that deletes a job's executable leaves it beating on a binary macOS no longer trusts, so ops-up restarts it, reports a launchd job it never started, and leaves a job with no holder to stop alone.
test("a job on a deleted executable is restarted, or reported once when launchd holds it", () => {
  const config = mkdtempSync(join(scratch, "deleted-"))
  const ops = join(dataOf(config), "ops")
  mkdirSync(ops, { recursive: true })
  const job = (name: string) => ({
    command: `bash /x/${name}.sh`,
    heartbeat: name,
    name,
    runtime: "herdr",
  })
  const jobs = [
    job("ops-w"),
    job("ops-x"),
    job("ops-y"),
    job("ops-z"),
    { heartbeat: "ops-l", launchd: "com.x.ops-l", name: "ops-l" },
  ]
  writeFileSync(join(ops, "jobs.json"), JSON.stringify({ jobs }))
  const beats = { "ops-l": 4401, "ops-w": 4701, "ops-x": 4302, "ops-y": 4501, "ops-z": 4602 }
  for (const [name, pid] of Object.entries(beats))
    writeFileSync(join(ops, `${name}.json`), JSON.stringify({ pid }))
  const gone = join(scratch, "gone", "python3")
  const listing = [
    ["4301", gone],
    ["4302", "/bin/sh"],
    ["4401", `${gone}-l`],
    ["4501", "/bin/sh"],
    ["4601", "/bin/sh"],
    ["4602", `${gone}-z`],
    ["4701", `${gone}-w`],
  ]
    .map(([pid, exe]) => `p${pid}\nftxt\nn${exe}\nftxt\nn/usr/lib/dyld`)
    .join("\n")
  const child = Bun.spawnSync(["python3", "-I", "-c", DELETED, upPy, listing], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: scratch,
      PATH: "/usr/bin:/bin",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(child.stderr.toString()).toBe("")
  const { calls, kills, started } = JSON.parse(child.stdout.toString())
  expect(kills).toEqual([
    [4301, 15],
    [4601, 15],
  ])
  expect(started).toEqual(["ops-x", "ops-z"])
  expect(calls).toEqual([
    [
      join(dirname(upPy), "notify.sh"),
      "up",
      `ops-l pid 4401 runs a deleted executable (${gone}-l); launchd job com.x.ops-l keeps it alive, so restart it there`,
    ],
  ])
  const log = readFileSync(join(ops, "up.log"), "utf8")
  expect(log).toContain(`ops-x pid 4301 runs a deleted executable (${gone}); stopped it`)
  expect(log).toContain(
    `ops-z pid 4601 holds pid 4602, which runs a deleted executable (${gone}-z); stopped it`,
  )
  expect(log).not.toContain("ops-y")
  // ops-w has no holder to stop, so a start would run a second copy beside its heartbeat pid
  expect(log).not.toContain("ops-w")
})

// Loads up.py and starts one herdr job and two cmux jobs (one split, one new workspace), recording every herdr call and spawned argv rather than making them.
const STARTED = `${LOAD}calls, lines = [], []
up.herdr = lambda: ("/x/herdr", "")
up.ops_panes = lambda binary: ([(4101, "ops-a")], "workspace:1")
up.hr = lambda binary, *args: (calls.append(args), (0, {"pane": {"pane_id": 5501}}, ""))[1]
up.workspaces = lambda: {}
up.surfaces = lambda ws: [("surface:1", "x")]
up.run = lambda argv, timeout=60: (lines.append(argv), (0, ""))[1]
up.start({"name": "ops-h", "runtime": "herdr", "cwd": "~/h", "command": "bash /x/h.sh"}, {})
up.start({"name": "ops-c", "runtime": "cmux", "cwd": "~/c", "command": "bash /x/c.sh"}, {"Ops": ["workspace:1"]})
up.start({"name": "ops-n", "runtime": "cmux", "cwd": "~/n", "command": "bash /x/n.sh"}, {})
print(json.dumps({"hr": [list(c) for c in calls], "run": lines}))
`

// a job's pane closes when its job exits, so every line up.py sends holds exec before the job.
test("each start line holds exec before the job", () => {
  const config = mkdtempSync(join(scratch, "started-"))
  mkdirSync(join(dataOf(config), "ops"), { recursive: true })
  const child = Bun.spawnSync(["python3", "-I", "-c", STARTED, upPy], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: scratch,
      PATH: "/usr/bin:/bin",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(child.stderr.toString()).toBe("")
  const { hr, run } = JSON.parse(child.stdout.toString())
  const herdrLine = hr.find((c: unknown[]) => c[1] === "run")[3]
  const splitArgv = run.find((argv: string[]) => argv[1] === "new-split")
  const workspaceArgv = run.find((argv: string[]) => argv[1] === "new-workspace")
  const lineOf = (argv: string[]): string => argv[argv.indexOf("--command") + 1]
  expect(herdrLine).toContain("ops-h")
  expect(herdrLine).toContain("&& exec python3 -I ")
  expect(lineOf(splitArgv)).toContain("ops-c")
  expect(lineOf(splitArgv)).toContain("&& exec python3 -I ")
  expect(lineOf(workspaceArgv)).toContain("ops-n")
  expect(lineOf(workspaceArgv)).toMatch(/^exec python3 -I /)
})

// a failed or empty lsof read changes nothing.
test("an empty lsof read leaves every job alone", () => {
  const config = mkdtempSync(join(scratch, "deleted-empty-"))
  const ops = join(dataOf(config), "ops")
  mkdirSync(ops, { recursive: true })
  writeFileSync(
    join(ops, "jobs.json"),
    JSON.stringify({
      jobs: [
        {
          command: "bash /x/ops-x.sh",
          heartbeat: "ops-x",
          name: "ops-x",
          runtime: "herdr",
        },
      ],
    }),
  )
  writeFileSync(join(ops, "ops-x.json"), JSON.stringify({ pid: 4302 }))
  for (const listing of ["", "lsof: WARNING: can't stat() /nowhere"]) {
    const child = Bun.spawnSync(["python3", "-I", "-c", DELETED, upPy, listing], {
      env: {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
        HOME: scratch,
        PATH: "/usr/bin:/bin",
      },
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(child.stderr.toString()).toBe("")
    expect(JSON.parse(child.stdout.toString())).toEqual({
      calls: [],
      kills: [],
      started: [],
    })
  }
})

// Loads up.py and runs one render of jobs.json from the store.
const RENDER = `${LOAD}up.render_jobs()
`

test("a pass renders jobs.json from the store, keeps it when the store has no policy.json yet, and keeps the last one with the reason in up.log when the set is refused", async () => {
  const { writeRoot } = await import("../../../packages/settings/src/folder")
  const { extensionsDir } = await import("../../../packages/settings/src/rendered")
  const config = join(scratch, "config-render")
  const data = dataOf(config)
  const ops = join(data, "ops")
  mkdirSync(ops, { recursive: true })
  writeFileSync(join(ops, "jobs.json"), JSON.stringify({ jobs: [{ name: "ops-company" }] }))
  const policy = JSON.stringify({ orgs: {}, schemaVersion: 1, values: {} })
  writeRoot(extensionsDir(data), new Map([["policy.json", policy]]))
  const pass = () =>
    Bun.spawnSync(["python3", "-I", "-c", RENDER, upPy], {
      env: {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
        HOME: scratch,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      },
      stderr: "pipe",
    })
  expect(pass().stderr.toString()).toBe("")
  const names = JSON.parse(readFileSync(join(ops, "jobs.json"), "utf8")).jobs.map(
    (job: { name: string }) => job.name,
  )
  expect(names).toContain("ops-company")
  expect(names).toContain("ops-tick")
  expect(readFileSync(join(ops, "up.log"), "utf8")).toContain("jobs: rendered jobs.json")
  const rendered = readFileSync(join(ops, "jobs.json"), "utf8")
  writeRoot(extensionsDir(data), new Map([["policy.json", null]]))
  expect(pass().stderr.toString()).toBe("")
  expect(readFileSync(join(ops, "jobs.json"), "utf8")).toBe(rendered)
  expect(readFileSync(join(ops, "up.log"), "utf8")).not.toContain("jobs.json kept: ")
  writeRoot(extensionsDir(data), new Map([["policy.json", "{"]]))
  expect(pass().stderr.toString()).toBe("")
  expect(readFileSync(join(ops, "jobs.json"), "utf8")).toBe(rendered)
  expect(readFileSync(join(ops, "up.log"), "utf8")).toContain("jobs.json kept: ")
})

test("a pass writes jobs.json into the data folder dataDir() resolves, playground over an old dispatcher beside it", () => {
  const config = join(scratch, "config-fresh")
  mkdirSync(join(config, "dispatcher", "ops"), { recursive: true })
  mkdirSync(join(config, "playground"), { recursive: true })
  const pass = Bun.spawnSync(["python3", "-I", "-c", RENDER, upPy], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: scratch,
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    },
    stderr: "pipe",
  })
  expect(pass.stderr.toString()).toBe("")
  expect(existsSync(join(config, "playground", "ops", "jobs.json"))).toBe(true)
  expect(readFileSync(join(config, "playground", "ops", "up.log"), "utf8")).toContain(
    "jobs: rendered jobs.json",
  )
  expect(existsSync(join(config, "dispatcher", "ops", "jobs.json"))).toBe(false)
})

// Loads up.py and prints --sessions' resume lines, with no session running, no factory session unguarded and no checkout around a cwd.
const RESUMES = `${LOAD}up.unguarded = lambda: []
up.run = lambda argv, timeout=60: (1, "")
up.sessions()
`

test("a resume reads the roster and its backend pin from the data folder spawn.sh keeps them in, PLAYGROUND_DATA_DIR's when set", () => {
  const config = join(scratch, "config-pins")
  const data = join(scratch, "data-pins")
  mkdirSync(join(data, "backends"), { recursive: true })
  writeFileSync(
    join(data, "roster.json"),
    JSON.stringify({
      agents: [
        { name: "p1-worker", status: "working" },
        { name: "p2-worker", status: "working" },
      ],
    }),
  )
  for (const name of ["p1-worker", "p2-worker"]) {
    mkdirSync(join(config, "projects", name), { recursive: true })
    writeFileSync(
      join(config, "projects", name, `s-${name}.jsonl`),
      `${JSON.stringify({ agentName: name, cwd: "/nowhere", model: "glm-5.3-flash" })}\n`,
    )
  }
  writeFileSync(join(data, "backends", "p1-worker"), "glm\n")
  const child = Bun.spawnSync(["python3", "-I", "-c", RESUMES, upPy], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      HOME: scratch,
      PATH: "/usr/bin:/bin",
      PLAYGROUND_DATA_DIR: data,
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(child.stderr.toString()).toBe("")
  const lines = child.stdout.toString().split("\n")
  expect(lines.find((line) => line.includes(" resume p1-worker "))).toEndWith(" s-p1-worker")
  expect(lines.find((line) => line.includes(" resume p2-worker "))).toEndWith(
    " s-p2-worker --backend glm",
  )
})
