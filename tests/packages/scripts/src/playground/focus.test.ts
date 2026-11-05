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
  focusCard,
  type FocusCard,
  focusPath,
  runFocus,
  standing,
  UPKEEP,
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

  test("off ends each part: the merge hold goes, run-slot.focus is lifted and focus.json ends now, for the focus-card beat to post its card", async () => {
    const m = machine()
    await on(m.deps)
    expect(await runFocus(["off"], m.deps)).toBe(0)
    expect(heldOf(m.held(), "acme/app", 7, NOW.getTime())).toBeNull()
    const ops = readdirSync(join(m.data, "ops"))
    expect(ops).not.toContain("run-slot.focus")
    expect(ops.some((f) => f.startsWith("run-slot.focus.lifted-"))).toBe(true)
    expect(await standing(m.data, NOW)).toBeUndefined()
    expect(JSON.parse(readFileSync(focusPath(m.data), "utf8")).until).toBe(NOW.toISOString())
  })

  test("on with an unreadable held-prs.json fails and leaves no part standing", async () => {
    const m = machine()
    writeFileSync(m.deps.heldPath, "not json")
    expect(await on(m.deps)).toBe(1)
    expect(printed.join("\n")).toContain("focus is off, since merges could not be held")
    expect(readdirSync(join(m.data, "ops"))).not.toContain("run-slot.focus")
    expect(existsSync(focusPath(m.data))).toBe(false)
  })

  test("off with an unreadable held-prs.json still lifts the switch and ends focus.json, and says the hold stays", async () => {
    const m = machine()
    await on(m.deps)
    writeFileSync(m.deps.heldPath, "not json")
    expect(await runFocus(["off"], m.deps)).toBe(1)
    expect(printed.join("\n")).toContain("focus's merge hold stays")
    expect(readdirSync(join(m.data, "ops"))).not.toContain("run-slot.focus")
    expect(await standing(m.data, NOW)).toBeUndefined()
  })

  test("off says a ship's freeze it leaves still holds merges", async () => {
    const m = machine()
    await on(m.deps)
    await startFreeze(m.deps.heldPath, "v1.2.3", NOW)
    expect(await runFocus(["off"], m.deps)).toBe(0)
    expect(printed.join("\n")).toContain('merges stay held by another "*" line')
  })

  test("the focus-card beat posts one card once focus has ended, by off or at its end, and sets focus.json aside", async () => {
    const m = machine()
    const cards: FocusCard[] = []
    const post = async (card: FocusCard) => void cards.push(card)
    expect(await focusCard(m.data, NOW, post)).toBe("none")
    await on(m.deps)
    expect(await focusCard(m.data, new Date(NOW.getTime() + 29 * MIN), post)).toBe("standing")
    expect(cards).toEqual([])
    const end = new Date(NOW.getTime() + 30 * MIN)
    expect(await focusCard(m.data, end, post)).toBe("posted")
    expect(await focusCard(m.data, end, post)).toBe("none")
    expect(cards).toEqual([
      {
        kind: "update",
        preview: {
          outcome: "finding",
          text: "Focus was for: a timed demo\nMeasured from run-slot.runs.log.\nWhat came into the Inbox while it stood counts again.",
        },
        title: "Focus for worker-f ended: 0 runs queued while it stood, 0m0s in all",
      },
    ])
    expect(readdirSync(m.data).some((f) => f.startsWith("focus.json.ended-"))).toBe(true)

    const early = machine()
    await on(early.deps)
    await runFocus(["off"], { ...early.deps, now: () => new Date(NOW.getTime() + 5 * MIN) })
    expect(await focusCard(early.data, new Date(NOW.getTime() + 6 * MIN), post)).toBe("posted")
    expect(cards).toHaveLength(2)
  })

  test("an on before the beat has carded a lapsed focus keeps that focus's card, posted before the new one's", async () => {
    const m = machine()
    const at = (minutes: number) => ({
      ...m.deps,
      now: () => new Date(NOW.getTime() + minutes * MIN),
    })
    await runFocus(["on", "--session", "worker-a", "--for", "30", "--reason", "first"], m.deps)
    await runFocus(["off"], at(10))
    expect(
      await runFocus(
        ["on", "--session", "worker-b", "--for", "30", "--reason", "second"],
        at(10.3),
      ),
    ).toBe(0)
    const cards: FocusCard[] = []
    const post = async (card: FocusCard) => void cards.push(card)
    expect(await focusCard(m.data, new Date(NOW.getTime() + 10.6 * MIN), post)).toBe("posted")
    expect(cards.map((card) => card.title)).toEqual([
      "Focus for worker-a ended: 0 runs queued while it stood, 0m0s in all",
    ])
    expect(await standing(m.data, new Date(NOW.getTime() + 11 * MIN))).toMatchObject({
      session: "worker-b",
    })
    expect(await focusCard(m.data, new Date(NOW.getTime() + 41 * MIN), post)).toBe("posted")
    expect(cards.map((card) => card.title)).toEqual([
      "Focus for worker-a ended: 0 runs queued while it stood, 0m0s in all",
      "Focus for worker-b ended: 0 runs queued while it stood, 0m0s in all",
    ])
    expect(await focusCard(m.data, new Date(NOW.getTime() + 42 * MIN), post)).toBe("none")
  })

  test("a card that fails to post leaves focus.json for the next beat", async () => {
    const m = machine()
    await on(m.deps)
    const end = new Date(NOW.getTime() + 30 * MIN)
    await expect(
      focusCard(m.data, end, async () => {
        throw new Error("bun run ask new: refused")
      }),
    ).rejects.toThrow("refused")
    expect(existsSync(focusPath(m.data))).toBe(true)
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
    const dead = Bun.spawn(["true"])
    await dead.exited
    const gone = dead.pid
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
        `${at(3)} ask worker-c ${process.pid} bun install`,
        `${at(-30)} ask worker-e ${process.pid} bun run build`,
        `${at(5)} ask worker-g ${gone} bun run build`,
        `${at(1)} ask worker-f 14 bun run build`,
        `${at(1)} ask ops-tick 15 bun install`,
        `${at(-9)} ask worker-d 16 true`,
        `${at(-8)} start worker-d 16 run-slot waited=60s`,
      ].join("\n"),
    )
    expect(await runFocus(["off"], { ...m.deps, now: () => end })).toBe(0)
    // worker-a 2 minutes inside focus, worker-b 3 and worker-c, still waiting, 7 to off: 3 runs, 12 minutes; worker-e asked before focus and worker-g's waiter is gone, each with no start or end line, so neither counts
    expect(printed.at(-1)).toBe(
      "focus ended for worker-f: 3 runs queued while it stood, 12m0s in all (measured from run-slot.runs.log)",
    )
  })
})

test("the upkeep sessions focus leaves out of its count are the ones run-slot.sh never holds", () => {
  const holds = readFileSync(SCRIPT, "utf8").match(/case "\$WHO" in "\$h" \| (.*)\) return 1/)?.[1]
  expect(holds?.split(" | ").toSorted()).toEqual(UPKEEP)
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
