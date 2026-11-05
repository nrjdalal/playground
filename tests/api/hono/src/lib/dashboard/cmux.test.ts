import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import * as cmux from "../../../../../../api/hono/src/lib/dashboard/cmux"
import {
  cmuxCommand,
  cmuxFailure,
  holdsKeystroke,
  isReadCommand,
  stream,
  writeCommand,
} from "../../../../../../api/hono/src/lib/dashboard/cmux"

const SURFACE = "42A9D5E3-E49A-454C-80E6-8884E5ACCC92"

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
const BUILDER_NAMES = ["cmuxCommand", "writeCommand"]
const CALLABLE = [
  "CmuxTimedOut",
  "READ_COMMANDS",
  "WRITE_KEYS",
  "canForce",
  "cmuxFailure",
  "holdsKeystroke",
  "isReadCommand",
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

// Files that name cmux only as a value and spawn nothing: the ops job registry, whose runtime field takes "cmux", onboarding's checks, whose cmux row reads PATH alone, and the new-user gate's stand-ins, where it names a file the gate writes.
const CMUX_VALUES = new Set([
  "api/hono/src/lib/onboard/checks.ts",
  "packages/scripts/src/new-user-gate/stubs.ts",
  "packages/settings/src/jobs.ts",
])

// Each source file, other than cmux.ts, that names cmux as an argv, runs a cmux command line where it can spawn, or borrows cmux.ts's argv builders.
const crossings = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([path, source]) => {
      if (path === CMUX) return false
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

  // The skills drive cmux from their own scripts (playbook's SESSIONS.md), so the boundary is the app's and the repo's tooling, not theirs; the guards' bundles are built from sources read here.
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
      if (
        !SOURCE.test(path) ||
        /^(?:tests|skills|scripts\/hooks\/bundled)\//.test(path) ||
        path.endsWith(".d.ts")
      )
        continue
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

// Text typed into a pane lands as a user turn and reads as the owner's, and nothing may speak for the owner, so only cmux.ts's write() types, for the owner's own clicks; sessions talk through SendMessage. A script's key into a herdr pane is held below, to run.py's Escape and `playground picker`.
const PANE_TYPING = [
  /(?:^|[^\w-])[$"'{]*[\w./~-]*cmux\b[}"']?(?:\s+--?[\w-]+(?:=\S+)?)*\s+send(?:-key)?\s+(?!(?:or|and)\b)[^\s`]/i,
  /["']cmux["']\s*,\s*["']send(?:-key)?["']/i,
  /\bsend-key\s+--?\w/i,
]
// Each text file, other than cmux.ts, with a line that types into a pane.
const paneTypers = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(
      ([path, text]) =>
        path !== CMUX &&
        text.split("\n").some((line) => PANE_TYPING.some((typing) => typing.test(line))),
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
    expect(paneTypers(files)).toEqual([])
  })

  test("a command, a script's argv or a key, Escape included, types; prose about the rule does not", () => {
    const typing = {
      "argv.py": 'subprocess.run(["cmux", "send", "--surface", s, text])',
      "doc.md": 'cmux send --workspace workspace:N --surface surface:N "/rename x"',
      "flagged.sh": 'cmux --json send --surface "$S" "hi"',
      "key.sh": 'cmux send-key --surface "$S" Enter',
      "quoted.sh": 'cmux send "hello"',
      "variable.sh": '"$CMUX" send-key --surface "$S" Enter',
      "variabletext.sh": '"$CMUX" send --surface "$S" "hi"',
      "escape.md": "cmux send-key --workspace workspace:N --surface surface:N escape",
      "escape.py":
        'args = ["cmux", "send-key", "--force", "--workspace", s["workspace_id"], "--surface", s["surface_id"], "escape"]',
    }
    const clear = {
      "prose.md": "nothing types into a pane: no `cmux send` or `send-key`, and no deliver()",
      "words.md": "cmux sends its Feed as JSON, and cmux send or send-key would type",
      [CMUX]: 'return ["cmux", "send-key", "--surface", write.surface, "--", write.key]',
    }
    expect(paneTypers({ ...typing, ...clear }).sort()).toEqual(Object.keys(typing).sort())
  })
})

// deliver.ts sends through herdr (below), so no source calls write(), which goes with the rest of cmux.ts.
const WRITERS: string[] = []
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
  test("no source", async () => {
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
