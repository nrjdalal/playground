import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  moveDataFolder,
  moveMachine,
  movedJobs,
  type Table,
} from "../../../../../packages/scripts/src/playground/migrate-machine"
import { mustGit } from "../../../../../packages/settings/src/folder"

const scratch = mkdtempSync(join(tmpdir(), "playground-migrate-machine-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const write = (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}
const read = (path: string) => readFileSync(path, "utf8")

// A made-up table that exercises every key the real one holds.
const TABLE: Table = {
  dataFolders: ["oldhome", "olderhome"],
  droppedEnv: ["OLDCO_SOURCES"],
  droppedJobs: ["ops-gone"],
  env: [{ from: "PANEL_EVERY_MIN", to: "BOARD_EVERY_MIN" }],
  envPrefix: { from: "OLDCO_", to: "NEWCO_" },
  files: [
    { from: "ops/board/panel.pid", to: "ops/board/board.pid" },
    { from: "ops/feed/runs", to: "ops/stream/runs" },
    { from: "ops/ops-panel.json", to: "ops/ops-board.json" },
  ],
  job: {
    name: { from: "ops-panel", to: "ops-board" },
    script: { from: "/scripts/ops/panel/", to: "/scripts/ops/board/" },
    setting: { from: "jobs.opsPanel", to: "jobs.opsBoard" },
    stop: { from: "panel", to: "board" },
  },
  jobs: [
    {
      command: "~/.playground/extensions/acme/scripts/stream/run.sh",
      cwd: "~/.playground/extensions/acme/scripts/stream",
      from: "ops-feed",
      to: "ops-stream",
    },
  ],
  linkConverter: "python3 ~/tools/links.py",
  staleCopies: ["ops/feed/cache", "ops/feed/feed.py", "ops/panel/run.sh", "ops/once.py"],
  stateFolder: { from: "ops/panel", to: "ops/board" },
}

const PANEL = {
  command: "~/code/factory/scripts/ops/panel/run.sh",
  cwd: "~/code/factory/.claude/worktrees/live",
  heartbeat: "ops-panel",
  name: "ops-panel",
  stop: "panel",
}
const COMPANY = {
  command: "python3 -I ~/.claude/olderhome/ops/tickets/run.py",
  cwd: "~/.claude/oldhome/ops/tickets",
  heartbeat: "ops-tickets",
  name: "ops-tickets",
}
const AWAKE = { heartbeat: "ops-awake", launchd: "com.example.ops-awake", name: "ops-awake" }
const FEED = {
  command: "~/.claude/olderhome/ops/feed/run.sh",
  cwd: "~/.claude/olderhome/ops/feed",
  env: { PANEL_EVERY_MIN: "5" },
  heartbeat: "ops-feed",
  name: "ops-feed",
}
const JOBS = { jobs: [AWAKE, PANEL, { name: "ops-gone" }, COMPANY, FEED] }

// A data folder as the live machine holds it: jobs.json, the stale copies beside the job's state, its files, and a login.
const dataWith = (name: string) => {
  const data = join(scratch, name)
  write(data, {
    "extensions/login": "octo-owner\n",
    "ops/jobs.json": JSON.stringify(JOBS),
    "ops/once.py": "old once\n",
    "ops/ops-panel.json": "{}\n",
    "ops/panel/panel.pid": "42\n",
    "ops/panel/run.sh": "old run\n",
    "ops/panel/supervisor.log": "rolled\n",
    "ops/feed/cache/a.pyc": "old cache\n",
    "ops/feed/runs/1.json": "{}\n",
  })
  symlinkSync(join(scratch, "nowhere.py"), join(data, "ops", "feed", "feed.py"))
  return data
}

const homeWith = (name: string) => {
  const home = join(scratch, name)
  write(home, {
    ".bashrc": "export PATH=/bin\n",
    ".zshrc": "export OLDCO_PLANS_DIR=~/plans\nexport OLDCO_LOAD_MULT=2\nexport OLDCO_SOURCES=x\n",
    "Library/LaunchAgents/com.example.ops-flow.plist":
      "<key>OLDCO_MERGE_QUEUE</key><string>on</string>\n<string>~/.claude/oldhome/ops/flow.py</string>\n<key>PANEL_EVERY_MIN</key>\n",
  })
  return home
}

describe("migrate's machine half", () => {
  test("jobs.json: the Dashboard's job takes its new name, a dropped one goes, the company jobs read the playground folder", () => {
    const moved = movedJobs(TABLE, JSON.stringify(JOBS))
    expect(JSON.parse(moved.text).jobs).toEqual([
      AWAKE,
      {
        command: "~/code/factory/scripts/ops/board/run.sh",
        cwd: "~/code/factory/.claude/worktrees/live",
        heartbeat: "ops-board",
        name: "ops-board",
        stop: "board",
      },
      {
        command: "python3 -I ~/.playground/ops/tickets/run.py",
        cwd: "~/.playground/ops/tickets",
        heartbeat: "ops-tickets",
        name: "ops-tickets",
      },
      {
        command: "~/.playground/extensions/acme/scripts/stream/run.sh",
        cwd: "~/.playground/extensions/acme/scripts/stream",
        env: { BOARD_EVERY_MIN: "5" },
        heartbeat: "ops-stream",
        name: "ops-stream",
      },
    ])
    expect(moved.lines).toEqual([
      "~ job ops-panel as ops-board",
      "- job ops-gone: dropped",
      "~ job ops-tickets",
      "~ job ops-feed as ops-stream",
    ])
  })

  test("a run archives the stale copies, moves the state and its files, and renames the machine's variables", () => {
    const data = dataWith("run")
    const home = homeWith("home")
    const steps = moveMachine(data, "octo-owner", home, TABLE, false)
    expect(steps.every((step) => step.ok)).toBe(true)
    for (const path of ["ops/panel/run.sh", "ops/once.py", "ops/feed/cache/a.pyc"]) {
      expect(read(join(data, "archive", path))).toStartWith("old ")
      expect(existsSync(join(data, path))).toBe(false)
    }
    expect(readlinkSync(join(data, "archive", "ops", "feed", "feed.py"))).toBe(
      join(scratch, "nowhere.py"),
    )
    expect(
      lstatSync(join(data, "ops", "feed", "feed.py"), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(read(join(data, "ops", "stream", "runs", "1.json"))).toBe("{}\n")
    expect(existsSync(join(data, "ops", "board", "run.sh"))).toBe(false)
    expect(existsSync(join(data, "ops", "panel"))).toBe(false)
    expect(read(join(data, "ops", "board", "supervisor.log"))).toBe("rolled\n")
    expect(read(join(data, "ops", "board", "board.pid"))).toBe("42\n")
    expect(existsSync(join(data, "ops", "ops-board.json"))).toBe(true)
    expect(existsSync(join(data, "ops", "ops-panel.json"))).toBe(false)
    expect(
      JSON.parse(read(join(data, "ops", "jobs.json"))).jobs.map(
        (job: { name: string }) => job.name,
      ),
    ).toEqual(["ops-awake", "ops-board", "ops-tickets", "ops-stream"])
    expect(read(join(home, ".zshrc"))).toBe(
      "export NEWCO_PLANS_DIR=~/plans\nexport NEWCO_LOAD_MULT=2\nexport NEWCO_SOURCES=x\n",
    )
    expect(steps.map((step) => step.line)).toContain(
      `! ${join(home, ".zshrc")} sets OLDCO_SOURCES, which nothing reads now: move its words into its list`,
    )
    expect(read(join(home, ".zshrc.pre-migrate"))).toContain("OLDCO_PLANS_DIR")
    expect(read(join(home, "Library/LaunchAgents/com.example.ops-flow.plist"))).toBe(
      "<key>NEWCO_MERGE_QUEUE</key><string>on</string>\n<string>~/.playground/ops/flow.py</string>\n<key>BOARD_EVERY_MIN</key>\n",
    )
    expect(steps.map((step) => step.line)).toContain(
      `~ ${join(home, "Library/LaunchAgents/com.example.ops-flow.plist")}: NEWCO_MERGE_QUEUE, BOARD_EVERY_MIN, its paths into the data folder, its old copy in ${join(home, "Library/LaunchAgents/com.example.ops-flow.plist")}.pre-migrate`,
    )
    expect(existsSync(join(home, ".bashrc.pre-migrate"))).toBe(false)
    expect(moveMachine(data, "octo-owner", home, TABLE, false)).toEqual([])
  })

  test("a dry run says each move and makes none", () => {
    const data = dataWith("dry")
    const home = homeWith("dry-home")
    const lines = moveMachine(data, "octo-owner", home, TABLE, true).map((step) => step.line)
    expect(lines).toContain("~ ops/panel moved to ops/board")
    expect(lines).toContain("~ ops/board/panel.pid moved to ops/board/board.pid")
    expect(lines).toContain(
      `~ ${join(home, ".zshrc")}: NEWCO_PLANS_DIR, NEWCO_LOAD_MULT, its old copy in ${join(home, ".zshrc")}.pre-migrate`,
    )
    expect(read(join(data, "ops", "jobs.json"))).toBe(JSON.stringify(JOBS))
    expect(existsSync(join(data, "ops", "panel", "panel.pid"))).toBe(true)
    expect(existsSync(join(data, "ops", "once.py"))).toBe(true)
    expect(read(join(home, ".zshrc"))).toContain("OLDCO_PLANS_DIR")
  })

  test("a state folder already at its new name stops the move by name", () => {
    const data = dataWith("both")
    write(data, { "ops/board/supervisor.log": "new\n" })
    const steps = moveMachine(data, "octo-owner", homeWith("both-home"), TABLE, false)
    expect(steps).toContainEqual({
      line: "- ops/panel: ops/board already exists, so neither moved",
      ok: false,
    })
    expect(read(join(data, "ops", "panel", "supervisor.log"))).toBe("rolled\n")
  })

  test("the old data folder in Claude's config folder moves to ~/.playground, and each old name becomes a link to it", () => {
    const config = join(scratch, "home", ".claude")
    write(config, { "oldhome/roster.json": "{}\n" })
    symlinkSync("oldhome", join(config, "olderhome"))
    const data = join(scratch, "home", ".playground")
    const dry = moveDataFolder(data, config, TABLE, true)
    expect(dry).toEqual({
      data: join(config, "oldhome"),
      steps: [
        {
          line: `~ ${join(config, "oldhome")} moved to ${data}, its old names left as links to it`,
          ok: true,
        },
      ],
    })
    expect(lstatSync(data, { throwIfNoEntry: false })).toBeUndefined()
    expect(moveDataFolder(data, config, TABLE, false).data).toBe(data)
    expect(lstatSync(data).isDirectory()).toBe(true)
    expect(read(join(data, "roster.json"))).toBe("{}\n")
    for (const name of TABLE.dataFolders) expect(readlinkSync(join(config, name))).toBe(data)
    expect(read(join(config, "olderhome", "roster.json"))).toBe("{}\n")
    expect(moveDataFolder(data, config, TABLE, false)).toEqual({ data, steps: [] })
  })

  test("a ~/.playground folder already there stops the move by name", () => {
    const home = join(scratch, "both-home")
    write(home, { ".claude/oldhome/a": "old\n", ".playground/b": "new\n" })
    const config = join(home, ".claude")
    const data = join(home, ".playground")
    expect(moveDataFolder(data, config, TABLE, false).steps).toEqual([
      { line: `- ${join(config, "oldhome")}: ${data} already exists, so neither moved`, ok: false },
    ])
    expect(read(join(config, "oldhome", "a"))).toBe("old\n")
    expect(moveDataFolder(join(home, "data"), config, TABLE, false)).toEqual({
      data: join(home, "data"),
      steps: [],
    })
  })

  test("the job's setting row in the login's scope takes its new key", () => {
    const data = dataWith("setting")
    write(data, {
      "extensions/octo-owner/settings.json": JSON.stringify({ "jobs.opsPanel": PANEL }),
    })
    mustGit(join(data, "extensions", "octo-owner"), ["init", "-q", "-b", "main"])
    const lines = moveMachine(data, "octo-owner", homeWith("setting-home"), TABLE, true).map(
      (step) => step.line,
    )
    expect(lines).toContain("~ setting jobs.opsPanel at octo-owner as jobs.opsBoard")
  })
})
