import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, stop, machine } from "./run-slot-fake"

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

// each machine's clock stands at NOW, so a line `ago` seconds back stays inside or outside the minute however long the looks take
const NOW = Math.floor(Date.now() / 1000)
const iso = (ago: number) => new Date((NOW - ago) * 1000).toISOString().replace(/\.\d+Z$/, "Z")
// run-slot.runs.log's start line for a run on slot `ago` seconds back, and its end line `ended` seconds back when given
const ran = (ops: string, pid: number, slot: string, ago: number, ended?: number) =>
  appendFileSync(
    join(ops, "run-slot.runs.log"),
    `${iso(ago)} start worker-r ${pid} ${slot} waited=0s\n` +
      (ended === undefined ? "" : `${iso(ended)} end worker-r ${pid} rc=0 ran=${ago - ended}s\n`),
  )

// #610: load1 shows a run's load about a minute after it starts, so a drained queue once started five suites in 70 s at load1 16, and load1 reached 64; while the runs started in the last minute outnumber those that ended in it, the next medium or big run waits, at any load.
describe("a burst of starts", () => {
  const medium = { RUN_SLOT_SIZE: "medium" }

  test("a medium run waits while a run started under a minute ago, with load1 under every line", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot", 10)
    expect(await m.waits("worker-m", medium)).toBe(true)
  })

  test("and starts once that run started a minute ago", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot", 61)
    expect(await m.runs("worker-m", medium)).toBe(true)
  })

  test("a clone started under a minute ago holds it too", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot-clone", 10)
    expect(await m.waits("worker-m", medium)).toBe(true)
  })

  test("a run that took the slot a run freed in the last minute adds nothing, so the next goes on", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot", 300, 15)
    ran(m.ops, 102, "run-slot", 10)
    expect(await m.runs("worker-m", medium)).toBe(true)
  })

  test("a run that started and ended inside the minute frees nothing that was held before it", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot", 40, 20)
    ran(m.ops, 102, "run-slot-2", 10)
    expect(await m.waits("worker-m", medium)).toBe(true)
  })

  test("with several waiters queued, the first starts and the rest wait for the reading", async () => {
    const m = machine({ load1: 2, now: NOW })
    writeFileSync(join(m.bin, "long"), '#!/bin/bash\ntouch "$1"\nsleep 30\n')
    chmodSync(join(m.bin, "long"), 0o755)
    const first = m.start("worker-a", medium, SCRIPT, ["long"])
    while (!existsSync(first.marker)) await Bun.sleep(20)
    try {
      expect(await Promise.all([m.waits("worker-b", medium), m.waits("worker-c", medium)])).toEqual(
        [true, true],
      )
    } finally {
      await stop(first.p)
    }
  })

  test("a single waiter on an idle machine starts at once", async () => {
    const m = machine({ load1: 2, now: NOW })
    const run = m.start("worker-m", medium)
    const waited = await run.saw(WAITING)
    if (waited) await stop(run.p)
    expect(waited).toBe(false)
    expect(await run.ran()).toBe(true)
  })

  test("a fresh small run and the merge train's go on beside a fresh start", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot", 5)
    expect(await m.runs("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.runs("ops-merge-train", medium)).toBe(true)
  })

  test("can-take answers no while a run started under a minute ago, and yes once it started a minute ago", async () => {
    const fresh = machine({ load1: 2, now: NOW })
    ran(fresh.ops, 101, "run-slot", 5)
    expect(await fresh.canTake("run-slot-2", "worker-m", medium)).toBe(false)
    const old = machine({ load1: 2, now: NOW })
    ran(old.ops, 101, "run-slot", 61)
    expect(await old.canTake("run-slot-2", "worker-m", medium)).toBe(true)
  })
})

// 7 Nov 13:10 to 13:15Z: a released backlog started 12 runs on run-slot and run-slot-2, small ones included, and load5 crossed the 15 cap at 13:16:08Z, since neither reading shows a start until about a minute after it; a small run whose waiter has waited past the backlog line also waits for the burst to clear, while a fresh small run in a queue with no backlog starts at once and the dashboard's and the merge train's runs keep their exemption
describe("a small run in a draining backlog", () => {
  const backlog = { RUN_SLOT_SIZE: "small", RUN_SLOT_BACKLOG_WAIT: "1", RUN_SLOT_POLL: "0.2" }

  test("a waited small run holds while a freed slot's minute is hot, then starts once it clears", async () => {
    const m = machine({ load1: 2, now: NOW, off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const run = m.start("worker-s", backlog)
    // saw, not waits: waits stops the run, and this one must go on to start once the minute clears
    expect(await run.saw(WAITING)).toBe(true)
    await Bun.sleep(1000)
    appendFileSync(
      join(m.ops, "run-slot.runs.log"),
      `${iso(1)} start worker-r 102 run-slot-3 waited=0s\n`,
    )
    m.release("run-slot-2")
    await Bun.sleep(3000)
    const startedHot = existsSync(run.marker)
    appendFileSync(join(m.ops, "run-slot.runs.log"), `${iso(0)} end worker-r 102 rc=0 ran=1s\n`)
    expect(await run.ran()).toBe(true)
    expect(startedHot).toBe(false)
  })

  test("with no backlog a small run starts at once", async () => {
    const m = machine({ load1: 2, now: NOW })
    expect(await m.runs("worker-s", backlog)).toBe(true)
  })

  test("the dashboard's and the merge train's runs still start in a backlog", async () => {
    const m = machine({ load1: 2, now: NOW })
    ran(m.ops, 101, "run-slot", 10)
    expect(await m.runs("ops-dashboard", { RUN_SLOT_BACKLOG_WAIT: "1" })).toBe(true)
    expect(await m.runs("ops-merge-train", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  for (const [label, ns, want] of [
    ["an old small ticket", 1, false],
    ["a fresh small ticket", Date.now() * 1_000_000, true],
  ] as const)
    test(`can-take inside a burst answers ${want} for ${label}`, async () => {
      const m = machine({ load1: 2, now: NOW })
      ran(m.ops, 101, "run-slot", 10)
      m.ticket(ns, "worker-s", "s2 22 1 small")
      expect(await m.canTake("run-slot-2", `${ns}-${process.pid}-worker-s`)).toBe(want)
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

  // A run for a GitHub org ext.links guards goes first; a checker reads its worker's PR, and the CPU 30% idle leaves run-slot the one slot
  const order = async (priority?: string, pr = "https://github.com/acme-co/web/pull/1") => {
    const m = machine({
      idle: 30,
      roster: {
        agents: [
          { name: "worker-lw", pr },
          { name: "reviewer-lw", worker: "worker-lw" },
        ],
      },
    })
    if (priority) writeFileSync(join(m.ops, "run-slot.priority"), `${priority}\n`)
    m.hold("run-slot", 1, "small")
    const own = m.start("worker-made", { RUN_SLOT_SIZE: "small" })
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
    expect(await order()).toEqual(["reviewer-lw", "worker-made"])
  })

  test("a waiter on an org ext.links does not guard keeps its place", async () => {
    expect(await order(undefined, "https://github.com/other-co/web/pull/1")).toEqual([
      "worker-made",
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
    expect(await order("worker-made")).toEqual(["worker-made", "reviewer-lw"])
  })

  // 4 Nov: a commit's build queued as commit-<worktree> waited 2 h while the priority named the session committing in that worktree
  const commitOrder = async (from: string) => {
    const m = machine({ idle: 30 })
    writeFileSync(join(m.ops, "run-slot.priority"), "worker-p\n")
    const tree = join(m.root, ".claude", "worktrees", from)
    mkdirSync(tree, { recursive: true })
    expect(await m.start("worker-p", {}, undefined, ["touch"], tree).ran()).toBe(true)
    m.hold("run-slot", 1, "small")
    const other = m.start("worker-o", { RUN_SLOT_SIZE: "small" })
    expect(await other.saw(WAITING)).toBe(true)
    const commit = m.start("commit-wt-p", { RUN_SLOT_SIZE: "small" })
    expect(await commit.saw(WAITING)).toBe(true)
    m.release("run-slot")
    expect(await other.ran()).toBe(true)
    expect(await commit.ran()).toBe(true)
    return readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
      .split("\n")
      .filter((l) => l.split(" ")[1] === "start")
      .map((l) => l.split(" ")[2])
      .slice(1)
  }

  test("and the pick's commit step, from a worktree the picked session last ran from, takes the slot before an older waiter", async () => {
    expect(await commitOrder("wt-p")).toEqual(["commit-wt-p", "worker-o"])
  })

  test("while a commit step from a worktree the pick never ran from keeps its place", async () => {
    expect(await commitOrder("wt-q")).toEqual(["worker-o", "commit-wt-p"])
  })

  // 4 Nov: with the pick on one session, its merge asked later took a slot before its older one
  test("the pick's own runs go oldest first, so a newer one waits while its older ticket waits", async () => {
    const m = machine()
    writeFileSync(join(m.ops, "run-slot.priority"), "worker-p\n")
    m.ticket(1, "worker-p", "s2 22 2 medium")
    const newer = m.start("worker-p", { RUN_SLOT_SIZE: "small" })
    expect(await newer.saw(WAITING)).toBe(true)
    await stop(newer.p)
    expect(existsSync(newer.marker)).toBe(false)
  })
})
