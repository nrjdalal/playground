import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { check, type Guard, GUARDS } from "../../../scripts/hooks/guards"

const ROOT = join(import.meta.dir, "..", "..", "..")
const HOOKS = join(ROOT, "scripts", "hooks")

// The 21 guards canary's settings registered on Bash, one entry each, before guards.ts ran them in one process.
const BASH_GUARDS = [
  "no-desktop-owner-app",
  "no-env-dump",
  "no-extension-repo-write",
  "no-extensions-write",
  "no-false-green",
  "no-glm-heavy-path",
  "no-headless-login",
  "no-kill-by-name",
  "no-linear-ticket",
  "no-mac-web-build",
  "no-main-checkout",
  "no-off-palette-label",
  "no-ours-merge",
  "no-playground-leak",
  "no-prompt-stop",
  "no-public-leak",
  "no-raw-delete",
  "no-raw-spawn",
  "no-release-comment",
  "no-stash",
  "no-unslotted-run",
]

// A guard's main block, the lines its own process runs.
const mainBlock = async (name: string) => {
  const text = await Bun.file(join(HOOKS, `${name}.ts`)).text()
  return text.slice(text.indexOf("if (import.meta.main)"))
}

const input = (command: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    cwd: ROOT,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
    ...extra,
  })

const fake = (name: string, factory: boolean, run: Guard["run"]): Guard => ({ factory, name, run })

describe("guards.ts runs every Bash guard", () => {
  test("it names each of the 21 Bash guards once, A to Z", () => {
    expect(GUARDS.map((g) => g.name)).toEqual(BASH_GUARDS)
  })

  test.each(BASH_GUARDS)("%s keeps its own main block's factory gate", async (name) => {
    const gated = (await mainBlock(name)).includes("await fromFactory(raw)")
    expect({ gated: GUARDS.find((g) => g.name === name)?.factory, name }).toEqual({ gated, name })
  })

  test.each(BASH_GUARDS)("%s runs the entry its own main block calls", async (name) => {
    const entry = (await mainBlock(name)).match(/await (check|guarded|refusal)\(/)?.[1]
    const source = await Bun.file(join(HOOKS, "guards.ts")).text()
    const imported = source.match(
      new RegExp(`import \\{ (\\w+) as \\w+ \\} from "\\./${name}"`),
    )?.[1]
    expect({ imported, name }).toEqual({ imported: entry, name })
  })
})

describe("check", () => {
  const worker = { PLAYGROUND_ROLE: "worker" }

  test("passes a call no guard refuses", async () => {
    expect(await check(input("true"), worker, [fake("a", true, async () => undefined)])).toBe(
      undefined,
    )
  })

  test("refuses with every refusal, one paragraph each, in the guards' order", async () => {
    const guards = [
      fake("a", true, async () => "a hook refuses"),
      fake("b", false, async () => undefined),
      fake("c", false, async () => "c hook refuses"),
    ]
    expect(await check(input("x"), worker, guards)).toBe("a hook refuses\n\nc hook refuses")
  })

  test("a guard that throws refuses the call, naming the guard, and the others still run", async () => {
    const guards = [
      fake("thrower", false, async () => {
        throw new Error("boom")
      }),
      fake("b", false, async () => "b hook refuses"),
    ]
    const reason = await check(input("x"), worker, guards)
    expect(reason).toContain("guards hook: thrower threw (boom), so the call is refused")
    expect(reason).toContain("b hook refuses")
  })

  test("a guard that throws a non-Error still refuses", async () => {
    const guards = [
      fake("thrower", true, () => {
        throw "plain"
      }),
    ]
    expect(await check(input("x"), worker, guards)).toContain("thrower threw (plain)")
  })

  test("an owner's own session runs the ungated guards alone", async () => {
    const ran: string[] = []
    const guards = [
      fake("gated", true, async () => (ran.push("gated"), "gated hook refuses")),
      fake("open", false, async () => (ran.push("open"), undefined)),
    ]
    expect(await check(input("x"), {}, guards)).toBe(undefined)
    expect(ran).toEqual(["open"])
  })

  test("a factory session runs every guard, with the environment it was given", async () => {
    const seen: (string | undefined)[] = []
    const guards = [
      fake("gated", true, async (_, env) => (seen.push(env.PLAYGROUND_ROLE), undefined)),
      fake("open", false, async (_, env) => (seen.push(env.PLAYGROUND_ROLE), undefined)),
    ]
    await check(input("x"), worker, guards)
    expect(seen).toEqual(["worker", "worker"])
  })

  test("the real guards refuse a bare stash for a factory session and pass a plain call", async () => {
    const env = { ...process.env, ...worker }
    expect(await check(input("git stash"), env)).toContain("no-stash hook ")
    expect(await check(input("true"), env)).toBe(undefined)
  })
})

// The bundle, run as its own process with the input on stdin, as guard-probe runs it.
describe("the bundle runs as a hook", () => {
  const run = async (raw: string) => {
    const proc = Bun.spawn(
      ["bun", "--no-env-file", join(ROOT, "scripts", "hooks", "bundled", "guards.js")],
      {
        cwd: ROOT,
        env: { ...process.env, PLAYGROUND_ROLE: "worker" },
        stderr: "pipe",
        stdin: new TextEncoder().encode(raw),
        stdout: "pipe",
      },
    )
    return { code: await proc.exited, stderr: await new Response(proc.stderr).text() }
  }

  test("exits 2 with the reason on stderr for a refused call", async () => {
    const { code, stderr } = await run(input("git stash"))
    expect(code).toBe(2)
    expect(stderr).toContain("no-stash hook ")
  })

  test("exits 0 for a plain call and for guard-probe's empty input", async () => {
    expect(await run(input("true"))).toEqual({ code: 0, stderr: "" })
    expect((await run("{}")).code).toBe(0)
  })
})
