import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run as realRun } from "../../../../../packages/scripts/src/ops-job/job"
import {
  missingGuards,
  restoreBeat,
  SECOND_LOOK_MS,
  upkeepHeld,
} from "../../../../../packages/scripts/src/ops-restore/cli"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const GUARDS = ["no-stash", "no-env-dump"]
const T0 = new Date(Date.UTC(2026, 10, 7, 6, 0))
const later = (ms: number) => new Date(T0.getTime() + ms)

const git = async (cwd: string, ...args: string[]) => {
  const { code, out } = await realRun(["git", "-C", cwd, ...args])
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${out}`)
  return out
}

// A main checkout and the origin it was cloned from, each guard's bundle committed on main, and an ops folder: git runs for real, while the install, link-skills.sh and ps answer as `answers` says, each recorded.
const machine = async (answers: Record<string, { code: number; out?: string }> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "ops-restore-"))
  const origin = join(root, "origin")
  mkdirSync(join(origin, "scripts", "hooks", "bundled"), { recursive: true })
  for (const name of GUARDS)
    writeFileSync(join(origin, "scripts", "hooks", "bundled", `${name}.js`), "")
  await git(root, "init", "-q", "-b", "main", origin)
  await git(origin, "add", "-A")
  await git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "guards")
  const main = join(root, "main")
  await git(root, "clone", "-q", origin, main)
  const self = join(root, "self")
  await git(root, "clone", "-q", origin, self)
  const ops = join(root, "ops")
  mkdirSync(ops)
  const runs: string[] = []
  const sent: { text: string; to: string }[] = []
  const ctx = (now: Date): Context => ({
    now,
    ops,
    repo: self,
    run: async (argv, timeout, stdin) => {
      runs.push(argv.join(" "))
      const key = Object.keys(answers).find((k) => argv.join(" ").includes(k))
      if (key) return { code: answers[key]!.code, out: answers[key]!.out ?? "" }
      if (argv[0] === "git") return realRun(argv, timeout, stdin)
      return { code: 0, out: "" }
    },
    send: async (to, text) => {
      sent.push({ text, to })
      return true
    },
  })
  const wipe = () => rmSync(join(main, "scripts"), { force: true, recursive: true })
  return { ctx, main, ops, root, runs, sent, wipe }
}

const noUpkeep = async () => false

describe("ops-restore puts a lost main checkout back (#1354)", () => {
  test("a checkout with every guard does nothing", async () => {
    const m = await machine()
    await restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })(m.ctx(T0))
    expect(m.runs).toEqual([])
    expect(existsSync(join(m.ops, "restore"))).toBe(false)
  })

  test("a guard gone on one look only is recorded, and nothing runs", async () => {
    const m = await machine()
    m.wipe()
    expect(missingGuards(m.main, GUARDS)).toEqual(GUARDS)
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(SECOND_LOOK_MS - 10_000)))
    expect(m.runs).toEqual([])
    expect(m.sent).toEqual([])
  })

  test("gone on two looks 5 minutes apart, it restores, names what the checkout held, installs and links", async () => {
    const m = await machine()
    m.wipe()
    writeFileSync(join(m.main, "stray.txt"), "")
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(300_000)))
    expect(missingGuards(m.main, GUARDS)).toEqual([])
    expect(m.runs.some((r) => r.endsWith("checkout -- ."))).toBe(true)
    expect(m.runs.some((r) => r.includes("run-slot.sh ops-restore -- bun install --cwd"))).toBe(
      true,
    )
    expect(m.runs.some((r) => r.endsWith("scripts/link-skills.sh"))).toBe(true)
    expect(m.sent.map((s) => s.to)).toEqual(["ops", "dispatcher"])
    expect(m.sent[0]!.text).toContain("had 2 files deleted and also held ?? stray.txt")
    const kept = readdirSync(join(m.ops, "restore")).filter((f) => f.startsWith("status-"))
    expect(kept).toHaveLength(1)
    expect(existsSync(join(m.ops, "restore", "state.json"))).toBe(false)
  })

  test("with its .git gone too, it restores in place from origin's URL", async () => {
    const m = await machine()
    m.wipe()
    rmSync(join(m.main, ".git"), { force: true, recursive: true })
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(300_000)))
    expect(missingGuards(m.main, GUARDS)).toEqual([])
    expect(await git(m.main, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main\n")
    expect(m.sent[0]!.text).toContain("no .git, restored in place")
  })

  test("while upkeep holds the main checkout, it waits", async () => {
    const m = await machine()
    m.wipe()
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: async () => true })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(300_000)))
    expect(m.runs).toEqual([])
    expect(missingGuards(m.main, GUARDS)).toEqual(GUARDS)
  })

  test("upkeep is a run slot whose holder runs playground update, read by its pid", async () => {
    const m = await machine({
      "ps -o command= -p 4242": {
        code: 0,
        out: "bun /x/packages/scripts/src/playground/update.ts\n",
      },
    })
    expect(await upkeepHeld(m.ctx(T0))).toBe(false)
    writeFileSync(join(m.ops, "run-slot-2.holder"), "worker-a 4243 2026-11-07T06:00:00Z 1 medium\n")
    expect(await upkeepHeld(m.ctx(T0))).toBe(false)
    writeFileSync(join(m.ops, "run-slot.holder"), "ops 4242 2026-11-07T06:00:00Z 1 medium\n")
    expect(await upkeepHeld(m.ctx(T0))).toBe(true)
  })

  test("a failed step is told once and not tried again until the guards are back", async () => {
    const m = await machine({
      "checkout -- .": { code: 1, out: "error: unable to unlink old 'x'\n" },
    })
    m.wipe()
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(300_000)))
    expect(m.sent).toHaveLength(2)
    expect(m.sent[0]!.text).toContain(
      "stopped at git checkout -- .: error: unable to unlink old 'x'",
    )
    const runs = m.runs.length
    await beat(m.ctx(later(600_000)))
    expect(m.runs).toHaveLength(runs)
    expect(m.sent).toHaveLength(2)
    await git(m.main, "checkout", "--", ".")
    await beat(m.ctx(later(900_000)))
    expect(existsSync(join(m.ops, "restore", "state.json"))).toBe(false)
  })
})
