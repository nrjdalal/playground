import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Subprocess } from "bun"

import { settingsFor } from "../../../packages/settings/src/settings"
import { slotSettings } from "../../../packages/settings/src/slots"
import { slowChild } from "../../slow-child"

// Load is weighed by size, so a big plan never blocks small runs: small, medium and big weigh 1, 2 and 3.
const SCRIPT = join(import.meta.dir, "../../../scripts/ops/run-slot.sh")
// a check waits on its run's exit or a line it prints, so the timeout only catches a hang: 60s, twice the slowest case under SLOW_CHILD=1.5 but local CI's, which sets its own
setDefaultTimeout(60_000)
// run-slot.sh's line for a look that takes no slot
const WAITING = /^run-slot\.sh: (queued behind|waiting for) /gm
// Stops a run whose verdict is already read: SIGTERM, then SIGKILL after 5s, since a waiter on GitHub's Linux runner outlived its SIGTERM by 24s for a cause not yet known and timed the test out
const stop = async (p: Subprocess) => {
  p.kill("SIGTERM")
  if (await Promise.race([p.exited.then(() => true), Bun.sleep(5_000).then(() => false)])) return
  p.kill("SIGKILL")
  await p.exited
}

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

type Setup = {
  free?: number
  load1?: number
  load5?: number
  mergeQueue?: unknown
  off?: string[]
  peers?: string[]
  plan?: unknown
  pressure?: number
  roster?: unknown
}

// A scratch state folder and config folder, with a fake sysctl on PATH giving 15 cores, the load asked for (load5 and load15 as load1 unless given) and normal memory.
const machine = ({
  free = 80,
  load1 = 2,
  load5 = load1,
  mergeQueue,
  off = [],
  peers = [],
  plan,
  pressure = 1,
  roster,
}: Setup = {}) => {
  const root = mkdtempSync(join(tmpdir(), "run-slot-"))
  dirs.push(root)
  const ops = join(root, "ops")
  const config = join(root, "claude")
  const bin = join(root, "bin")
  for (const dir of [ops, join(config, "playground", "bundles"), bin])
    mkdirSync(dir, { recursive: true })
  for (const name of off) writeFileSync(join(ops, name), "")
  if (roster) writeFileSync(join(config, "playground", "roster.json"), JSON.stringify(roster))
  if (plan) writeFileSync(join(config, "playground", "bundles", "plan.json"), JSON.stringify(plan))
  if (mergeQueue)
    writeFileSync(join(config, "playground", "merge-queue.json"), JSON.stringify(mergeQueue))
  writeFileSync(
    join(bin, "sysctl"),
    `#!/bin/bash
echo "$2" >> ${join(root, "sysctl.log")}
case "$2" in
  hw.ncpu) echo 15 ;;
  vm.loadavg) echo "{ ${load1}.00 ${load5}.00 ${load5}.00 }" ;;
  kern.memorystatus_level) echo ${free} ;;
  kern.memorystatus_vm_pressure_level) echo ${pressure} ;;
esac
`,
  )
  chmodSync(join(bin, "sysctl"), 0o755)
  // the settings reader answers factory.repo, the guarded orgs and slots.peers as a store that sets them would, and every other key as the real one does
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/bash\n[ "$2" = factory.repo ] && { echo '"acme/app"'; exit 0; }\n[ "$2" = --guarded-orgs ] && { echo '["acme-co"]'; exit 0; }\n[ "$2" = slots.peers ] && { echo '${JSON.stringify(peers)}'; exit 0; }\nexec ${process.execPath} "$@"\n`,
  )
  chmodSync(join(bin, "bun"), 0o755)
  // SLOW_CHILD puts a slowed python3 in the fake bin folder, which PATH reads first
  slowChild("python3", bin)
  const env = (extra: Record<string, string> = {}) => ({
    CLAUDE_CONFIG_DIR: config,
    PLAYGROUND_DATA_DIR: join(config, "playground"),
    HOME: root,
    PATH: `${bin}:${process.env.PATH}`,
    RUN_SLOT_OPS: ops,
    RUN_SLOT_POLL: "0.2",
    ...extra,
  })
  // A slot already held by this test's own process, which stays alive throughout.
  const hold = (slot: string, units: number, size: string) => {
    mkdirSync(join(ops, slot))
    writeFileSync(
      join(ops, `${slot}.holder`),
      `worker-held ${process.pid} 2026-10-18T19:00:00Z ${units} ${size}\n`,
    )
  }
  const release = (slot: string) => {
    rmSync(join(ops, slot), { force: true, recursive: true })
    rmSync(join(ops, `${slot}.holder`), { force: true })
  }
  // A waiter's ticket from a live process (this test's), as run-slot.sh writes one, its mtime `ago` seconds back.
  const ticket = (ns: number, who: string, line: string, ago = 0) => {
    mkdirSync(join(ops, "run-slot.waiters"), { recursive: true })
    const path = join(ops, "run-slot.waiters", `${ns}-${process.pid}-${who}`)
    writeFileSync(path, `${line}\n`)
    const at = Date.now() / 1000 - ago
    utimesSync(path, at, at)
  }
  const tickets = () =>
    existsSync(join(ops, "run-slot.waiters")) ? readdirSync(join(ops, "run-slot.waiters")) : []
  // Starts `touch <marker>` through run-slot (or the copy at `script`) in the background, reading its stderr as it comes. Each check waits on an event (the run's exit, a line it prints), never a wall-clock budget, so a loaded runner only makes it slower.
  const start = (who: string, extra: Record<string, string> = {}, script = SCRIPT) => {
    const marker = join(root, `ran-${who}-${Math.random()}`)
    const p = Bun.spawn(["bash", script, who, "--", "touch", marker], {
      cwd: root,
      env: env(extra),
      stderr: "pipe",
    })
    let err = ""
    let ended = false
    void p.exited.then(() => (ended = true))
    const read = (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    const lines = (re: RegExp) => err.match(re)?.length ?? 0
    // whether `n` lines matching `re` arrived before it ended; `re` takes the g flag, since match without it returns one match's groups
    const saw = async (re: RegExp, n = 1) => {
      while (!ended && lines(re) < n) await Bun.sleep(20)
      if (ended) await read
      return lines(re) >= n
    }
    // whether it ran, read once it has ended
    const ran = async () => {
      await p.exited
      return existsSync(marker)
    }
    // whether it printed a waiting line, as a look that takes no slot does, and kept waiting through its first three looks without running; it is stopped then, and it needs a waiter that left a ticket, as every worker-* and ops-checks-* one does
    const waits = async () => {
      let waiting = await saw(WAITING)
      // a look removes at most one dead ticket in each of its two queue reads before it decides, so the fifth goes no earlier than the fourth look, after three looks decided to wait
      for (let i = 0; i < 5 && waiting; i++) waiting = await lookedAgain()
      waiting &&= !existsSync(marker)
      await stop(p)
      return waiting
    }
    // Puts a dead waiter's ticket in the queue and says whether this waiter, as the one live waiter left, removed it in a look and is still waiting; false at once if it ends first, and a ticket that never goes (a run-slot.priority pick skips the queue reads) fails by the timeout, never as a pass
    const lookedAgain = async () => {
      const gone = Bun.spawn(["true"])
      await gone.exited
      const path = join(ops, "run-slot.waiters", `1-${gone.pid}-worker-gone`)
      writeFileSync(path, "s2 21 1 small\n")
      while (!ended && existsSync(path)) await Bun.sleep(20)
      return !ended && !existsSync(marker)
    }
    return { marker, p, ran, saw, waits }
  }
  const canTake = async (slot: string, who: string, extra: Record<string, string> = {}) => {
    const p = Bun.spawn(["bash", SCRIPT, "can-take", slot, who], { cwd: root, env: env(extra) })
    return (await p.exited) === 0
  }
  const size = async (who: string, extra: Record<string, string> = {}, cwd = root) => {
    const p = Bun.spawn(["bash", SCRIPT, "size", who], {
      cwd,
      env: env(extra),
      stdout: "pipe",
    })
    await p.exited
    return (await new Response(p.stdout).text()).trim()
  }
  // Runs `touch <marker>` through run-slot and reports whether it ran, or whether it waited on its first look
  const runs = (who: string, extra: Record<string, string> = {}) => start(who, extra).ran()
  const waits = (who: string, extra: Record<string, string> = {}) => start(who, extra).waits()
  // the times run-slot.sh has read the memory pressure level, which clone-off's gate reads once a check
  const pressureReads = () =>
    existsSync(join(root, "sysctl.log"))
      ? readFileSync(join(root, "sysctl.log"), "utf8")
          .split("\n")
          .filter((l) => l === "kern.memorystatus_vm_pressure_level").length
      : 0
  // Clones the folder named by `from` (relative to the scratch root) through run-slot and reports whether the copy landed (cp -R, since -c is the Mac's alone and the clone slot reads only cp and the path): once it ends, or once clone-off's gate has held it, since a clone it lets through reads the pressure level twice and goes on, and one it holds reads it again each RUN_SLOT_POLL.
  const clones = async (from: string, who = "worker-c", prefix: string[] = []) => {
    mkdirSync(join(root, "x", "node_modules"), { recursive: true })
    const to = `copy-${Math.random()}`
    const before = pressureReads()
    const p = Bun.spawn(["bash", SCRIPT, who, "--", ...prefix, "cp", "-R", from, to], {
      cwd: from.startsWith("node_modules") ? join(root, "x") : root,
      env: env(),
      stderr: "ignore",
    })
    let ended = false
    void p.exited.then(() => (ended = true))
    while (!ended && pressureReads() - before < 3) await Bun.sleep(20)
    if (!ended) await stop(p)
    return existsSync(join(from.startsWith("node_modules") ? join(root, "x") : root, to))
  }
  return {
    bin,
    canTake,
    clones,
    env,
    hold,
    ops,
    release,
    root,
    runs,
    size,
    start,
    ticket,
    tickets,
    waits,
  }
}

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

// dispatcher, 19 Oct: Checks on a PR in the ready line (merge-queue.json's entries with a readyAt) goes first, by goAt then readyAt
describe("the ready line", () => {
  const line = (goAt7: string, goAt8: string) => ({
    queue: [
      { goAt: goAt7, pr: 7, readyAt: "2026-10-19T00:00:00Z" },
      { goAt: goAt8, pr: 8, readyAt: "2026-10-19T00:05:00Z" },
      { pr: 9 },
    ],
  })

  test("Checks for a PR earlier in it passes an older gate and a small run", async () => {
    const m = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    m.ticket(2, "worker-small", "s2 21 1 small")
    expect(await m.runs("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("and waits for one with an earlier goAt", async () => {
    const m = machine({ mergeQueue: line("2026-10-19T00:10:00Z", "2026-10-19T00:20:00Z") })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("an ops-checks-<n> run takes its PR's place in it too", async () => {
    const m = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.runs("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("PLAYGROUND_MERGE_QUEUE names the file", async () => {
    const m = machine()
    const file = join(m.root, "queue.json")
    writeFileSync(file, JSON.stringify(line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z")))
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    const env = { PLAYGROUND_MERGE_QUEUE: file, RUN_SLOT_SIZE: "medium" }
    expect(await m.runs("ops-checks-8", env)).toBe(true)
  })

  test("with no merge-queue.json, ranks nothing", async () => {
    const m = machine()
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("never passes an older pinned big ticket", async () => {
    const aged = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    aged.ticket(1, "worker-big", "s2 23 3 big", 21 * 60)
    expect(await aged.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("never passes local CI's older pinned ticket", async () => {
    const localci = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    localci.ticket(1, "ops-localci", "s2")
    expect(await localci.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })
})

// review round 1: a big run let every smaller run pass it, so it could wait all night
describe("a waiter that has waited 20 minutes", () => {
  const held = () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 1, "small")
    return m
  }

  test("lets no newer run pass it", async () => {
    const m = held()
    m.ticket(1, "worker-big", "s2 23 3 big", 21 * 60)
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("while one that has waited less lets a run that fits go", async () => {
    const m = held()
    m.ticket(1, "worker-big", "s2 23 3 big", 19 * 60)
    expect(await m.runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })
})

// dispatcher, 18 Oct: a waiter started before a run-slot change kept the old copy's rules
describe("a waiter whose script is replaced", () => {
  test("runs the new copy with its own arguments and leaves its ticket", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    const copy = join(m.root, "run-slot.sh")
    copyFileSync(SCRIPT, copy)
    const waiter = m.start("worker-m", { RUN_SLOT_SIZE: "medium" }, copy)
    while (!m.tickets().some((t) => t.endsWith("-worker-m"))) await Bun.sleep(50)
    const out = join(m.root, "reexec")
    writeFileSync(`${copy}.new`, `#!/bin/bash\nprintf '%s\\n' "$@" > ${out}\n`)
    renameSync(`${copy}.new`, copy)
    expect(await waiter.p.exited).toBe(0)
    expect(readFileSync(out, "utf8")).toBe(`worker-m\n--\ntouch\n${waiter.marker}\n`)
    expect(m.tickets()).toEqual([])
  })

  // review round 4: the new copy takes the first ask's time, so the runs log has one ask and the whole wait
  test("its wait is logged as one ask", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    const copy = join(m.root, "run-slot.sh")
    copyFileSync(SCRIPT, copy)
    const waiter = m.start("worker-m", { RUN_SLOT_SIZE: "medium" }, copy)
    while (!m.tickets().some((t) => t.endsWith("-worker-m"))) await Bun.sleep(50)
    copyFileSync(SCRIPT, `${copy}.new`)
    renameSync(`${copy}.new`, copy)
    // the log's waited= counts whole seconds, so the wait lasts at least one
    await Promise.all([waiter.saw(/running the new copy/g), Bun.sleep(1_000)])
    m.release("run-slot")
    expect(await waiter.ran()).toBe(true)
    const log = readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
    expect(log.match(/ ask worker-m /g)).toHaveLength(1)
    expect(log).toMatch(/ start worker-m \d+ run-slot(-\d)? waited=[1-9]\d*s\n/)
  })
})

// builder, 18 Oct (a review): a clone named without a folder before node_modules missed clone-off, which passes at load1 and load5 under 30 and spawn.sh's memory gate
describe("a node_modules clone waits while clone-off stands", () => {
  const off = ["run-slot.clone-off"]
  for (const from of ["x/node_modules", "node_modules", "node_modules/", "./node_modules"])
    test(from, async () => {
      expect(await machine({ off, pressure: 4 }).clones(from)).toBe(false)
    })

  test("and the machine is loaded", async () => {
    expect(await machine({ load1: 30, off }).clones("node_modules")).toBe(false)
  })

  // optimizer, 19 Oct 03:42Z: a clone let through at load5 under 30 took load1 to 73
  test("and load1 is 30 while load5 is under it", async () => {
    expect(await machine({ load1: 30, load5: 2, off }).clones("node_modules")).toBe(false)
  })

  test("behind env and VAR=x words", async () => {
    expect(
      await machine({ off, pressure: 4 }).clones("node_modules", "worker-c", ["env", "X=1"]),
    ).toBe(false)
  })

  test("but goes on normal pressure and load1 and load5 under 30", async () => {
    expect(await machine({ load1: 29, off }).clones("node_modules")).toBe(true)
  })

  test("and on warn pressure with 8% free", async () => {
    expect(await machine({ free: 8, off, pressure: 2 }).clones("node_modules")).toBe(true)
  })

  test("but holds on warn pressure with 7% free", async () => {
    expect(await machine({ free: 7, off, pressure: 2 }).clones("node_modules")).toBe(false)
  })

  test("and runs once it is gone", async () => {
    expect(await machine().clones("node_modules")).toBe(true)
  })

  test("but for a session clone-allow's patterns name", async () => {
    const m = machine({ off, pressure: 4 })
    writeFileSync(join(m.ops, "run-slot.clone-allow"), "tester-.*\n")
    expect(await m.clones("node_modules", "tester-sloth")).toBe(true)
    expect(await m.clones("node_modules", "worker-c")).toBe(false)
  })
})

// A fake git and bun on PATH touch their last argument, so a run through run-slot shows whether it ran while a big run holds the queue's units.
describe("a quick run takes its own slot past a full queue", () => {
  // Runs argv through run-slot past a full queue and says whether it ran: once it ends, or once it prints the queue's waiting line, when it is stopped (an event, never a clock, so a loaded runner only makes it slower)
  const quick = async (argv: string[]) => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    for (const bin of ["bun", "git"]) {
      writeFileSync(join(m.bin, bin), '#!/bin/bash\ntouch "${@: -1}"\n')
      chmodSync(join(m.bin, bin), 0o755)
    }
    const marker = join(m.root, "a.test.ts")
    const p = Bun.spawn(["bash", SCRIPT, "worker-q", "--", ...argv, marker], {
      cwd: m.root,
      env: m.env({ RUN_SLOT_SIZE: "medium" }),
      stderr: "pipe",
    })
    let err = ""
    let ended = false
    void p.exited.then(() => (ended = true))
    void (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    while (!ended && !err.match(WAITING)) await Bun.sleep(20)
    if (!ended) await stop(p)
    return existsSync(marker)
  }

  // optimizer, 19 Oct: a commit run as env NODE_ENV=... git commit waited 14 min in the queue
  test("git commit", async () => {
    expect(await quick(["git", "commit"])).toBe(true)
  })

  test("env NODE_ENV=x git commit", async () => {
    expect(await quick(["env", "NODE_ENV=x", "git", "commit"])).toBe(true)
  })

  // optimizer, 20 Oct: a 1s git merge waited 26.6 min behind suites
  test("git merge", async () => {
    expect(await quick(["git", "-C", "x", "merge"])).toBe(true)
  })

  test("git pull", async () => {
    expect(await quick(["git", "pull"])).toBe(true)
  })

  // run-slot.runs.log, 20 Oct: docs:wrap and format:check ran 2s and 9s at most
  test("bun run docs:wrap", async () => {
    expect(await quick(["bun", "run", "docs:wrap"])).toBe(true)
  })

  test("bun run --cwd=<dir> format:check", async () => {
    expect(await quick(["bun", "run", "--cwd=x", "format:check"])).toBe(true)
  })

  test("but not another bun run script", async () => {
    expect(await quick(["bun", "run", "build"])).toBe(false)
  })

  // ops, 20 Oct: with slot-off, a 5-file run that ran 1s waited 52 min behind suites
  test("bun test naming one test file", async () => {
    expect(await quick(["env", "X=1", "bun", "test"])).toBe(true)
  })

  test("bun --cwd=<dir> test naming three test files", async () => {
    expect(await quick(["bun", "--cwd=x", "test", "b.test.ts", "c.test.tsx"])).toBe(true)
  })

  test("but not a bun test naming four", async () => {
    expect(await quick(["bun", "test", "b.test.ts", "c.test.ts", "d.test.ts"])).toBe(false)
  })

  test("nor an end-to-end test", async () => {
    expect(await quick(["bun", "test", "b.e2e.test.ts"])).toBe(false)
  })

  test("nor a bun test with a word that is no test file", async () => {
    expect(await quick(["bun", "test", "-t", "name"])).toBe(false)
  })

  test("bun run test:file naming one test file", async () => {
    expect(await quick(["bun", "run", "test:file"])).toBe(true)
  })

  test("but not bun run test naming one", async () => {
    expect(await quick(["bun", "run", "test"])).toBe(false)
  })

  // --cwd=<p> took the quick slot only by accident (the VAR=x skip ate it), while --cwd <p> read the path as a word that is no test file
  test("bun run --cwd=<dir> test:file naming one test file", async () => {
    expect(await quick(["bun", "run", "--cwd=x", "test:file"])).toBe(true)
  })

  test("bun test --cwd <dir> naming two test files", async () => {
    expect(await quick(["bun", "test", "--cwd", "x", "b.test.ts"])).toBe(true)
  })

  test("bun run --cwd <dir> test:file naming one test file", async () => {
    expect(await quick(["bun", "run", "--cwd", "x", "test:file"])).toBe(true)
  })

  test("bun --cwd=<dir> run test:file naming one test file", async () => {
    expect(await quick(["bun", "--cwd=x", "run", "test:file"])).toBe(true)
  })

  // a bare --cwd before the subcommand stays off the quick slot: bun misreads that shape and runs package.json's script instead (no-false-green)
  test("but not a bun --cwd <dir> test, which bun runs as package.json's test script", async () => {
    expect(await quick(["bun", "--cwd", "x", "test", "b.test.ts"])).toBe(false)
  })

  test("nor a bun --cwd <dir> run", async () => {
    expect(await quick(["bun", "--cwd", "x", "run", "test:file"])).toBe(false)
  })

  test("but not a bun test --cwd <dir> naming four", async () => {
    expect(await quick(["bun", "test", "--cwd", "x", "b.test.ts", "c.test.ts", "d.test.ts"])).toBe(
      false,
    )
  })

  test("nor a bun test --cwd <dir> end-to-end test", async () => {
    expect(await quick(["bun", "test", "--cwd", "x", "b.e2e.test.ts"])).toBe(false)
  })
})

// 22 Oct: `run-slot.sh <name> -- python - <<EOF` read an empty program and exited 0, since bash gives a script's background job /dev/null
describe("the command reads run-slot's own stdin", () => {
  // Runs argv through run-slot from bash, with `heredoc` as a heredoc on its stdin, or its stdin closed when null, returning its exit code and stdout
  const piped = async (argv: string[], heredoc: string | null) => {
    const m = machine()
    // reads stdin for `commit` alone, since run-slot calls `git symbolic-ref` itself first and a fake reading it there takes the command's input
    writeFileSync(join(m.bin, "git"), '#!/bin/bash\n[ "$1" != commit ] || cat > "$GIT_INPUT"\n')
    chmodSync(join(m.bin, "git"), 0o755)
    const gitInput = join(m.root, "git-input")
    const script = heredoc === null ? '"$@" <&-' : `"$@" <<'EOF'\n${heredoc}EOF\n`
    const p = Bun.spawn(["bash", "-c", script, "bash", "bash", SCRIPT, "worker-x", "--", ...argv], {
      cwd: m.root,
      env: m.env({ GIT_INPUT: gitInput }),
      stdout: "pipe",
    })
    const out = await new Response(p.stdout).text()
    return { code: await p.exited, gitInput: () => readFileSync(gitInput, "utf8"), out }
  }

  test("a heredoc program runs, and its exit code comes back", async () => {
    const r = await piped(["python3", "-"], 'print("stdin-marker")\nraise SystemExit(3)\n')
    expect(r.out).toContain("stdin-marker")
    expect(r.code).toBe(3)
  })

  test("so does a quick run's", async () => {
    const r = await piped(["git", "commit", "-F", "-"], "fix: a message\n")
    expect(r.code).toBe(0)
    expect(r.gitInput()).toBe("fix: a message\n")
  })

  test("a command that reads no stdin runs as before", async () => {
    const r = await piped(["python3", "-c", 'print("no-stdin")'], "unread\n")
    expect(r.out).toBe("no-stdin\n")
    expect(r.code).toBe(0)
  })

  test("a closed stdin gives the command an empty one, as before", async () => {
    const r = await piped(["python3", "-c", "import sys; print(repr(sys.stdin.read()))"], null)
    expect(r.out).toBe("''\n")
    expect(r.code).toBe(0)
  })
})

describe("one argument holding a list of paths", () => {
  test("a joined list of real paths warns, and the run goes ahead as before", async () => {
    const m = machine()
    writeFileSync(join(m.root, "a.test.ts"), "")
    writeFileSync(join(m.root, "b.test.ts"), "")
    const p = Bun.spawn(["bash", SCRIPT, "worker-x", "--", "touch", "a.test.ts b.test.ts"], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
    })
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
    expect(code).toBe(0)
    expect(err).toContain("which zsh did not word-split")
    expect(err).toContain("${=VAR} in zsh, or xargs")
    expect(existsSync(join(m.root, "a.test.ts b.test.ts"))).toBe(true)
  })

  test("a list joined by newlines warns too, as `FILES=$(git diff --name-only)` holds them", async () => {
    const m = machine()
    writeFileSync(join(m.root, "a.test.ts"), "")
    writeFileSync(join(m.root, "b.test.ts"), "")
    const p = Bun.spawn(["bash", SCRIPT, "worker-x", "--", "touch", "a.test.ts\nb.test.ts"], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
    })
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
    expect(code).toBe(0)
    expect(err).toContain("which zsh did not word-split")
    expect(existsSync(join(m.root, "a.test.ts\nb.test.ts"))).toBe(true)
  })

  test("a message whose first word alone names a path does not warn", async () => {
    const m = machine()
    writeFileSync(join(m.root, "a.test.ts"), "")
    const p = Bun.spawn(
      ["bash", SCRIPT, "worker-x", "--", "printf", "%s\\n", "a.test.ts is a message"],
      { cwd: m.root, env: m.env(), stderr: "pipe" },
    )
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
    expect(code).toBe(0)
    expect(err).not.toContain("word-split")
  })
})

// dispatcher, 18 Oct: keen-ledger's dev stack held a slot from 21:13Z to 21:58Z
const refused = async (argv: string[]) => {
  const m = machine()
  const p = Bun.spawn(["bash", SCRIPT, "worker-x", "--", ...argv], {
    cwd: tmpdir(),
    env: m.env(),
    stderr: "pipe",
  })
  return { code: await p.exited, err: await new Response(p.stderr).text(), tickets: m.tickets() }
}

// reviewer-ops-load-units, 19 Oct: a holder line left naming a finished run's pid let a waiter reclaim the next taker's slot
test("a finished run leaves no holder line", async () => {
  const m = machine()
  expect(await m.runs("worker-x")).toBe(true)
  expect(existsSync(join(m.ops, "run-slot"))).toBe(false)
  expect(existsSync(join(m.ops, "run-slot.holder"))).toBe(false)
})

// reviewer-ops-up-runtime, review round 6: a run killed between free()'s holder rm and its rmdir left a slot folder no rule freed
describe("a slot folder with no holder line", () => {
  const bare = (m: ReturnType<typeof machine>, slot: string, ago: number) => {
    mkdirSync(join(m.ops, slot))
    const at = Date.now() / 1000 - ago
    utimesSync(join(m.ops, slot), at, at)
  }
  const both = (ago: number) => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    bare(m, "run-slot", ago)
    bare(m, "run-slot-2", ago)
    return m
  }

  test("is reclaimed once it has aged 2 hours", async () => {
    expect(await both(3 * 3600).runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("is held while it is young", async () => {
    expect(await both(60).waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("clear-stale clears an aged one and leaves a young one", async () => {
    const m = machine()
    bare(m, "run-slot", 3 * 3600)
    bare(m, "run-slot-2", 60)
    const p = Bun.spawn(["bash", SCRIPT, "clear-stale"], { env: m.env(), stdout: "pipe" })
    expect(await p.exited).toBe(0)
    expect(await new Response(p.stdout).text()).toContain("run-slot: cleared")
    expect(existsSync(join(m.ops, "run-slot"))).toBe(false)
    expect(existsSync(join(m.ops, "run-slot-2"))).toBe(true)
  })

  test("clear-stale clears an aged run-slot-quick", async () => {
    const m = machine()
    bare(m, "run-slot-quick", 3 * 3600)
    const p = Bun.spawn(["bash", SCRIPT, "clear-stale"], { env: m.env(), stdout: "pipe" })
    expect(await p.exited).toBe(0)
    expect(existsSync(join(m.ops, "run-slot-quick"))).toBe(false)
  })
})

// dispatcher, 19 Oct: a tester's `bun run dev` held run-slot.single with 7 waiters
describe("a dev stack is refused", () => {
  for (const argv of [
    ["bun", "run", "dev"],
    ["bun", "run", "dev:stop"],
    ["npx", "next", "dev", "--port", "3000"],
  ])
    test(argv.join(" "), async () => {
      const r = await refused(argv)
      expect(r.code).toBe(2)
      expect(r.err).toContain(
        "run-slot.sh: a dev stack runs as a background task under the load gate, not through run-slot",
      )
      expect(r.tickets).toEqual([])
    })

  test("bun run test is not", async () => {
    const r = await refused(["echo", "bun", "run", "test"])
    expect(r.code).toBe(0)
  })
})

describe("a command that never exits is refused", () => {
  for (const argv of [
    ["bun", "run", "ingest", "--follow"],
    ["bun", "test", "--watch"],
    ["bash", "-c", "cd web && bun run dev"],
  ])
    test(argv.join(" "), async () => {
      const r = await refused(argv)
      expect(r.code).toBe(2)
      expect(r.err).toContain(
        "(slots): start a fixture stack outside run-slot, only while you take shots",
      )
    })
})

// ops, 31 Oct: another factory's pool on this Mac never saw this one's, and the two together took load1 to 77 and swap to 7.6 GB
describe("another factory's runs (slots.peers)", () => {
  // a peer's ops folder holding run-slot with a holder line whose pid is `pid`
  const peerHolding = (pid: number) => {
    const peer = mkdtempSync(join(tmpdir(), "peer-ops-"))
    dirs.push(peer)
    mkdirSync(join(peer, "run-slot"))
    writeFileSync(join(peer, "run-slot.holder"), `b8-worker ${pid} 2026-10-31T00:50:00Z 3 big\n`)
    return peer
  }

  test("a medium run waits while a peer's live run holds 3 units", async () => {
    const peer = peerHolding(process.pid)
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"], peers: [peer] })
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
    expect(readFileSync(join(peer, "run-slot.holder"), "utf8")).toContain(`${process.pid}`)
  })

  test("a peer's holder whose pid has died counts nothing, and its folder is left as it is", async () => {
    const gone = Bun.spawn(["true"])
    await gone.exited
    const peer = peerHolding(gone.pid)
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"], peers: [peer] })
    expect(await m.runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
    expect(existsSync(join(peer, "run-slot"))).toBe(true)
    expect(existsSync(join(peer, "run-slot.holder"))).toBe(true)
  })

  test("can-take counts a peer's units as for any run", async () => {
    const peer = peerHolding(process.pid)
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"], peers: [peer] })
    expect(await m.canTake("run-slot", "worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(false)
    expect(await m.canTake("run-slot", "worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

// localci and the merge train take their slots themselves; they ask run-slot.sh, so an off-switch reaches them too (18 Oct: localci took slot 3 past run-slot.3-off)
describe("can-take", () => {
  test("a slot its off-switch closes", async () => {
    const m = machine({ off: ["run-slot.3-off"] })
    expect(await m.canTake("run-slot-3", "ops-localci")).toBe(false)
    expect(await m.canTake("run-slot-4", "ops-localci")).toBe(true)
  })

  test("a slot already held", async () => {
    const m = machine()
    m.hold("run-slot", 2, "medium")
    expect(await m.canTake("run-slot", "ops-localci")).toBe(false)
    expect(await m.canTake("run-slot-2", "ops-localci")).toBe(true)
  })

  test("the units decide as for any run", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    expect(await m.canTake("run-slot-2", "worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(false)
    expect(await m.canTake("run-slot-2", "worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("leaves no ticket in the queue", async () => {
    const m = machine()
    await m.canTake("run-slot", "ops-localci")
    expect(await m.runs("worker-b", { RUN_SLOT_SIZE: "big" })).toBe(true)
  })
})

// dispatcher, 18 Oct: a committed test, type check, lint or build runs on the runner host through ci.sh exec, and falls back to a slot here
describe("the runner host", () => {
  // A stub ci.sh that logs its arguments and exits with `rc`, and a stub bun that logs what the Mac ran, answering the settings reader with nothing.
  const box = (rc: number, off?: string) => {
    const m = machine()
    const host = join(m.ops, "runner-host")
    mkdirSync(host)
    if (off) writeFileSync(join(host, off), "")
    writeFileSync(
      join(host, "ci.sh"),
      `#!/bin/bash\necho "$*" >> ${join(host, "calls")}\nexit ${rc}\n`,
    )
    chmodSync(join(host, "ci.sh"), 0o755)
    writeFileSync(
      join(m.bin, "bun"),
      `#!/bin/bash\ncase "$1" in */setting.ts) exit 0 ;; esac\necho "$*" >> ${join(m.root, "mac")}\n`,
    )
    chmodSync(join(m.bin, "bun"), 0o755)
    const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "")
    const run = async (argv: string[], extra: Record<string, string> = {}) => {
      const p = Bun.spawn(["bash", SCRIPT, "worker-x", "--", ...argv], {
        cwd: m.root,
        env: m.env(extra),
        stderr: "pipe",
      })
      const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
      return {
        box: read(join(host, "calls")),
        code,
        err,
        log: read(join(host, "runs.log")),
        mac: read(join(m.root, "mac")),
        root: realpathSync(m.root),
      }
    }
    return Object.assign(run, { root: m.root })
  }

  test("a bun test goes to the box and its exit code comes back", async () => {
    const r = await box(3)(["bun", "test", "tests/x.test.ts"])
    expect(r.code).toBe(3)
    expect(r.box).toBe(`exec ${r.root} -- bun test tests/x.test.ts\n`)
    expect(r.mac).toBe("")
    expect(r.log).toContain(`start worker-x ${r.root} bun test tests/x.test.ts`)
    expect(r.log).toContain("end worker-x rc=3")
  })

  test("a run the box cannot take (255) waits for a slot here", async () => {
    const r = await box(255)(["bun", "test", "tests/x.test.ts"])
    expect(r.code).toBe(0)
    expect(r.box).not.toBe("")
    expect(r.mac).toBe("test tests/x.test.ts\n")
    expect(r.err).toContain("the runner host could not take it")
    expect(r.err).toContain("worker-x holds run-slot")
  })

  // builder, 19 Oct: a Mac rerun of a red seen only on the box
  test("RUN_SLOT_HERE in run-slot's environment keeps a test here", async () => {
    const r = await box(0)(["bun", "test"], { RUN_SLOT_HERE: "1" })
    expect(r.box).toBe("")
    expect(r.mac).toBe("test\n")
    expect(r.err).toContain("worker-x holds run-slot")
  })

  test("RUN_SLOT_HERE as an env word of the command keeps it here", async () => {
    const r = await box(0)(["env", "RUN_SLOT_HERE=1", "bun", "test"])
    expect(r.box).toBe("")
    expect(r.mac).toBe("test\n")
    expect(r.err).toContain("worker-x holds run-slot")
  })

  // review round 2: a type check also builds packages/*/dist, which a later run on the Mac imports
  test("check-types stays here while a package's dist is missing", async () => {
    const run = box(0)
    writeFileSync(join(run.root, ".git"), "gitdir: x\n")
    mkdirSync(join(run.root, "packages", "a"), { recursive: true })
    writeFileSync(
      join(run.root, "packages", "a", "package.json"),
      JSON.stringify({ scripts: { build: "tsdown" } }),
    )
    const before = await run(["bun", "run", "check-types"])
    expect(before.box).toBe("")
    expect(before.mac).toBe("run check-types\n")
    expect((await run(["bun", "test"])).box).toContain("-- bun test")
    mkdirSync(join(run.root, "packages", "a", "dist"))
    expect((await run(["bun", "run", "check-types"])).box).toContain("-- bun run check-types")
  })

  // worker-firm-keel, 19 Oct: a type check from a subfolder read the other workspaces' dist, which the box lacks (332 false errors)
  describe("from a checkout's root or a subfolder", () => {
    const checkout = () => {
      const run = box(0)
      writeFileSync(join(run.root, ".git"), "gitdir: x\n")
      mkdirSync(join(run.root, "web", "next"), { recursive: true })
      return Object.assign(run, { sub: `--cwd=${join(run.root, "web", "next")}` })
    }

    test("a build from the root stays here", async () => {
      const r = await checkout()(["bun", "run", "build"])
      expect(r.box).toBe("")
      expect(r.mac).toBe("run build\n")
    })

    test("a subfolder check-types stays here", async () => {
      const run = checkout()
      const r = await run(["bun", run.sub, "run", "check-types"])
      expect(r.box).toBe("")
      expect(r.mac).toBe(`${run.sub} run check-types\n`)
    })

    test("a root check-types goes to the box", async () => {
      const r = await checkout()(["bun", "run", "check-types"])
      expect(r.box).toBe(`exec ${r.root} -- bun run check-types\n`)
      expect(r.mac).toBe("")
    })

    test("a subfolder test goes to the box", async () => {
      const run = checkout()
      const r = await run(["bun", run.sub, "test"])
      expect(r.box).toBe(`exec ${join(run.root, "web", "next")} -- bun ${run.sub} test\n`)
      expect(r.mac).toBe("")
    })
  })

  // ops, 20 Oct: slot-off keeps run-slot's runs here and leaves the box to Checks
  for (const off of ["off", "slot-off"])
    test(`runner-host/${off} takes a slot`, async () => {
      const r = await box(0, off)(["bun", "test"])
      expect(r.box).toBe("")
      expect(r.mac).toBe("test\n")
    })

  // the switch that kept the box idle for two days
  test("an expired runner-host/slot-off drops, and the run goes to the box", async () => {
    const run = box(0)
    const off = join(run.root, "ops", "runner-host", "slot-off")
    writeFileSync(off, "ops 2026-10-22T08:10:00Z 2026-10-22T12:10:00Z box queue deep\n")
    const r = await run(["bun", "test"])
    expect(r.box).toBe(`exec ${r.root} -- bun test\n`)
    expect(existsSync(off)).toBe(false)
  })

  // 9jhtsd, 24 Oct: a test of another worktree's file, started from this one, ran in this tree on the box and went red as "Script not found"
  test("a path in another checkout is refused with the fix, and one in its own goes to the box", async () => {
    const run = box(0)
    writeFileSync(join(run.root, ".git"), "gitdir: x\n")
    const other = join(run.root, "other")
    mkdirSync(join(other, "tests"), { recursive: true })
    writeFileSync(join(other, ".git"), "gitdir: y\n")
    const r = await run(["bun", "test", join(other, "tests", "x.test.ts")])
    expect(r.code).toBe(2)
    expect(r.box).toBe("")
    expect(r.err).toContain(`pass --cwd ${realpathSync(other)}`)
    const own = await run(["bun", "test", join(run.root, "tests", "x.test.ts")])
    expect(own.box).toContain(" -- bun test ")
  })

  // a review: a path holding "verify" (a test file, a worktree) is still a test; only an e2e file in a path keeps it here
  for (const argv of [
    ["bun", "test", "tests/packages/scripts/src/verify/dashboard-map.test.ts"],
    ["bun", "--cwd=/x/worktrees/review-verify-1", "test", "tests/a.test.ts"],
    ["bun", "run", "test:file", "tests/a.test.ts"],
    ["bun", "run", "--cwd", "/x/worktrees/a", "test:file", "tests/a.test.ts"],
    ["bun", "--cwd=/x/worktrees/a", "run", "test:file", "tests/a.test.ts"],
  ])
    test(`${argv.join(" ")} goes to the box`, async () => {
      const r = await box(0)(argv)
      expect(r.box).toContain(` -- ${argv.join(" ")}`)
      expect(r.mac).toBe("")
    })

  for (const argv of [
    ["bun", "run", "verify"],
    ["bun", "run", "test:e2e"],
    ["bun", "test", "tests/api/hono/src/routers/admin.e2e.test.ts"],
    ["bun", "install"],
    ["bun", "run", "test:docker"],
    ["bash", "-c", "bun test"],
  ])
    test(`${argv.join(" ")} takes a slot`, async () => {
      const r = await box(0)(argv)
      expect(r.box).toBe("")
      expect(r.code).toBe(0)
      expect(r.err).toContain("worker-x holds run-slot")
    })

  for (const argv of [
    ["bun", "run", "build", "--watch"],
    ["bun", "run", "dev"],
  ])
    test(`${argv.join(" ")} never goes to the box`, async () => {
      expect((await box(0)(argv)).box).toBe("")
    })
})

// optimizer, 19 Oct: a run's wait beside its run time, one line when a Mac run asks, takes its slot and ends
test("run-slot.runs.log has a Mac run's ask, start and end", async () => {
  const m = machine()
  expect(await m.runs("worker-x")).toBe(true)
  const log = readFileSync(join(m.ops, "run-slot.runs.log"), "utf8").trim().split("\n")
  expect(log).toHaveLength(3)
  expect(log[0]).toMatch(/Z ask worker-x \d+ touch /)
  expect(log[1]).toMatch(/Z start worker-x \d+ run-slot waited=\d+s$/)
  expect(log[2]).toMatch(/Z end worker-x \d+ rc=0 ran=\d+s$/)
})

// optimizer, 19 Oct: in single-slot mode run-slot-2 opens at a 40% free share with pressure normal, not 50%
describe("run-slot-2 in single-slot mode", () => {
  const busy = (free: number) => {
    const m = machine({ free, off: ["run-slot.single"] })
    m.hold("run-slot", 1, "small")
    return m
  }

  test("opens at 40% free", async () => {
    expect(await busy(40).runs("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("stays shut under 40% free", async () => {
    expect(await busy(39).waits("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

// a hand-set runner-host/slot-off kept the runner box idle for two days, so a switch carries a reason and an expiry, and drops itself past it
describe("an ops switch carries a reason and an expiry", () => {
  const set = async (m: ReturnType<typeof machine>, ...args: string[]) => {
    const p = Bun.spawn(["bash", SCRIPT, "set", ...args], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
    })
    return { code: await p.exited, err: await new Response(p.stderr).text() }
  }
  const aside = (m: ReturnType<typeof machine>) =>
    readdirSync(m.ops).filter((f) => f.startsWith("run-slot.3-off.expired-"))
  const log = (m: ReturnType<typeof machine>) => {
    const path = join(m.ops, "run-slot.runs.log")
    return existsSync(path) ? readFileSync(path, "utf8") : ""
  }

  test("a set with no reason is refused and writes nothing", async () => {
    const m = machine()
    const r = await set(m, "ops", "3-off")
    expect(r.code).toBe(2)
    expect(r.err).toContain("--reason")
    expect(existsSync(join(m.ops, "run-slot.3-off"))).toBe(false)
  })

  test("a set writes who, when, an expiry 4 hours on and the reason, and the switch holds", async () => {
    const m = machine()
    expect((await set(m, "ops", "3-off", "--reason", "load5 24.79")).code).toBe(0)
    const [who, at, until, ...why] = readFileSync(join(m.ops, "run-slot.3-off"), "utf8")
      .trim()
      .split(" ")
    expect(who).toBe("ops")
    expect(Date.parse(until!) - Date.parse(at!)).toBe(4 * 3600_000)
    expect(why.join(" ")).toBe("load5 24.79")
    expect(await m.canTake("run-slot-3", "worker-x")).toBe(false)
  })

  test("--for sets the expiry, and a value goes on the line below", async () => {
    const m = machine()
    expect(
      (await set(m, "builder", "load5-cap", "12", "--for", "30m", "--reason", "cmux")).code,
    ).toBe(0)
    const [line, value] = readFileSync(join(m.ops, "run-slot.load5-cap"), "utf8").trim().split("\n")
    const [, at, until] = line!.split(" ")
    expect(Date.parse(until!) - Date.parse(at!)).toBe(30 * 60_000)
    expect(value).toBe("12")
  })

  test("--for 0m is refused", async () => {
    const m = machine()
    expect((await set(m, "ops", "3-off", "--for", "0m", "--reason", "x")).code).toBe(2)
    expect(existsSync(join(m.ops, "run-slot.3-off"))).toBe(false)
  })

  test("an expired switch is moved aside, logged, and holds no more", async () => {
    const m = machine()
    const line = "ops 2026-10-22T08:10:00Z 2026-10-22T12:10:00Z load5 24.79"
    writeFileSync(join(m.ops, "run-slot.3-off"), `${line}\n`)
    expect(await m.canTake("run-slot-3", "worker-x")).toBe(true)
    expect(existsSync(join(m.ops, "run-slot.3-off"))).toBe(false)
    expect(aside(m)).toHaveLength(1)
    expect(log(m)).toMatch(new RegExp(`Z expire worker-x \\d+ run-slot\\.3-off ${line}\\n`))
  })

  test("an old-shape file counts as set at its mtime: past 4 hours it drops, younger it holds", async () => {
    const m = machine({ off: ["run-slot.3-off"] })
    expect(await m.canTake("run-slot-3", "worker-x")).toBe(false)
    const at = Date.now() / 1000 - 4 * 3600 - 60
    utimesSync(join(m.ops, "run-slot.3-off"), at, at)
    expect(await m.canTake("run-slot-3", "worker-x")).toBe(true)
    expect(aside(m)).toHaveLength(1)
    expect(log(m)).toMatch(/Z expire worker-x \d+ run-slot\.3-off \n/)
  })
})

describe("a model-bound run", () => {
  // Starts argv through run-slot --model-bound in the background, reading its stderr as it comes
  const model = (m: ReturnType<typeof machine>, who: string, argv: string[]) => {
    const p = Bun.spawn(["bash", SCRIPT, who, "--model-bound", "--", ...argv], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
    })
    let err = ""
    let ended = false
    void p.exited.then(() => (ended = true))
    void (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    const saw = async (re: RegExp) => {
      while (!ended && !re.test(err)) await Bun.sleep(20)
      return re.test(err)
    }
    return { p, saw }
  }

  test("takes a model-bound slot, so a run beside it still takes the one CPU slot free", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 2, "medium")
    const marker = join(m.root, "replaying")
    const replay = model(m, "worker-replay", ["bash", "-c", `touch ${marker}; sleep 30`])
    expect(await replay.saw(/holds run-slot-model-1\n/)).toBe(true)
    while (!existsSync(marker)) await Bun.sleep(20)
    expect(existsSync(join(m.ops, "run-slot-2"))).toBe(false)
    expect(readFileSync(join(m.ops, "run-slot-model-1.holder"), "utf8")).toMatch(
      new RegExp(`^worker-replay ${replay.p.pid} \\S+Z 0 model\\n$`),
    )
    expect(await m.runs("worker-suite", { RUN_SLOT_SIZE: "small" })).toBe(true)
    await stop(replay.p)
    expect(existsSync(join(m.ops, "run-slot-model-1"))).toBe(false)
  })

  test("waits while its default cap, slots.modelBound's 2, is held, with no extensions on the machine", async () => {
    const m = machine()
    m.hold("run-slot-model-1", 0, "model")
    m.hold("run-slot-model-2", 0, "model")
    const third = model(m, "worker-third", ["true"])
    expect(await third.saw(/waiting for one of the 2 model-bound slots\n/)).toBe(true)
    await stop(third.p)
    expect(slotSettings.get(settingsFor([], "me"), "slots.modelBound")).toBe(2)
  })

  test("takes its cap from the settings reader", async () => {
    const m = machine()
    writeFileSync(
      join(m.bin, "bun"),
      `#!/bin/bash\necho "$*" >> ${join(m.root, "bun.log")}\n[ "$2" = slots.modelBound ] && echo 1\n`,
    )
    chmodSync(join(m.bin, "bun"), 0o755)
    m.hold("run-slot-model-1", 0, "model")
    const second = model(m, "worker-second", ["true"])
    expect(await second.saw(/waiting for one of the 1 model-bound slots\n/)).toBe(true)
    await stop(second.p)
    expect(readFileSync(join(m.root, "bun.log"), "utf8")).toMatch(
      /\/packages\/scripts\/src\/playground\/setting\.ts slots\.modelBound\n/,
    )
  })

  test("clear-stale clears a model-bound slot whose holder died", async () => {
    const m = machine()
    const gone = Bun.spawn(["true"])
    await gone.exited
    mkdirSync(join(m.ops, "run-slot-model-1"))
    writeFileSync(
      join(m.ops, "run-slot-model-1.holder"),
      `worker-gone ${gone.pid} 2026-10-29T00:00:00Z 0 model\n`,
    )
    const p = Bun.spawn(["bash", SCRIPT, "clear-stale"], { env: m.env(), stdout: "pipe" })
    expect(await new Response(p.stdout).text()).toContain(
      "run-slot-model-1: cleared a stale holder",
    )
    expect(existsSync(join(m.ops, "run-slot-model-1"))).toBe(false)
  })
})

// 31 Oct: a suite's `bun test --isolate` worker outlived its suite by 5 hours at 50% CPU, reparented to launchd once the suite's own process exited
describe("what the command leaves in its process group", () => {
  // the test started each loop, so it stops each by its own pid whatever run-slot did, a timed-out run's included
  const loops: number[] = []
  afterAll(() => {
    for (const pid of loops) if (alive(pid)) process.kill(pid, "SIGKILL")
  })
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  // Runs, through run-slot from a calling bash, a command that starts a loop in the background, writes its pid and exits 7; `trap` set to ignore TERM in the loop makes it need the KILL. Returns the caller's stdout, the run's code, the loop's pid and the runs log.
  const leaves = async (trap = "") => {
    const m = machine()
    const pidFile = join(m.root, "loop.pid")
    const loop = `${trap}while :; do sleep 0.2; done`
    // the loop's output goes to /dev/null, so a loop left behind never holds the caller's stdout open
    const command = `bash -c '${loop}' >/dev/null 2>&1 & echo $! > ${pidFile}; exit 7`
    const p = Bun.spawn(
      [
        "bash",
        "-c",
        '"$@"; echo "caller-alive $?"',
        "bash",
        "bash",
        SCRIPT,
        "worker-x",
        "--",
        "bash",
        "-c",
        command,
      ],
      { cwd: m.root, env: m.env(), stdout: "pipe" },
    )
    const out = await new Response(p.stdout).text()
    const code = await p.exited
    const pid = Number(readFileSync(pidFile, "utf8"))
    loops.push(pid)
    // read at once after run-slot has ended, so a loop it left reads alive
    const left = alive(pid)
    return { code, left, log: readFileSync(join(m.ops, "run-slot.runs.log"), "utf8"), out, pid }
  }

  test("is stopped once the command exits, and logged by pid with its command line", async () => {
    const r = await leaves()
    expect(r.left).toBe(false)
    expect(r.log).toMatch(
      new RegExp(`reap worker-x \\d+ pid=${r.pid} bash -c while :; do sleep 0\\.2; done`),
    )
  })

  test("that ignores TERM, by KILL after the grace", async () => {
    const r = await leaves('trap "" TERM; ')
    expect(r.left).toBe(false)
  })

  test("while run-slot's caller lives on and the command's own exit code comes back", async () => {
    const r = await leaves()
    expect(r.out).toBe("caller-alive 7\n")
    expect(r.code).toBe(0)
  })
})
