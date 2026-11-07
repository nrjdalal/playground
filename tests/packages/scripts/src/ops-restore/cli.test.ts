import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run as realRun } from "../../../../../packages/scripts/src/ops-job/job"
import {
  missingGuards,
  originPath,
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

// A main checkout and the origin it was cloned from, each guard's bundle committed on main, the Dashboard's checkout as a worktree of the main checkout (as this Mac's is), and an ops folder: git runs for real, while the install, link-skills.sh and ps answer as `answers` says, each recorded.
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
  await git(main, "worktree", "add", "-q", "-b", "desk", self)
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
const DAY = 24 * 60 * 60_000
const seed = async (ops: string, state: Record<string, unknown>) => {
  mkdirSync(join(ops, "restore"), { recursive: true })
  await Bun.write(join(ops, "restore", "state.json"), JSON.stringify(state))
}

describe("ops-restore puts a lost main checkout back (#1354)", () => {
  test("a checkout with every guard keeps origin's URL and does nothing else", async () => {
    const m = await machine()
    await restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })(m.ctx(T0))
    expect(m.runs).toEqual([`git -C ${m.main} remote get-url origin`])
    expect((await Bun.file(originPath(m.ops)).text()).trim()).toBe(join(m.root, "origin"))
    expect(existsSync(join(m.ops, "restore", "state.json"))).toBe(false)
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
    expect(m.sent[0]!.text).toContain("on two looks 5 minutes apart")
    const kept = readdirSync(join(m.ops, "restore")).filter((f) => f.startsWith("status-"))
    expect(kept).toHaveLength(1)
    expect(m.sent[0]!.text).toContain(`git status in ${join(m.ops, "restore", kept[0]!)}`)
    expect(existsSync(join(m.ops, "restore", "state.json"))).toBe(false)
  })

  test("with its .git gone too, which breaks the Dashboard's worktree, it restores in place from the URL a healthy look kept", async () => {
    const m = await machine()
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    m.wipe()
    rmSync(join(m.main, ".git"), { force: true, recursive: true })
    await beat(m.ctx(later(60_000)))
    await beat(m.ctx(later(360_000)))
    expect(missingGuards(m.main, GUARDS)).toEqual([])
    expect(await git(m.main, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main\n")
    expect(m.sent[0]!.text).toContain("had no .git and was restored in place")
    expect(m.sent[0]!.text).toContain("has lost its link to it")
  })

  test("with its .git gone and no URL kept, it stops at reading origin's URL and says where it looked", async () => {
    const m = await machine()
    m.wipe()
    rmSync(join(m.main, ".git"), { force: true, recursive: true })
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(300_000)))
    expect(m.sent[0]!.text).toContain(
      `stopped at reading origin's URL: none kept in ${originPath(m.ops)}`,
    )
    expect(m.sent[0]!.text).toContain("true-block route")
  })

  test("a first look recorded a day ago starts the count again, so a passing gap is never acted on", async () => {
    const m = await machine()
    m.wipe()
    const old = new Date(T0.getTime() - DAY).toISOString()
    await seed(m.ops, { last: old, missing: GUARDS, since: old })
    await restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })(m.ctx(T0))
    expect(m.runs).toEqual([])
    expect(await Bun.file(join(m.ops, "restore", "state.json")).json()).toEqual({
      last: T0.toISOString(),
      missing: GUARDS,
      since: T0.toISOString(),
    })
  })

  test("a stopped restore stays stopped across a gap, until the guards are back", async () => {
    const m = await machine()
    m.wipe()
    const old = new Date(T0.getTime() - DAY).toISOString()
    await seed(m.ops, { failed: "git checkout -- .", last: old, missing: GUARDS, since: old })
    const beat = restoreBeat({ guards: GUARDS, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(300_000)))
    expect(m.runs).toEqual([])
    expect(m.sent).toEqual([])
  })

  test("reads the guard list at each beat when given a reader", async () => {
    const m = await machine()
    m.wipe()
    let reads = 0
    const guards = async () => {
      reads++
      return GUARDS
    }
    const beat = restoreBeat({ guards, main: m.main, upkeep: noUpkeep })
    await beat(m.ctx(T0))
    await beat(m.ctx(later(60_000)))
    expect(reads).toBe(2)
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
    expect(m.sent[0]!.text).toContain(
      `Its git status before it began is in ${join(m.ops, "restore", "status-")}`,
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
