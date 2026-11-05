import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type Focus,
  focusPath,
  runFocus,
  standing,
  waits,
} from "../../../../../packages/scripts/src/playground/focus"
import {
  endFocus,
  heldOf,
  startFocus,
  startFreeze,
} from "../../../../../packages/scripts/src/pr-merge/held"

const SCRIPT = join(import.meta.dir, "../../../../../scripts/ops/run-slot.sh")
const DIR = mkdtempSync(join(tmpdir(), "focus-"))
afterAll(() => rmSync(DIR, { force: true, recursive: true }))

const NOW = new Date("2026-11-05T07:00:00Z")
const MIN = 60_000

let count = 0
// a data folder of its own, its held-prs.json beside it, and this checkout's run-slot.sh writing into its ops folder
const machine = (now = NOW) => {
  const data = join(DIR, `data-${++count}`)
  mkdirSync(join(data, "ops"), { recursive: true })
  const deps = {
    data,
    heldPath: join(data, "held-prs.json"),
    now: () => now,
    runSlot: (args: string[]) => {
      const run = Bun.spawnSync(["bash", SCRIPT, ...args], {
        env: { ...process.env, RUN_SLOT_OPS: join(data, "ops") },
        stderr: "pipe",
        stdout: "pipe",
      })
      return { code: run.exitCode, err: run.stderr.toString() }
    },
  }
  return { data, deps, held: () => readFileSync(deps.heldPath, "utf8") }
}

const printed: string[] = []
const log = spyOn(console, "log").mockImplementation((line: string) => void printed.push(line))
const err = spyOn(console, "error").mockImplementation((line: string) => void printed.push(line))
afterEach(() => (printed.length = 0))
afterAll(() => (log.mockRestore(), err.mockRestore()))

const on = (deps: ReturnType<typeof machine>["deps"], minutes = "30") =>
  runFocus(["on", "--session", "worker-f", "--for", minutes, "--reason", "a timed demo"], deps)

describe("playground focus", () => {
  test("on writes focus.json, holds every merge and sets run-slot.focus for the session", async () => {
    const m = machine()
    expect(await on(m.deps)).toBe(0)
    const until = new Date(NOW.getTime() + 30 * MIN).toISOString()
    expect(await standing(m.data, NOW)).toEqual({
      reason: "a timed demo",
      session: "worker-f",
      since: NOW.toISOString(),
      until,
    })
    expect(heldOf(m.held(), "acme/app", 7, NOW.getTime())).toBe(
      "worker-f has focus: every merge waits until focus ends",
    )
    expect(readFileSync(join(m.data, "ops", "run-slot.focus"), "utf8")).toStartWith("worker-f ")
    expect(printed.join("\n")).toContain(`focus: worker-f until ${until}`)
  })

  test("a 181-minute --for is refused and writes nothing, and 180 minutes holds", async () => {
    const m = machine()
    expect(await on(m.deps, "181")).toBe(2)
    expect(printed.join("\n")).toContain("--for 1 to 180 minutes")
    expect(existsSync(focusPath(m.data))).toBe(false)
    expect(existsSync(m.deps.heldPath)).toBe(false)
    expect(existsSync(join(m.data, "ops", "run-slot.focus"))).toBe(false)
    expect(await on(m.deps, "180")).toBe(0)
  })

  test("another session's on is refused while focus stands", async () => {
    const m = machine()
    await on(m.deps)
    expect(await runFocus(["on", "--session", "worker-g", "--reason", "x"], m.deps)).toBe(2)
    expect(printed.join("\n")).toContain("focus stands for worker-f")
  })

  test("off ends each part: the merge hold goes, run-slot.focus is lifted and focus.json is set aside", async () => {
    const m = machine()
    await on(m.deps)
    expect(await runFocus(["off"], m.deps)).toBe(0)
    expect(heldOf(m.held(), "acme/app", 7, NOW.getTime())).toBeNull()
    const ops = readdirSync(join(m.data, "ops"))
    expect(ops).not.toContain("run-slot.focus")
    expect(ops.some((f) => f.startsWith("run-slot.focus.lifted-"))).toBe(true)
    expect(await standing(m.data, NOW)).toBeUndefined()
    expect(readdirSync(m.data).some((f) => f.startsWith("focus.json.ended-"))).toBe(true)
  })

  test("lapsed at its end, the merge hold and the standing focus hold nothing, with no off", async () => {
    const m = machine()
    await on(m.deps)
    const end = NOW.getTime() + 30 * MIN
    expect(heldOf(m.held(), "acme/app", 7, end - 1)).not.toBeNull()
    expect(heldOf(m.held(), "acme/app", 7, end)).toBeNull()
    expect(await standing(m.data, new Date(end))).toBeUndefined()
  })

  test("off names the measured waits of every run but the focus session's and ops' upkeep", async () => {
    const end = new Date(NOW.getTime() + 10 * MIN)
    const m = machine()
    await on(m.deps)
    const at = (min: number) =>
      new Date(NOW.getTime() + min * MIN).toISOString().replace(".000", "")
    writeFileSync(
      join(m.data, "ops", "run-slot.runs.log"),
      [
        `${at(-5)} ask worker-a 11 bun run build`,
        `${at(2)} start worker-a 11 run-slot waited=420s`,
        `${at(1)} ask worker-b 12 bun run test`,
        `${at(4)} start worker-b 12 run-slot waited=180s`,
        `${at(3)} ask worker-c 13 bun install`,
        `${at(1)} ask worker-f 14 bun run build`,
        `${at(1)} ask ops-tick 15 bun install`,
        `${at(-9)} ask worker-d 16 true`,
        `${at(-8)} start worker-d 16 run-slot waited=60s`,
      ].join("\n"),
    )
    expect(await runFocus(["off"], { ...m.deps, now: () => end })).toBe(0)
    // worker-a 2 minutes inside focus, worker-b 3 and worker-c 7 to off: 3 runs, 12 minutes
    expect(printed.at(-1)).toBe(
      "focus ended for worker-f: 3 runs waited 12m0s in all (measured from run-slot.runs.log)",
    )
  })
})

describe("focus's merge hold beside a ship's freeze", () => {
  const focus: Focus = {
    reason: "r",
    session: "worker-f",
    since: NOW.toISOString(),
    until: new Date(NOW.getTime() + 30 * MIN).toISOString(),
  }

  test("a ship's freeze writes over focus's line, and focus's end leaves the freeze", async () => {
    const path = join(DIR, "freeze-over-focus.json")
    await startFocus(path, "worker-f", new Date(focus.until))
    expect((await startFreeze(path, "v1.2.3", NOW)).kept).toBe(false)
    expect(await endFocus(path)).toBe("kept")
    expect(heldOf(readFileSync(path, "utf8"), "acme/app", 7, NOW.getTime())).toContain("v1.2.3")
    expect(JSON.parse(readFileSync(path, "utf8")).until).toBeUndefined()
  })

  test("focus on while a ship's freeze stands keeps the freeze", async () => {
    const path = join(DIR, "focus-over-freeze.json")
    await startFreeze(path, "v1.2.3", NOW)
    expect(await startFocus(path, "worker-f", new Date(focus.until))).toEqual({
      kept: true,
      line: "v1.2.3 ships: canary is frozen until its tag lands",
    })
    expect(await endFocus(path)).toBe("kept")
  })

  test("waits counts nothing in a log with no asks", () => {
    expect(waits("", focus, NOW)).toEqual({ runs: 0, seconds: 0 })
  })
})
