import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import * as cmux from "../../../../../../api/hono/src/lib/dashboard/cmux"
import {
  attachment,
  CMUX_APP,
  cmuxCommand,
  cmuxFailure,
  cmuxHeldOf,
  holdsKeystroke,
  isReadCommand,
  processTableOf,
  replyCommand,
  stream,
  writeCommand,
} from "../../../../../../api/hono/src/lib/dashboard/cmux"
import { startOf } from "../../../../../../api/hono/src/lib/dev/stop"

const SURFACE = "42A9D5E3-E49A-454C-80E6-8884E5ACCC92"

// whether a session is live in cmux, read from ps and Claude's registry once cmux will not answer the launcher
// Claude Code makes its sessions folder with a session's first registry file, so a Mac where none ever ran has no folder, and with cmux running the launcher's herdr-alone fallback once refused there for an unreadable registry.
test("cmuxHeld reads a sessions folder that does not exist yet as holding no session, while cmux runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmux-held-"))
  try {
    writeFileSync(
      join(dir, "ps"),
      `#!/bin/sh\necho "    1     0 Sat Oct 10 18:52:15 2026     /sbin/launchd"\necho "  500     1 Sat Oct 10 18:53:00 2026     ${CMUX_APP}"\n`,
    )
    chmodSync(join(dir, "ps"), 0o755)
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `const { cmuxHeld } = await import(${JSON.stringify(join(import.meta.dir, "../../../../../../api/hono/src/lib/dashboard/cmux.ts"))}); console.log(JSON.stringify(await cmuxHeld(${JSON.stringify(join(dir, "sessions"))})))`,
      ],
      {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, PLAYGROUND_DATA_DIR: dir },
        stderr: "pipe",
        stdout: "pipe",
      },
    )
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect([code, err]).toEqual([0, ""])
    expect(JSON.parse(out)).toEqual([])
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 30_000)

describe("cmuxHeldOf", () => {
  const START = "Mon Oct 19 01:00:00 2026"
  const ps = [
    `    1     0 Sat Oct 10 18:52:15 2026     /sbin/launchd`,
    `  500     1 Sat Oct 10 18:53:00 2026     ${CMUX_APP}`,
    `  510   500 Sat Oct 10 18:53:01 2026     /bin/zsh`,
    `  520   510 Mon Oct  5 01:00:00 2026     /Users/me/.bun/bin/claude`,
    `  530   510 ${START}     /Users/me/.bun/bin/claude`,
    `  600     1 Sat Oct 10 18:54:00 2026     /Users/me/.local/bin/herdr`,
    `  610   600 ${START}     /Users/me/.bun/bin/claude`,
    `  700     1 ${START}     /usr/local/bin/cmux`,
    `  710   700 ${START}     /Users/me/.bun/bin/claude`,
  ].join("\n")
  const file = (pid: number, name: string, procStart = START) => ({
    pid,
    text: JSON.stringify({ name, pid, procStart, sessionId: `s-${pid}` }),
  })

  test("reads ps's pid, parent, start (one-digit days included) and executable, a path with spaces kept whole", () => {
    const table = processTableOf(
      `${ps}\n  800     1 ${START}     /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\nnot a row`,
    )
    expect(table.get(520)).toEqual({
      exe: "/Users/me/.bun/bin/claude",
      ppid: 510,
      start: "Mon Oct 5 01:00:00 2026",
    })
    expect(table.get(800)?.exe).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    expect(table.size).toBe(10)
  })

  test("names the live sessions under the cmux app alone: not herdr's, not one under the cmux CLI's binary, not an ended one whose pid moved on", () => {
    const files = [
      file(520, "builder", "Mon Oct  5 01:00:00 2026"),
      file(530, "ended", "Sun Oct 18 09:00:00 2026"),
      file(610, "worker-herdr"),
      file(710, "cli-child"),
      file(999, "gone"),
    ]
    expect(cmuxHeldOf(files, processTableOf(ps), [])).toEqual(["builder"])
  })

  test("counts a file mid-rewrite under cmux by its pid, so a session cmux holds is never missed", () => {
    expect(
      cmuxHeldOf(
        [
          { pid: 530, text: "{ half" },
          { pid: 610, text: null },
        ],
        processTableOf(ps),
        [],
      ),
    ).toEqual(["pid 530"])
  })

  // a session of the owner's own under cmux leaves the launcher on herdr alone, while a factory one, placed as the hooks place it, still holds cmux
  test("names only the factory's sessions: by the roster's kind for the name, else the name itself", () => {
    const table = processTableOf(
      [540, 550, 560, 570, 580].map((pid) => `  ${pid}   510 ${START}     claude`).join("\n") +
        `\n${ps}`,
    )
    const files = [
      file(540, "fix the sidebar"),
      {
        pid: 550,
        text: JSON.stringify({
          cwd: "/Users/me/dispatcher",
          pid: 550,
          procStart: START,
          sessionId: "s-550",
        }),
      },
      file(560, "worker-brave-otter"),
      file(570, "x7mh4d-builder"),
      file(580, "builder"),
    ]
    const roster = [
      { kind: "builder", name: "x7mh4d-builder" },
      { kind: "not a kind", name: "fix the sidebar" },
    ]
    expect(cmuxHeldOf(files, table, roster)).toEqual([
      "worker-brave-otter",
      "x7mh4d-builder",
      "builder",
    ])
    expect(cmuxHeldOf(files.slice(0, 2), table, roster)).toEqual([])
  })

  test("reads the roster raw, as the hooks do, so a kind-only agent in a roster readRoster() rejects still holds cmux", async () => {
    const root = mkdtempSync(join(tmpdir(), "cmux-held-"))
    try {
      const agents = [{ kind: "builder", name: "x7mh4d-builder" }]
      const roster = join(root, "roster.json")
      writeFileSync(roster, JSON.stringify({ agents }))
      const read = await cmux.rosterAgents(roster)
      expect(read).toEqual(agents)
      const table = processTableOf(`  570   510 ${START}     claude\n${ps}`)
      expect(cmuxHeldOf([file(570, "x7mh4d-builder")], table, read)).toEqual(["x7mh4d-builder"])
      rmSync(roster)
      expect(await cmux.rosterAgents(roster)).toEqual([])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test("holds none when the cmux app runs nowhere, registry or not, and is not known when the registry cannot be read while it runs", () => {
    const noApp = processTableOf(
      ps
        .split("\n")
        .filter((line) => !line.includes(CMUX_APP))
        .join("\n"),
    )
    expect(cmuxHeldOf([file(520, "builder")], noApp, [])).toEqual([])
    expect(cmuxHeldOf(null, noApp, [])).toEqual([])
    expect(cmuxHeldOf(null, processTableOf(ps), [])).toBeNull()
  })
})

describe("isReadCommand", () => {
  test("the reads the dashboard makes are allowed", () => {
    expect(isReadCommand(["sessions", "list", "--json"])).toBe(true)
    expect(isReadCommand(["list-workspaces", "--json"])).toBe(true)
    expect(isReadCommand(["rpc", "feed.list", "{}"])).toBe(true)
    expect(isReadCommand(["read-screen", "--surface", "S"])).toBe(true)
    expect(isReadCommand(["events", "--category", "agent"])).toBe(true)
  })

  test("no read drives a session: the writes go through writeCommand alone", () => {
    const writes = [
      ["send", "--workspace", "workspace:5", "hi"],
      ["send-key", "Enter"],
      ["new-workspace", "--command", "claude"],
      ["close-workspace", "--workspace", "workspace:5"],
      ["rpc", "feed.question.reply", "{}"],
      ["rpc", "feed.permission.reply", "{}"],
      ["sessions", "debug"],
      ["events", "--cursor-file", "/tmp/cursor"],
      ["events", "--cursor-file=/tmp/cursor"],
      [],
    ]
    for (const args of writes) expect(isReadCommand(args)).toBe(false)
  })
})

describe("cmuxCommand", () => {
  test("builds the argv for a read and throws for anything else", () => {
    expect(cmuxCommand(["sessions", "list"])).toEqual(["cmux", "sessions", "list"])
    expect(() => cmuxCommand(["send", "hi"])).toThrow("is not a read")
  })
})

describe("writeCommand", () => {
  test("types text or Enter or Shift+Enter into one surface, with -- before whatever is typed", () => {
    expect(writeCommand({ surface: SURFACE, text: "-n hi" })).toEqual([
      "cmux",
      "send",
      "--surface",
      SURFACE,
      "--",
      "-n hi",
    ])
    expect(writeCommand({ key: "enter", surface: SURFACE })).toEqual([
      "cmux",
      "send-key",
      "--surface",
      SURFACE,
      "--",
      "enter",
    ])
    expect(writeCommand({ key: "shift+enter", surface: SURFACE })[5]).toBe("shift+enter")
  })

  test("a forced send passes --force before the --, so cmux's draft guard lets every text send of a message through, the first included", () => {
    expect(writeCommand({ force: true, surface: SURFACE, text: "line two" })).toEqual([
      "cmux",
      "send",
      "--surface",
      SURFACE,
      "--force",
      "--",
      "line two",
    ])
    expect(writeCommand({ force: false, surface: SURFACE, text: "hi" })).not.toContain("--force")
  })

  test("refuses any other surface form, key or keystroke-bearing text", () => {
    const refused = [
      { surface: "surface:3", text: "hi" },
      { surface: "", text: "hi" },
      { surface: `${SURFACE} --workspace x`, text: "hi" },
      { key: "ctrl+c", surface: SURFACE },
      { key: "escape", surface: SURFACE },
      { surface: SURFACE, text: "" },
      { surface: SURFACE, text: "submit\\nearly" },
      { surface: SURFACE, text: "real\nnewline" },
      { surface: SURFACE, text: "tab\there" },
      { surface: SURFACE, text: "escape \u001b[2J" },
    ]
    for (const step of refused) expect(() => writeCommand(step as never)).toThrow()
  })
})

describe("holdsKeystroke", () => {
  test("only cmux's three escapes and control characters count", () => {
    expect(holdsKeystroke("a\\nb")).toBe(true)
    expect(holdsKeystroke("a\\rb")).toBe(true)
    expect(holdsKeystroke("a\\tb")).toBe(true)
    expect(holdsKeystroke("a\u0007b")).toBe(true)
    expect(holdsKeystroke("a\u0085b")).toBe(true)
    expect(holdsKeystroke("a\u009bb")).toBe(true)
    expect(holdsKeystroke("a\\N \\e \\x41 \\")).toBe(false)
    expect(holdsKeystroke("café 🙂")).toBe(false)
  })
})

describe("cmuxFailure", () => {
  test("cmux's access-denied answer says to start the dashboard inside cmux", () => {
    const err = cmuxFailure(
      ["sessions", "list"],
      "Error: ERROR: Access denied - only processes started inside cmux can connect",
    )
    expect(err.code).toBe("CMUX_UNAVAILABLE")
    expect(err.status).toBe(503)
  })

  test("any other failure is CMUX_FAILED with cmux's own words", () => {
    const err = cmuxFailure(["read-screen"], "no such surface")
    expect(err.code).toBe("CMUX_FAILED")
    expect(err.message).toContain("no such surface")
  })

  test("a failure that printed nothing still says why", () => {
    expect(cmuxFailure(["sessions", "list"], "").message).toBe(
      "cmux sessions failed: no answer from cmux",
    )
  })
})

// list-windows is a harmless read cmux has, so a regressed guard would run it and nothing worse
test("stream() takes only the reads, as run() does", () => {
  expect(() => stream(["list-windows"])).toThrow("is not a read")
})

// A cmux of the test's own on PATH, standing in for one that will not start, hangs, or fails some other way: each is judged by what it does, not by the error code a failed spawn shares with a refusal.
const withFakeCmux = async (script: string, run: () => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "cmux-fake-"))
  const path = process.env.PATH
  try {
    writeFileSync(join(dir, "cmux"), script)
    chmodSync(join(dir, "cmux"), 0o755)
    process.env.PATH = `${dir}:${path}`
    await run()
  } finally {
    process.env.PATH = path
    rmSync(dir, { force: true, recursive: true })
  }
}

// `sessions list` took 12.7s at load 19 (9 Oct), and the board waits on it, so a read slower than the old 5s is read, not killed
test("run() waits past 5s for a read", async () => {
  const live = process.env.PLAYGROUND_LIVE_READS
  process.env.PLAYGROUND_LIVE_READS = "1"
  try {
    await withFakeCmux("#!/bin/sh\nsleep 6\necho '[]'\n", async () => {
      expect(await cmux.run(["sessions", "list", "--json"])).toBe("[]\n")
    })
  } finally {
    if (live === undefined) delete process.env.PLAYGROUND_LIVE_READS
    else process.env.PLAYGROUND_LIVE_READS = live
  }
}, 30_000)

// A CLI that traps TERM, or a child holding its stdout open, must not hold the read past its timeout: the kill is bounded
test("run() settles when the CLI traps TERM, killed after a short grace", async () => {
  const live = process.env.PLAYGROUND_LIVE_READS
  process.env.PLAYGROUND_LIVE_READS = "1"
  try {
    await withFakeCmux("#!/bin/sh\ntrap '' TERM\nsleep 20 &\nwait\n", async () => {
      const started = Date.now()
      const error = await cmux.run(["sessions", "list", "--json"], 300).catch((e) => e)
      expect(error).toBeInstanceOf(cmux.CmuxTimedOut)
      expect(Date.now() - started).toBeLessThan(15_000)
    })
  } finally {
    if (live === undefined) delete process.env.PLAYGROUND_LIVE_READS
    else process.env.PLAYGROUND_LIVE_READS = live
  }
}, 30_000)

test("attachment() settles when the CLI traps TERM, as unreachable", async () => {
  const live = process.env.PLAYGROUND_LIVE_READS
  process.env.PLAYGROUND_LIVE_READS = "1"
  try {
    await withFakeCmux("#!/bin/sh\ntrap '' TERM\nsleep 20 &\nwait\n", async () => {
      const started = Date.now()
      expect(await attachment(300)).toEqual({
        detail: "no answer within 0.3s",
        state: "unreachable",
      })
      expect(Date.now() - started).toBeLessThan(15_000)
    })
  } finally {
    if (live === undefined) delete process.env.PLAYGROUND_LIVE_READS
    else process.env.PLAYGROUND_LIVE_READS = live
  }
}, 30_000)

// deliver.ts retries a send that cmux exited with a refusal for, and never one killed at its timeout, whose text may have landed anyway
describe("write() failures", () => {
  const SURFACE = "77BD77D9-0000-4000-8000-000000000001"
  const live = async (run: () => Promise<void>) => {
    const was = process.env.PLAYGROUND_LIVE_READS
    process.env.PLAYGROUND_LIVE_READS = "1"
    try {
      await run()
    } finally {
      if (was === undefined) delete process.env.PLAYGROUND_LIVE_READS
      else process.env.PLAYGROUND_LIVE_READS = was
    }
  }

  test("a send killed at its timeout is a CmuxTimedOut, reading as the usual no-answer failure", async () => {
    await live(() =>
      withFakeCmux("#!/bin/sh\nexec sleep 10\n", async () => {
        const error = await cmux.write({ surface: SURFACE, text: "hi" }, 300).catch((e) => e)
        expect(error).toBeInstanceOf(cmux.CmuxTimedOut)
        expect(error).toMatchObject({ code: "CMUX_FAILED" })
        expect(error.message).toBe("cmux send failed: no answer from cmux")
      }),
    )
  })

  test("a send cmux exits with a refusal for is not a CmuxTimedOut, and carries cmux's words", async () => {
    await live(() =>
      withFakeCmux(
        "#!/bin/sh\necho 'send: the agent prompt holds text someone is typing' >&2\nexit 1\n",
        async () => {
          const error = await cmux.write({ surface: SURFACE, text: "hi" }).catch((e) => e)
          expect(error).not.toBeInstanceOf(cmux.CmuxTimedOut)
          expect(error.message).toContain("holds text someone is typing")
        },
      ),
    )
  })
})

describe("attachment", () => {
  test("is missing when no cmux is on PATH", async () => {
    const path = process.env.PATH
    process.env.PATH = "/nonexistent"
    try {
      expect(await attachment()).toEqual({
        detail: "cmux is not installed or not on PATH",
        state: "missing",
      })
    } finally {
      process.env.PATH = path
    }
  })

  test("is missing when cmux on PATH will not start, rather than detached", async () => {
    await withFakeCmux("#!/nonexistent/interpreter\n", async () => {
      const reach = await attachment()
      expect(reach.state).toBe("missing")
    })
  })

  test("is unreachable, in cmux's own words, when it fails for any other reason", async () => {
    await withFakeCmux("#!/bin/sh\necho 'Error: socket not found' >&2\nexit 1\n", async () => {
      expect(await attachment()).toEqual({
        detail: "Error: socket not found",
        state: "unreachable",
      })
    })
  })

  test("is unreachable, saying so, when cmux does not answer in time", async () => {
    await withFakeCmux("#!/bin/sh\nexec sleep 10\n", async () => {
      expect(await attachment(300)).toEqual({
        detail: "no answer within 0.3s",
        state: "unreachable",
      })
    })
  })

  // cmux answers by ancestry, so these run only where a token-free read is answered: inside one of its terminals, as the factory's sessions are; on a CI runner there is no cmux to ask.
  const inCmux =
    Bun.which("cmux") !== null &&
    Bun.spawnSync(["cmux", "list-workspaces"], {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("CMUX_")),
      ),
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    }).exitCode === 0

  test.skipIf(!inCmux)(
    "is attached in a process that descends from a cmux terminal, with no CMUX_ variable",
    async () => {
      expect(await attachment()).toEqual({ state: "attached" })
    },
  )

  // A middle process starts the reader and exits at once, so launchd adopts it, as it adopts a stack started with `( … &)`. The reader waits until it is adopted before it reads. It is this test's own grandchild, so this test ends it, should it outlive the wait, by its pid and only while that pid has the start time it had.
  test.skipIf(!inCmux)(
    "is detached in a process launchd adopted",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "cmux-attachment-"))
      const pidFile = join(dir, "pid")
      const out = join(dir, "out.json")
      const reader = `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid))
for (let i = 0; i < 100 && process.ppid !== 1; i++) await Bun.sleep(50)
const { attachment } = await import(${JSON.stringify(join(import.meta.dir, "../../../../../../api/hono/src/lib/dashboard/cmux.ts"))})
await Bun.write(${JSON.stringify(out)}, JSON.stringify({ ppid: process.ppid, reach: await attachment() }))`
      let pid = 0
      let started: string | null = null
      try {
        Bun.spawnSync(
          [
            "bun",
            "-e",
            `Bun.spawn(["bun", "-e", ${JSON.stringify(reader)}], { stdio: ["ignore", "ignore", "ignore"] }).unref()`,
          ],
          { stdin: "ignore" },
        )
        for (let i = 0; i < 100 && !(await Bun.file(pidFile).exists()); i++) await Bun.sleep(25)
        pid = Number(await Bun.file(pidFile).text())
        started = startOf(pid)
        for (let i = 0; i < 300 && !(await Bun.file(out).exists()); i++) await Bun.sleep(50)
        const { ppid, reach } = await Bun.file(out).json()
        expect(ppid).toBe(1)
        expect(reach.state).toBe("detached")
      } finally {
        if (!(await Bun.file(out).exists()) && pid && started && startOf(pid) === started) {
          process.kill(pid, "SIGKILL")
        }
        rmSync(dir, { force: true, recursive: true })
      }
    },
    30_000,
  )
})

// Only cmux.ts spawns cmux: everything else reads and writes through run(), runJson(), stream() and write(), whose argv cmux.ts builds and checks.
const ROOT = join(import.meta.dir, "../../../../../..")
const CMUX = "api/hono/src/lib/dashboard/cmux.ts"
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
// deadCodeElimination stays off: with it on, the transpiler inlines NODE_ENV and drops the branch that cannot run, so a dev-only spawn would vanish under CI's NODE_ENV=production
const transpilers = {
  js: new Bun.Transpiler({ deadCodeElimination: false, loader: "js" }),
  jsx: new Bun.Transpiler({ deadCodeElimination: false, loader: "jsx" }),
  ts: new Bun.Transpiler({ deadCodeElimination: false, loader: "ts" }),
  tsx: new Bun.Transpiler({ deadCodeElimination: false, loader: "tsx" }),
}

// Code with its comments and types gone and its strings and imports kept, so a comment that names cmux crosses nothing.
const codeOf = (path: string, source: string): string => {
  const ext = path.split(".").at(-1) ?? "ts"
  const loader = ext.includes("x")
    ? ext.includes("t")
      ? "tsx"
      : "jsx"
    : ext.includes("t")
      ? "ts"
      : "js"
  try {
    return transpilers[loader].transformSync(source)
  } catch {
    return source
  }
}

// Module specifiers: static, side-effect and dynamic imports and re-exports, set aside before looking for a cmux path, since "@/lib/dashboard/cmux" names the module, not the binary.
const SPECIFIER =
  /\bfrom\s*["'][^"']*["']|\bimport\s*\(\s*["'][^"']*["']\s*\)|\bimport\s*["'][^"']*["']/g
// cmux as an argv element, by name in any case (macOS's filesystem ignores it) or by a path however it is built ("/opt/homebrew/bin/cmux", `${HOME}/.local/bin/cmux`, join(homedir(), ".local/bin/cmux")). Anything else that ends in the word reads as one too and fails loudly: JSX text or an attribute that is just the word (label="cmux"), or a path or URL ending in /cmux (cmux's repo, its state folder); give it more words or another ending.
const CMUX_ARGV = /(?:["'`]|\/)cmux["'`]/i
// Anything that can start a process: Bun's spawn and shell (Bun.spawn, or spawn taken from Bun), node's child_process, and the spawning packages in bun.lock or a terminal's (execa, zx, cross-spawn, tinyexec, node-pty). A command line handed to a shell helper defined in another file is out of reach; that file's own spawn is what this sees.
const SPAWNS =
  /\bBun\.(?:spawn|spawnSync|\$)|=\s*Bun\b|\bfrom\s*["'](?:bun|node:child_process|child_process|execa|zx|cross-spawn|tinyexec|node-pty)["']|\b(?:require|import)\s*\(\s*["'](?:node:)?child_process["']\s*\)/
// cmux at a command position followed by anything at all, a subcommand, a flag or a path: a command line for a shell, exec or Bun's $. It fails closed, so only the words the repo's messages put after "cmux" pass; a new message that trips it adds its word here.
const PROSE = ["could", "did", "failed", "runs", "knows", "cannot", "is", "would", "terminal"]
const CMUX_COMMAND = new RegExp(
  `(?:^|[\\s"'\`;&|(=])(?:[^\\s"'\`]*/)?cmux\\s+(?!(?:${PROSE.join("|")})\\b)[-./~\\w]`,
  "i",
)
// cmux.ts's argv builders, named in a file that imports, re-exports or dynamically imports a module ending in /cmux, with or without its extension. Every other export is the API the rest of the repo calls; the export test below makes a new export pick a side.
const BUILDER_NAMES = ["cmuxCommand", "replyCommand", "writeCommand"]
const CALLABLE = [
  "CMUX_APP",
  "CmuxTimedOut",
  "FEED_REQUEST_ID",
  "PERMISSION_MODES",
  "PLAN_MODES",
  "READ_COMMANDS",
  "WRITE_KEYS",
  "attachment",
  "canForce",
  "cmuxFailure",
  "cmuxHeld",
  "cmuxHeldOf",
  "herdrAlone",
  "holdsKeystroke",
  "isReadCommand",
  "processTableOf",
  "reply",
  "rosterAgents",
  "run",
  "runJson",
  "stream",
  "write",
]
const CMUX_MODULE = /["'][^"']*\/cmux(?:\.[cm]?[jt]sx?)?["']/
const BUILDERS = new RegExp(`\\b(?:${BUILDER_NAMES.join("|")})\\b`)
// A star re-export hands every builder on under another module's name, so a barrel (`export * from "./cmux"`, as middlewares/index.ts and routers/index.ts are written) crosses by itself; one that needs cmux.ts names what it shares (`export { run, stream, write } from "./cmux"`).
const STAR_REEXPORT =
  /\bexport\s*\*\s*(?:as\s+[\w$]+\s*)?from\s*["'][^"']*\/cmux(?:\.[cm]?[jt]sx?)?["']/

// The factory's own tool that answers a cmux session's Feed permission, `playground picker`, as run.py's Python reads cmux beside the app; it builds its two argvs itself and reaches no dashboard code.
const CMUX_TOOLS = new Set(["packages/scripts/src/playground/picker.ts"])

// Files that name cmux only as a value and spawn nothing: the ops job registry, whose runtime field takes "cmux", and onboarding's checks, whose cmux row reads PATH alone.
const CMUX_VALUES = new Set(["api/hono/src/lib/onboard/checks.ts", "packages/settings/src/jobs.ts"])

// Each source file, other than cmux.ts and CMUX_TOOLS, that names cmux as an argv, runs a cmux command line where it can spawn, or borrows cmux.ts's argv builders.
const crossings = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([path, source]) => {
      if (path === CMUX || CMUX_TOOLS.has(path)) return false
      if (CMUX_VALUES.has(path) && !SPAWNS.test(source)) return false
      const code = codeOf(path, source)
      const bare = code.replace(SPECIFIER, "")
      return (
        CMUX_ARGV.test(bare) ||
        (SPAWNS.test(code) && CMUX_COMMAND.test(bare)) ||
        (CMUX_MODULE.test(code) && BUILDERS.test(code)) ||
        STAR_REEXPORT.test(code)
      )
    })
    .map(([path]) => path)

describe("the cmux boundary", () => {
  test("every export of cmux.ts is an argv builder the boundary keeps inside it, or part of its API", () => {
    expect(Object.keys(cmux).sort()).toEqual([...BUILDER_NAMES, ...CALLABLE].sort())
  })

  // The skills drive cmux from their own scripts (playbook's SESSIONS.md), so the boundary is the app's and the repo's tooling, not theirs.
  test("no source file in the repo but cmux.ts spawns cmux or borrows its argv builders", async () => {
    const listed = Bun.spawnSync(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, stdin: "ignore" },
    )
    expect({ code: listed.exitCode, stderr: listed.stderr.toString() }).toEqual({
      code: 0,
      stderr: "",
    })
    const files: Record<string, string> = {}
    for (const path of listed.stdout.toString().split("\n")) {
      if (!SOURCE.test(path) || /^(?:tests|skills)\//.test(path) || path.endsWith(".d.ts")) continue
      const file = Bun.file(join(ROOT, path))
      if (await file.exists()) files[path] = await file.text()
    }
    expect(Object.keys(files)).toContain(CMUX)
    expect(crossings(files)).toEqual([])
  })

  test("every way of spawning cmux outside cmux.ts crosses it; a comment or a message about cmux does not", () => {
    const crossing = {
      "argv.ts": 'Bun.spawn(["cmux", "send", "--", "hi"])',
      "path.ts": 'Bun.spawn(["/opt/homebrew/bin/cmux", "events"])',
      "variable.ts": 'const bin = "cmux"\nrun([bin, "ping"])',
      "helper.ts": 'await runCommand(["cmux", "ping"])',
      "exec.ts":
        'import { execSync } from "node:child_process"\nexecSync("cmux close-workspace --workspace w")',
      "env.ts":
        'import { execSync } from "node:child_process"\nexecSync("CMUX_QUIET=1 cmux list-workspaces")',
      "shell.ts": 'Bun.spawn(["sh", "-c", "cmux send --surface s -- hi"])',
      "bunshell.ts": "await Bun.$`cmux send --surface s -- hi`",
      "dollar.ts": 'import { $ } from "bun"\nawait $`cmux ping`',
      "spawnimport.ts":
        'import { spawn } from "bun"\nconst line = "cmux events --reconnect"\nspawn(line.split(" "))',
      "execa.ts": 'import { execa } from "execa"\nawait execa("cmux", ["ping"])',
      "required.js": 'const cp = require("child_process")\ncp.execSync("cmux ping")',
      "borrowed.ts":
        'import { cmuxCommand } from "@/lib/dashboard/cmux"\nBun.spawn(cmuxCommand(["events"]))',
      "page.tsx": 'export const P = () => { Bun.spawn(["cmux", "ping"]); return <div /> }',
      "devonly.ts":
        'if (process.env.NODE_ENV !== "production") Bun.spawn(["cmux", "list-workspaces"])',
      "prodonly.ts":
        'if (process.env.NODE_ENV === "production") Bun.spawn(["cmux", "list-workspaces"])',
      "templatepath.ts": 'Bun.spawn([`${process.env.HOME}/.local/bin/cmux`, "list-workspaces"])',
      "joinedpath.ts":
        'import { join } from "node:path"\nimport { homedir } from "node:os"\nBun.spawn([join(homedir(), ".local/bin/cmux"), "list-workspaces"])',
      "flag.ts":
        'import { execSync } from "node:child_process"\nexecSync("cmux --json list-workspaces")',
      "workspace.ts": 'Bun.spawn(["sh", "-c", "cmux workspace status"])',
      "sudo.ts": 'Bun.spawn(["sh", "-c", "cmux sudo pending"])',
      "surface.ts": 'Bun.spawn(["sh", "-c", "cmux surface resume show"])',
      "dot.ts": 'Bun.spawn(["sh", "-c", "cmux ."])',
      "destructured.ts": 'const { spawn } = Bun\nspawn(["sh", "-c", "cmux list-workspaces"])',
      "zx.ts": 'import { $ } from "zx"\nawait $`cmux list-workspaces`',
      "crossspawn.ts":
        'import spawn from "cross-spawn"\nspawn.sync("sh", ["-c", "cmux list-workspaces"])',
      "tinyexec.ts": 'import { x } from "tinyexec"\nawait x("sh", ["-c", "cmux list-workspaces"])',
      "upper.ts": 'Bun.spawn(["CMUX", "list-workspaces"])',
      "nodepty.ts":
        'import { spawn } from "node-pty"\nspawn("sh", ["-c", "cmux list-workspaces"], {})',
      "barrel.ts": 'export * from "@/lib/dashboard/cmux"',
      "namedbarrel.ts": 'export * as dashboard from "./cmux"',
      "namespace.ts":
        'import * as c from "@/lib/dashboard/cmux"\nBun.spawn(c.cmuxCommand(["list-workspaces"]))',
      "relative.ts": 'import { cmuxCommand as c } from "./cmux"\nBun.spawn(c(["list-workspaces"]))',
      "reexport.ts": 'export { cmuxCommand as argv } from "@/lib/dashboard/cmux"',
      "dynamic.ts":
        'const m = await import("@/lib/dashboard/cmux")\nBun.spawn(m.cmuxCommand(["list-workspaces"]))',
      "extension.ts":
        'import { cmuxCommand as c } from "@/lib/dashboard/cmux.ts"\nBun.spawn(c(["list-workspaces"]))',
    }
    const clear = {
      "reads.ts": 'import { run } from "@/lib/dashboard/cmux"\nawait run(["sessions", "list"])',
      "sharing.ts":
        'export { run, stream, write } from "./cmux"\nexport * from "@/middlewares/auth"',
      "message.ts": 'Bun.spawn(["git", "status"])\nconst problem = "cmux could not be read"',
      "comment.ts":
        '// cmux.ts builds it with cmuxEnv() and Bun.spawn(["cmux"])\nexport const x = 1',
      "other.ts": "const writeCommand = (line: string) => line.trim()\nexport { writeCommand }",
      [CMUX]: 'Bun.spawn(["cmux", "events"])',
    }
    expect(crossings({ ...crossing, ...clear }).sort()).toEqual(Object.keys(crossing).sort())
  })
})

describe("replyCommand", () => {
  const ID = "54FB3383-A4B7-47D1-A6F8-225DF4F9E6A8"
  const body = (argv: string[]) => JSON.parse(argv.at(-1) ?? "{}")

  test("each kind of answer is its own rpc method, with a body built here", () => {
    const question = replyCommand({
      kind: "question",
      requestId: ID,
      selections: ["Red", "my own words"],
    })
    expect(question.slice(0, 3)).toEqual(["cmux", "rpc", "feed.question.reply"])
    expect(body(question)).toEqual({ request_id: ID, selections: ["Red", "my own words"] })
    const permission = replyCommand({ kind: "permission", mode: "deny", requestId: ID })
    expect(permission.slice(0, 3)).toEqual(["cmux", "rpc", "feed.permission.reply"])
    expect(body(permission)).toEqual({ mode: "deny", request_id: ID })
    const plan = replyCommand({
      feedback: "use a branch",
      kind: "plan",
      mode: "deny",
      requestId: ID,
    })
    expect(plan.slice(0, 3)).toEqual(["cmux", "rpc", "feed.exit_plan.reply"])
    expect(body(plan)).toEqual({ feedback: "use a branch", mode: "deny", request_id: ID })
    expect(
      body(replyCommand({ feedback: null, kind: "plan", mode: "manual", requestId: ID })),
    ).toEqual({
      mode: "manual",
      request_id: ID,
    })
  })

  // A permission is answered once or denied: always, all or bypass would approve more than the one action on screen.
  test("only once and deny answer a permission, and only manual and deny a plan", () => {
    for (const mode of ["always", "all", "bypass"]) {
      expect(() =>
        replyCommand({ kind: "permission", mode: mode as "once", requestId: ID }),
      ).toThrow("not allowed")
    }
    for (const mode of ["ultraplan", "bypassPermissions", "autoAccept"]) {
      expect(() =>
        replyCommand({ feedback: null, kind: "plan", mode: mode as "manual", requestId: ID }),
      ).toThrow("not allowed")
    }
    expect(() =>
      replyCommand({ feedback: "note", kind: "plan", mode: "manual", requestId: ID }),
    ).toThrow("goes with deny")
  })

  test("a reply names a real request id and a selection for every question", () => {
    expect(() => replyCommand({ kind: "permission", mode: "deny", requestId: "q0" })).toThrow(
      "request id",
    )
    expect(() => replyCommand({ kind: "question", requestId: ID, selections: [] })).toThrow()
    expect(() =>
      replyCommand({ kind: "question", requestId: ID, selections: ["Red", " "] }),
    ).toThrow()
  })
})

describe("a refused source", () => {
  test("answers SOURCE_REFUSED with its reason, never a cmux code, so the web shows no cmux setup line under it", async () => {
    const saved = {
      fixture: process.env.PLAYGROUND_FIXTURE,
      live: process.env.PLAYGROUND_LIVE_READS,
      test: process.env.NODE_ENV,
    }
    // a test run's PLAYGROUND_FIXTURE counts for nothing (fixture.ts), so the refusal is built as a non-test stack sees it
    delete process.env.NODE_ENV
    process.env.PLAYGROUND_FIXTURE = "x.json"
    process.env.PLAYGROUND_LIVE_READS = "1"
    try {
      const err = await cmux.run(["list-workspaces", "--json"]).then(
        () => null,
        (error: unknown) => error as { code: string; message: string; status: number },
      )
      expect(err?.code).toBe("SOURCE_REFUSED")
      expect(err?.status).toBe(503)
      expect(err?.message).toContain("set one of them")
    } finally {
      for (const [key, value] of [
        ["PLAYGROUND_FIXTURE", saved.fixture],
        ["PLAYGROUND_LIVE_READS", saved.live],
        ["NODE_ENV", saved.test],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

// Text typed into a pane lands as a user turn and reads as the owner's, and nothing may speak for the owner, so only cmux.ts's write() types, for the owner's own clicks; sessions talk through SendMessage. Escape types no text, so it is the one key a procedure may press, on a permission prompt or the usage-limit dialog; `playground picker` alone also presses Yes on a permission prompt (below).
const PANE_TYPING = [
  /(?:^|[^\w-])[$"'{]*[\w./~-]*cmux\b[}"']?(?:\s+--?[\w-]+(?:=\S+)?)*\s+send(?:-key)?\s+(?!(?:or|and)\b)[^\s`]/i,
  /["']cmux["']\s*,\s*["']send(?:-key)?["']/i,
  /\bsend-key\s+--?\w/i,
]
// Each line allowed to name a key send, matched whole: SESSIONS.md's Escape on a permission prompt (**voice**), run.py's Escape, which clears the usage-limit dialog and presses nothing on a permission prompt (**unstick**), and run.py's `send-key --help` read, which types nothing.
const ESCAPE_ONLY = [
  {
    line: /^cmux send-key --workspace workspace:N --surface surface:N escape$/,
    path: "extensions/core/skills/playbook/SESSIONS.md",
  },
  {
    line: /^r = subprocess\.run\(\["cmux", "send-key", "--help"\], capture_output=True, text=True, timeout=20\)$/,
    path: "scripts/ops/unstick/run.py",
  },
  {
    line: /^args = \["cmux", "send-key", \*\(\["--force"\] if can_force\(\) else \[\]\), "--workspace", s\["workspace_id"\], "--surface", s\["surface_id"\], "escape"\]$/,
    path: "scripts/ops/unstick/run.py",
  },
]
const escapeOnly = (path: string, line: string): boolean =>
  ESCAPE_ONLY.some((allowed) => allowed.path === path && allowed.line.test(line.trim()))

// Each text file, other than cmux.ts, with a line that types into a pane.
const paneTypers = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(
      ([path, text]) =>
        path !== CMUX &&
        text
          .split("\n")
          .some(
            (line) => PANE_TYPING.some((typing) => typing.test(line)) && !escapeOnly(path, line),
          ),
    )
    .map(([path]) => path)

describe("typing into a pane", () => {
  test("no text in the repo but cmux.ts types into a pane", async () => {
    const listed = Bun.spawnSync(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, stdin: "ignore" },
    )
    expect(listed.exitCode).toBe(0)
    const files: Record<string, string> = {}
    for (const path of listed.stdout.toString().split("\n")) {
      if (!path || path.startsWith("tests/")) continue
      const file = Bun.file(join(ROOT, path))
      if (!(await file.exists()) || file.size > 2_000_000) continue
      const text = await file.text()
      if (!text.includes("\0")) files[path] = text
    }
    for (const { path } of ESCAPE_ONLY) expect(Object.keys(files)).toContain(path)
    expect(paneTypers(files)).toEqual([])
  })

  test("a command, a script's argv or a key types; prose about the rule and Escape on a prompt do not", () => {
    const typing = {
      "argv.py": 'subprocess.run(["cmux", "send", "--surface", s, text])',
      "doc.md": 'cmux send --workspace workspace:N --surface surface:N "/rename x"',
      "flagged.sh": 'cmux --json send --surface "$S" "hi"',
      "key.sh": 'cmux send-key --surface "$S" Enter',
      "quoted.sh": 'cmux send "hello"',
      "variable.sh": '"$CMUX" send-key --surface "$S" Enter',
      "variabletext.sh": '"$CMUX" send --surface "$S" "hi"',
      [ESCAPE_ONLY[0]!.path]: "cmux send-key --workspace workspace:N --surface surface:N Enter",
      [ESCAPE_ONLY[1]!.path]:
        'args = ["cmux", "send-key", *(["--force"] if can_force() else []), "--workspace", s["workspace_id"], "--surface", s["surface_id"], "Enter"]',
    }
    const clear = {
      "prose.md": "nothing types into a pane: no `cmux send` or `send-key`, and no deliver()",
      "words.md": "cmux sends its Feed as JSON, and cmux send or send-key would type",
      [CMUX]: 'return ["cmux", "send-key", "--surface", write.surface, "--", write.key]',
    }
    expect(paneTypers({ ...typing, ...clear }).sort()).toEqual(Object.keys(typing).sort())
    expect(
      paneTypers({
        [ESCAPE_ONLY[0]!.path]: "cmux send-key --workspace workspace:N --surface surface:N escape",
        [ESCAPE_ONLY[1]!.path]: [
          '        r = subprocess.run(["cmux", "send-key", "--help"], capture_output=True, text=True, timeout=20)',
          '        args = ["cmux", "send-key", *(["--force"] if can_force() else []), "--workspace", s["workspace_id"], "--surface", s["surface_id"], "escape"]',
        ].join("\n"),
      }),
    ).toEqual([])
  })
})

// write() is the dashboard's one way to type into a pane, so it reaches only deliver.ts, which serves the owner's own clicks (deliver.test.ts pins deliver()'s callers in turn).
const WRITERS = ["api/hono/src/lib/dashboard/deliver.ts"]
const CMUX_WHOLE =
  /\*\s*(?:as\s+[\w$]+\s*)?from\s*["'][^"']*\/cmux(?:\.[cm]?[jt]sx?)?["']|\bimport\s*\(\s*["'][^"']*\/cmux(?:\.[cm]?[jt]sx?)?["']\s*\)/

// Each source file, other than cmux.ts, that names write beside a module ending in /cmux, or takes that module whole (a star or a dynamic import).
const writers = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([path, source]) => {
      if (path === CMUX) return false
      const code = codeOf(path, source)
      if (!CMUX_MODULE.test(code)) return false
      return /(?<![.\w$])write\b/.test(code.replace(SPECIFIER, "")) || CMUX_WHOLE.test(code)
    })
    .map(([path]) => path)

describe("who calls write()", () => {
  test("only deliver.ts", async () => {
    const listed = Bun.spawnSync(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, stdin: "ignore" },
    )
    expect(listed.exitCode).toBe(0)
    const files: Record<string, string> = {}
    for (const path of listed.stdout.toString().split("\n")) {
      if (!SOURCE.test(path) || path.startsWith("tests/") || path.endsWith(".d.ts")) continue
      const file = Bun.file(join(ROOT, path))
      if (await file.exists()) files[path] = await file.text()
    }
    expect(writers(files)).toEqual(WRITERS)
  })

  test("an import, a renamed or dynamic import or a star import of write counts; a read or a method named write does not", () => {
    const writing = {
      "direct.ts":
        'import { write } from "@/lib/dashboard/cmux"\nawait write({ surface: s, text: "hi" })',
      "dynamic.ts":
        'const m = await import("@/lib/dashboard/cmux")\nawait m.write({ surface: s, text: "hi" })',
      "renamed.ts":
        'import { write as type } from "./cmux"\nawait type({ surface: s, text: "hi" })',
      "star.ts": 'import * as c from "@/lib/dashboard/cmux"\nawait c.run(["sessions", "list"])',
    }
    const clear = {
      "method.ts":
        'import { stream } from "@/lib/dashboard/cmux"\nsocket.write("x")\nstream(["events"])',
      "reads.ts": 'import { run } from "@/lib/dashboard/cmux"\nawait run(["sessions", "list"])',
      "types.ts":
        'import { type Write } from "@/lib/dashboard/cmux"\nexport const w: Write | null = null',
      [CMUX]: "export const write = async () => {}",
    }
    expect(writers({ ...writing, ...clear }).sort()).toEqual(Object.keys(writing).sort())
  })
})

// herdr's pane writes, the other way to type into a pane: herdr.ts alone names them, and of those that type, prompt() and pressEnter() reach only deliver.ts (the owner's composer, the Linear app's row actions and the owner's inbox answers) and typeKeys() only feed.ts, whose answerHerdr() serves the herdr answer route, POST /api/v1/workers/:sessionId/feed/:requestId, the owner's own Submit on a prompt's card, since an answer from the card is the owner's own Submit.
const HERDR = "api/hono/src/lib/dashboard/herdr.ts"
const HERDR_WRITES =
  /["'`](?:agent\.(?:prompt|send_keys)|pane\.(?:send_input|send_keys|send_text))["'`]/
const HERDR_TYPERS: Record<string, string[]> = {
  pressEnter: ["api/hono/src/lib/dashboard/deliver.ts"],
  prompt: ["api/hono/src/lib/dashboard/deliver.ts"],
  typeKeys: ["api/hono/src/lib/dashboard/feed.ts"],
}

// Each source file, other than herdr.ts, that imports or re-exports `name` from a module ending in /herdr, or takes that module whole (a star or a dynamic import).
const HERDR_MODULE = String.raw`["'][^"']*\/herdr(?:\.[cm]?[jt]sx?)?["']`
const herdrTypers = (files: Record<string, string>, name: string): string[] =>
  Object.entries(files)
    .filter(([path, source]) => {
      if (path === HERDR) return false
      const code = codeOf(path, source)
      const whole = new RegExp(
        String.raw`\*\s*(?:as\s+[\w$]+\s*)?from\s*${HERDR_MODULE}|\bimport\s*\(\s*${HERDR_MODULE}\s*\)`,
      )
      const lists = code.matchAll(
        new RegExp(
          String.raw`(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*${HERDR_MODULE}`,
          "g",
        ),
      )
      const named = [...lists].some((list) =>
        (list[1] ?? "").split(",").some(
          (part) =>
            part
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0] === name,
        ),
      )
      return named || whole.test(code)
    })
    .map(([path]) => path)

describe("herdr's pane writes", () => {
  const sourceFiles = async () => {
    const listed = Bun.spawnSync(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, stdin: "ignore" },
    )
    expect(listed.exitCode).toBe(0)
    const files: Record<string, string> = {}
    for (const path of listed.stdout.toString().split("\n")) {
      if (!SOURCE.test(path) || path.startsWith("tests/") || path.endsWith(".d.ts")) continue
      const file = Bun.file(join(ROOT, path))
      if (await file.exists()) files[path] = await file.text()
    }
    return files
  }

  test("no source but herdr.ts names a herdr method that types into a pane", async () => {
    const files = await sourceFiles()
    expect(HERDR_WRITES.test(files[HERDR] ?? "")).toBe(true)
    expect(
      Object.entries(files)
        .filter(([path, text]) => path !== HERDR && HERDR_WRITES.test(text))
        .map(([path]) => path),
    ).toEqual([])
  })

  test("prompt() and pressEnter() reach only deliver.ts, and typeKeys() only feed.ts's herdr answer route", async () => {
    const files = await sourceFiles()
    for (const [name, allowed] of Object.entries(HERDR_TYPERS)) {
      expect([name, herdrTypers(files, name)]).toEqual([name, allowed])
    }
  })

  test("a named, renamed, dynamic or star import counts; a sibling read does not", () => {
    const typing = {
      "dynamic.ts": 'const h = await import("@/lib/dashboard/herdr")\nawait h.typeKeys(s, k)',
      "named.ts": 'import { typeKeys } from "@/lib/dashboard/herdr"\nawait typeKeys(s, k)',
      "renamed.ts": 'import { typeKeys as press } from "./herdr"\nawait press(s, k)',
      "star.ts": 'import * as h from "../dashboard/herdr"\nh.herdrServers()',
    }
    const clear = {
      "reads.ts": 'import { readScreen } from "@/lib/dashboard/herdr"\nawait readScreen(s, 40)',
      [HERDR]: "export async function typeKeys() {}",
    }
    expect(herdrTypers({ ...typing, ...clear }, "typeKeys").sort()).toEqual(
      Object.keys(typing).sort(),
    )
  })
})

// a script's key into a herdr pane (herdr's CLI `send-keys`) or a Feed reply (`feed.<kind>.reply`) comes only from run.py's Escape on the usage-limit dialog and `playground picker`, a manager's answer to its session's permission prompt, since the managers handle those; cmux.ts's reply() is the dashboard's.
describe("a script's key into a pane or answer to a prompt", () => {
  test("comes from run.py's Escape and playground picker alone", () => {
    const listed = Bun.spawnSync(
      [
        "git",
        "grep",
        "--untracked",
        "-lE",
        String.raw`["']send-keys["']|feed\.[a-z_]+\.reply`,
        "--",
        ":!tests",
      ],
      { cwd: ROOT, stdin: "ignore" },
    )
    const files = listed.stdout.toString().trim().split("\n").filter(Boolean)
    expect(files.filter((path) => path !== CMUX && !path.endsWith(".md")).sort()).toEqual([
      "packages/scripts/src/playground/picker.ts",
      "scripts/ops/unstick/run.py",
    ])
  })
})
