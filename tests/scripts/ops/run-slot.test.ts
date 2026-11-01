import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { WAITING, stop, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang: 60s, twice the slowest case under SLOW_CHILD=1.5 but local CI's, which sets its own
setDefaultTimeout(60_000)

describe("an item's size", () => {
  test("RUN_SLOT_SIZE names it outright", async () => {
    expect(await machine().size("worker-x", { RUN_SLOT_SIZE: "big" })).toBe("big 3")
  })

  test("the roster entry's size", async () => {
    const m = machine({ roster: { agents: [{ name: "worker-x", size: "small" }] } })
    expect(await m.size("worker-x")).toBe("small 1")
  })

  test("a checker reads its worker's size", async () => {
    const m = machine({
      roster: {
        agents: [
          { name: "worker-x", size: "big" },
          { name: "reviewer-x", worker: "worker-x" },
        ],
      },
    })
    expect(await m.size("reviewer-x")).toBe("big 3")
  })

  test("Checks on PR n read the worker on that PR, not its checkers", async () => {
    const pr = "https://github.com/acme/app/pull/42"
    const m = machine({
      roster: {
        agents: [
          { name: "reviewer-x", pr, size: "big" },
          { name: "worker-x", pr, size: "small" },
        ],
      },
    })
    expect(await m.size("ops-checks-42")).toBe("small 1")
  })

  test("Checks on PR n pass over a checker named <id>-<kind> or with the roster's checker kind", async () => {
    const pr = "https://github.com/acme/app/pull/42"
    const m = machine({
      roster: {
        agents: [
          { name: "k3v9q2-reviewer", pr, size: "big" },
          { kind: "tester", name: "b7k2mq", pr, size: "big" },
          { name: "k3v9q2-worker", pr, size: "small" },
        ],
      },
    })
    expect(await m.size("ops-checks-42")).toBe("small 1")
  })

  test("Checks on PR n read only factory.repo's PR n", async () => {
    const m = machine({
      roster: {
        agents: [{ name: "worker-x", pr: "https://github.com/other/repo/pull/42", size: "small" }],
      },
    })
    expect(await m.size("ops-checks-42")).toBe("medium 2")
  })

  test("Checks under ops-checks-<n> read PR n's worker as ops-checks-<n> does", async () => {
    const pr = "https://github.com/acme/app/pull/42"
    const m = machine({ roster: { agents: [{ name: "k3v9q2-worker", pr, size: "small" }] } })
    expect(await m.size("ops-checks-42")).toBe("small 1")
  })

  test("the plan.json item its branch names, in either case", async () => {
    for (const branch of ["PG-7-thing", "pg-7-thing"]) {
      const m = machine({
        plan: { lanes: [{ items: [{ id: "PG-7", size: "big" }] }] },
        roster: { agents: [{ branch, name: "worker-x" }] },
      })
      expect(await m.size("worker-x")).toBe("big 3")
    }
  })

  test("the plan.json item whose spec is the issue its branch names", async () => {
    const m = machine({
      plan: {
        inFlight: [{ id: "x", size: "small", spec: "https://github.com/acme/app/issues/8" }],
      },
      roster: { agents: [{ branch: "pg-8-thing", name: "worker-x" }] },
    })
    expect(await m.size("worker-x")).toBe("small 1")
  })

  test("the plan.json item the checkout's branch names, when the roster names none", async () => {
    const m = machine({
      plan: { lanes: [{ items: [{ id: "PG-9", size: "big" }] }] },
      roster: { agents: [{ name: "worker-x" }] },
    })
    const repo = (branch: string) => {
      const dir = join(m.root, branch)
      mkdirSync(dir)
      Bun.spawnSync(["git", "init", "-q", "-b", branch], { cwd: dir })
      return dir
    }
    expect(await m.size("worker-x", {}, repo("pg-9-x"))).toBe("big 3")
    expect(await m.size("worker-x", {}, repo("pg-10-x"))).toBe("medium 2")
  })

  test("a commit's pre-commit build is small, whatever its branch's item", async () => {
    const m = machine({ plan: { lanes: [{ items: [{ id: "PG-9", size: "big" }] }] } })
    Bun.spawnSync(["git", "init", "-q", "-b", "pg-9-x"], { cwd: m.root })
    expect(await m.size("commit-pg-9-x")).toBe("small 1")
  })

  test("medium when nothing says", async () => {
    const m = machine({
      plan: { lanes: [] },
      roster: { agents: [{ name: "worker-x", size: "huge" }] },
    })
    expect(await m.size("worker-x")).toBe("medium 2")
    expect(await m.size("worker-none")).toBe("medium 2")
  })
})

// Slots 3 and 4 closed, as tonight's hold has them: 2 slots give 4 units, 1 of them kept for small runs and the runs that gate a merge.
describe("load units", () => {
  const held = () => machine({ off: ["run-slot.3-off", "run-slot.4-off"] })

  test("a small run starts while a big one holds the rest", async () => {
    const m = held()
    m.hold("run-slot", 3, "big")
    expect(await m.runs("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a medium build waits while a big one holds the rest", async () => {
    const m = held()
    m.hold("run-slot", 3, "big")
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("a second medium build leaves the small reserve free", async () => {
    const m = held()
    m.hold("run-slot", 2, "medium")
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("a medium run that gates a merge may use the reserve", async () => {
    const m = held()
    m.hold("run-slot", 2, "medium")
    expect(await m.runs("ops-checks-9", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("so may one under ops-checks-<n>", async () => {
    const m = held()
    m.hold("run-slot", 2, "medium")
    expect(await m.runs("ops-checks-9", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  // 02:49Z on 22 Oct: a pre-commit build on a ticket's branch, sized big from that item, waited 815s while 4 units were held, so a big run did not fit
  test("a pre-commit build takes a free slot beside 4 held units and a medium waiter", async () => {
    const m = machine({ plan: { lanes: [{ items: [{ id: "PG-9", size: "big" }] }] } })
    Bun.spawnSync(["git", "init", "-q", "-b", "pg-9-x"], { cwd: m.root })
    m.hold("run-slot-2", 2, "medium")
    m.hold("run-slot-3", 2, "medium")
    m.ticket(1, "worker-m", "s2 22 2 medium")
    const commit = m.start("commit-pg-9-x")
    const waited = await commit.saw(WAITING)
    if (waited) await stop(commit.p)
    expect(waited).toBe(false)
    expect(await commit.ran()).toBe(true)
  })

  test("a big run starts on a quiet machine", async () => {
    const m = machine({ load1: 20 })
    expect(await m.runs("worker-b", { RUN_SLOT_SIZE: "big" })).toBe(true)
  })
})

describe("the queue's order", () => {
  test("a small waiter goes before an older medium one", async () => {
    const m = machine()
    m.ticket(1, "worker-small", "s2 21 1 small")
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("a medium waiter goes before an older big one", async () => {
    const m = machine()
    m.ticket(1, "worker-big", "s2 23 3 big")
    expect(await m.runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("a run that gates a merge goes before an older small worker's", async () => {
    const m = machine()
    m.ticket(1, "worker-x", "s2 21 1 small")
    expect(await m.runs("ops-checks-9", { RUN_SLOT_SIZE: "big" })).toBe(true)
  })

  test("an older copy's plain ticket keeps its place by age", async () => {
    const m = machine()
    m.ticket(1, "worker-old", "s2")
    expect(await m.waits("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  // review round 1: local CI writes a plain "s2" ticket and takes a slot only while its ticket is the oldest live one
  test("local CI's plain ticket stays behind an older big waiter and ahead of a newer medium", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 1, "small")
    const big = m.start("worker-b", { RUN_SLOT_SIZE: "big" })
    while (!m.tickets().some((t) => t.endsWith("-worker-b"))) await Bun.sleep(50)
    m.ticket(Date.now() * 1e6, "ops-localci", "s2")
    await Bun.sleep(50)
    const medium = m.start("worker-m", { RUN_SLOT_SIZE: "medium" })
    expect(await medium.saw(WAITING)).toBe(true)
    m.release("run-slot")
    expect(await big.ran()).toBe(true)
    // waits() puts its first dead ticket after big's run ended, so the look before the one that clears the fifth began and decided after it
    expect(await medium.waits()).toBe(true)
    // SLOW_CHILD=5, the load that turned it red on CI, takes it about 82s
  }, 180_000)

  // A run for a GitHub org ext.links guards goes first; a checker reads its worker's PR, and load1 15 leaves run-slot the one slot
  const order = async (priority?: string, pr = "https://github.com/acme-co/web/pull/1") => {
    const m = machine({
      load1: 15,
      roster: {
        agents: [
          { name: "worker-lw", pr },
          { name: "reviewer-lw", worker: "worker-lw" },
        ],
      },
    })
    if (priority) writeFileSync(join(m.ops, "run-slot.priority"), `${priority}\n`)
    m.hold("run-slot", 1, "small")
    const own = m.start("worker-lm", { RUN_SLOT_SIZE: "small" })
    expect(await own.saw(WAITING)).toBe(true)
    const org = m.start("reviewer-lw", { RUN_SLOT_SIZE: "small" })
    expect(await org.saw(WAITING)).toBe(true)
    m.release("run-slot")
    expect(await org.ran()).toBe(true)
    expect(await own.ran()).toBe(true)
    return readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
      .split("\n")
      .filter((l) => l.split(" ")[1] === "start")
      .map((l) => l.split(" ")[2])
  }

  test("an org's waiter takes the freed slot before an older one of the factory's", async () => {
    expect(await order()).toEqual(["reviewer-lw", "worker-lm"])
  })

  test("a waiter on an org ext.links does not guard keeps its place", async () => {
    expect(await order(undefined, "https://github.com/other-co/web/pull/1")).toEqual([
      "worker-lm",
      "reviewer-lw",
    ])
  })

  test("and before an older Checks run in the ready line, by its repo", async () => {
    const m = machine({
      mergeQueue: { queue: [{ pr: 7, readyAt: "2026-10-19T00:00:00Z" }] },
      roster: { agents: [{ name: "worker-lw", repo: "acme-co/web" }] },
    })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.runs("worker-lw", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("and may use the reserve, so a gating medium does not pass it", async () => {
    const m = machine({
      off: ["run-slot.3-off", "run-slot.4-off"],
      roster: { agents: [{ name: "worker-lw", repo: "acme-co/web" }] },
    })
    m.hold("run-slot", 2, "medium")
    m.ticket(1, "ops-checks-9", "s2 02 2 medium")
    expect(await m.runs("worker-lw", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("but not before the run-slot.priority pick", async () => {
    expect(await order("worker-lm")).toEqual(["worker-lm", "reviewer-lw"])
  })
})
