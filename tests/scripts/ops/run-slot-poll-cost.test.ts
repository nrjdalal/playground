import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, runSlot, stop, machine } from "./run-slot-fake"

// ten waiters under xtrace and the shims take up to a minute over their first looks on a loaded Mac, before the window opens
setDefaultTimeout(180_000)

// every external command run-slot.sh calls by name; a shim for each counts its start, so a start the shims miss is a fork that runs bash alone, which the trace's subshell levels count
const COMMANDS =
  "awk basename bun cat cut date diff dirname docker env find getconf git grep head id iostat ls mkdir mktemp mv nice ps python3 readlink realpath rm rmdir sed seq setsid sleep sort ssh stat sysctl tail timeout top touch tr uname uptime vm_stat wc xargs".split(
    " ",
  )

type Machine = ReturnType<typeof machine>
// shims ahead of the machine's PATH, each a perl script, which the waiters' xtrace leaves untraced, that writes its name to the count file and runs the command the machine's PATH finds
const shim = (m: Machine) => {
  const dir = join(m.root, "shims")
  const count = join(m.root, "starts")
  mkdirSync(dir)
  writeFileSync(count, "")
  const rest = m.env().PATH
  for (const name of COMMANDS) {
    writeFileSync(
      join(dir, name),
      `#!/usr/bin/perl\nopen(my $f, ">>", "${count}"); print $f "${name}\\n"; close $f;\n$ENV{PATH} = "${rest}";\nexec { "${name}" } "${name}", @ARGV or exit 127;\n`,
    )
    chmodSync(join(dir, name), 0o755)
  }
  return { count, path: `${dir}:${rest}` }
}
// starts a waiter under xtrace, its PS4 the subshell level, and keeps its stderr
const waiter = (
  m: Machine,
  path: string,
  who: string,
  command: string[],
  extra: Record<string, string>,
) => {
  const marker = join(m.root, `ran-${who}`)
  const p = runSlot(["bash", SCRIPT, who, "--", ...command, marker], {
    cwd: m.root,
    env: m.env({ ...extra, PATH: path, PS4: "+$BASH_SUBSHELL ", SHELLOPTS: "xtrace" }),
    stderr: "pipe",
    ops: m.ops,
  })
  const w = { err: "", marker, p }
  void (async () => {
    const text = new TextDecoder()
    for await (const chunk of p.stderr) w.err += text.decode(chunk, { stream: true })
  })()
  return w
}
type Waiter = ReturnType<typeof waiter>
// the subshells a trace shows entered: each line at a deeper level than the line before it
const subshells = (trace: string) => {
  let n = 0
  let last = 0
  for (const line of trace.split("\n")) {
    const level = line.match(/^\++(\d+) /)?.[1]
    if (level === undefined) continue
    if (Number(level) > last) n++
    last = Number(level)
  }
  return n
}
// the processes the waiters started together each second over `window` seconds, once each has printed its first wait line and a whole poll has passed in which each is in its sleep and no queue waiter began a look (look_mark, which the clone loop never calls), since a waiter whose first look ran before the others had joined looks once more at them
const starts = async (
  count: string,
  waiters: Waiter[],
  waits: RegExp,
  poll: number,
  window: number,
  during: () => Promise<unknown> = async () => {},
) => {
  for (const w of waiters) while (!waits.test(w.err)) await Bun.sleep(50)
  for (let quiet = false; !quiet;) {
    const at = waiters.map((w) => w.err.length)
    await Bun.sleep((poll + 1) * 1000)
    quiet = waiters.every(
      (w, i) =>
        !/^\++\d+ look_mark$/m.test(w.err.slice(at[i])) &&
        /^\+0 sleep \S+$/.test(w.err.match(/^\+0 .*$/gm)?.at(-1) ?? ""),
    )
  }
  const from = waiters.map((w) => w.err.length)
  const before = readFileSync(count, "utf8").split("\n").length
  await Promise.all([Bun.sleep(window * 1000), during()])
  const execs = readFileSync(count, "utf8").split("\n").length - before
  const forks = waiters.reduce((n, w, i) => n + subshells(w.err.slice(from[i])), 0)
  const rate = (execs + forks) / window
  if (rate >= 5)
    console.error(
      "looks in the window:",
      waiters
        .map((w, i) => (w.err.slice(from[i]).match(/^\++\d+ look_mark$/gm) ?? []).length)
        .join(","),
    )
  await Promise.all(waiters.map((w) => stop(w.p)))
  expect(waiters.every((w) => !existsSync(w.marker))).toBe(true)
  return rate
}

// issue 1338, 7 Nov: sixteen waiters started about 60 processes a second between them, which held load5 between 30 and 42 on 15 cores with the CPU half idle, so the slots they waited for stayed shut
describe("waiters cost close to nothing while they wait", () => {
  test("ten queue waiters behind held slots start fewer than 5 processes a second together", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 10 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["touch"], { RUN_SLOT_POLL: "15" }),
    )
    expect(await starts(count, waiters, new RegExp(WAITING.source, "m"), 15, 30)).toBeLessThan(5)
  })

  // a count of polls to look again on (an older copy's 20) sets each waiter looking within the window, about 900 to 2,200 processes a look with ten tickets
  // round 4 of the review: every waiter's mark shared one path, which a read subcommand's exit removed, so each run's end set every waiter looking
  test("and across 25 polls, with nothing changed but a read of the slots, fewer than 20 a poll", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 10 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["touch"], { RUN_SLOT_POLL: "1" }),
    )
    // a read subcommand, run outside the shims, so only the waiters' own starts count
    const slots = async () => {
      await Bun.sleep(5_000)
      await runSlot(["bash", SCRIPT, "slots"], {
        cwd: m.root,
        env: m.env(),
        stdout: "ignore",
        stderr: "ignore",
        ops: m.ops,
      }).exited
    }
    expect(
      await starts(count, waiters, new RegExp(WAITING.source, "m"), 1, 25, slots),
    ).toBeLessThan(20)
  })

  test("and so do ten clone waiters behind the load brake", async () => {
    const m = machine({ cores: 8, load1: 2, load5: 20 })
    mkdirSync(join(m.root, "node_modules"))
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 10 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["cp", "-R", "node_modules"], { RUN_SLOT_POLL: "5" }),
    )
    expect(await starts(count, waiters, /^run-slot\.sh: this clone waits /m, 5, 10)).toBeLessThan(5)
  })
})

// round 1 of the review of issue 1338's fix: a head whose idle poll watched the files and the load alone missed the CPU opening slots 2 to 4, and waited 20 polls
describe("a waiter at the head reads the gate that held its last look", () => {
  test("so a run held by shut lanes takes run-slot-2 within a poll of the CPU opening them", async () => {
    const m = machine({ idle: 10 })
    m.hold("run-slot", 3, "big")
    const { path } = shim(m)
    const w = waiter(m, path, "worker-a", ["touch"], { RUN_SLOT_POLL: "1" })
    while (!/^\+\d+ look_mark$/m.test(w.err) || !/^\+0 sleep 1$/m.test(w.err)) await Bun.sleep(50)
    const top = join(m.root, "bin", "top")
    writeFileSync(top, readFileSync(top, "utf8").replace(/ 10% idle/, " 80% idle"))
    rmSync(join(m.ops, "run-slot.gauges"), { force: true })
    const from = w.err.length
    while (!existsSync(w.marker)) await Bun.sleep(50)
    // the gauges keep a reading 10 s, which this test's removal of run-slot.gauges skips, so a poll or two passes between the CPU opening and the take
    expect(w.err.slice(from).match(/^\+0 sleep 1$/gm)?.length ?? 0).toBeLessThanOrEqual(2)
    await stop(w.p)
  })
})

// round 2 of the review: an oldest waiter under the priority pick wrote no run-slot.next, so a waiter behind it that a freed slot let start never looked
describe("a waiter behind the head", () => {
  test("starts within a poll or two of a freed slot when the oldest is the priority pick and still does not fit", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    writeFileSync(join(m.ops, "run-slot.priority"), "worker-p\n")
    const path = m.env().PATH
    const asleep = (w: Waiter) => /^\+0 sleep 1$/m.test(w.err)
    const pick = waiter(m, path, "worker-p", ["touch"], {
      RUN_SLOT_POLL: "1",
      RUN_SLOT_SIZE: "big",
    })
    while (!asleep(pick)) await Bun.sleep(50)
    const next = waiter(m, path, "worker-y", ["touch"], {
      RUN_SLOT_POLL: "1",
      RUN_SLOT_SIZE: "small",
    })
    while (!asleep(next)) await Bun.sleep(50)
    m.release("run-slot-2")
    const from = next.err.length
    const sleeps = () => next.err.slice(from).match(/^\+0 sleep 1$/gm)?.length ?? 0
    while (!existsSync(next.marker) && sleeps() < 10) await Bun.sleep(50)
    expect(sleeps()).toBeLessThanOrEqual(3)
    expect(existsSync(pick.marker)).toBe(false)
    await Promise.all([stop(pick.p), stop(next.p)])
  })

  // round 3 of the review: run-slot.next named first_waiter's pair alone, which held while the pick's first ticket took run-slot and went, so the pick's second, behind an older waiter that every look named, never looked and run-slot sat free
  test("the priority pick's second run takes run-slot within a poll or two of its first run's end", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 1, "small")
    m.hold("run-slot-2", 2, "medium")
    writeFileSync(join(m.ops, "run-slot.priority"), "worker-p\n")
    const path = m.env().PATH
    const poll = { RUN_SLOT_POLL: "1", RUN_SLOT_SIZE: "small" }
    const asleep = (w: Waiter) => /^\+0 sleep 1$/m.test(w.err)
    // the older waiter fits the units throughout, so first_waiter names it at every look, and it leaves run-slot to the pick
    const older = waiter(m, path, "worker-w", ["touch"], poll)
    while (!asleep(older)) await Bun.sleep(50)
    const gate = join(m.root, "gate")
    const first = waiter(
      m,
      path,
      "worker-p",
      ["bash", "-c", `until [ -e "${gate}" ]; do sleep 0.1; done; touch "$0"`],
      poll,
    )
    while (!asleep(first)) await Bun.sleep(50)
    const second = waiter(m, path, "worker-p", ["touch"], poll)
    while (!asleep(second)) await Bun.sleep(50)
    m.release("run-slot")
    while (!/^run-slot\.sh: worker-p holds run-slot$/m.test(first.err)) await Bun.sleep(50)
    // the older waiter looks at the first run's take before its end
    const seen = older.err.length
    while (
      !/^\++\d+ look_mark$/m.test(older.err.slice(seen)) ||
      !asleep({ ...older, err: older.err.slice(seen) })
    )
      await Bun.sleep(50)
    const from = second.err.length
    writeFileSync(gate, "")
    await first.p.exited
    const sleeps = () => second.err.slice(from).match(/^\+0 sleep 1$/gm)?.length ?? 0
    while (!existsSync(second.marker) && sleeps() < 10) await Bun.sleep(50)
    expect(sleeps()).toBeLessThanOrEqual(3)
    expect(existsSync(older.marker)).toBe(false)
    await Promise.all([stop(older.p), stop(second.p)])
  })

  // a waiter killed past its trap leaves its ticket, the oldest, at the queue's front; the waiters behind it watch that ticket's pid
  test("starts within a poll or two of a freed slot when the oldest waiter was killed and left its ticket", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const path = m.env().PATH
    const asleep = (w: Waiter) => /^\+0 sleep 1$/m.test(w.err)
    const oldest = waiter(m, path, "worker-x", ["touch"], {
      RUN_SLOT_POLL: "1",
      RUN_SLOT_SIZE: "big",
    })
    while (!asleep(oldest)) await Bun.sleep(50)
    const next = waiter(m, path, "worker-y", ["touch"], {
      RUN_SLOT_POLL: "1",
      RUN_SLOT_SIZE: "small",
    })
    while (!asleep(next)) await Bun.sleep(50)
    const left = m.tickets().find((t) => t.endsWith("-worker-x"))
    expect(left).toBeDefined()
    // the test started this waiter, so it ends it by its own pid, with no trap run
    oldest.p.kill("SIGKILL")
    await oldest.p.exited
    expect(m.tickets()).toContain(left!)
    const from = next.err.length
    m.release("run-slot-2")
    const sleeps = () => next.err.slice(from).match(/^\+0 sleep 1$/gm)?.length ?? 0
    while (!existsSync(next.marker) && sleeps() < 10) await Bun.sleep(50)
    expect(sleeps()).toBeLessThanOrEqual(3)
    expect(m.tickets()).not.toContain(left!)
    await stop(next.p)
  })
})

// #1378: a waiter's waited count is the real seconds since its wait began, so the five-minute marks land on real minutes whatever RUN_SLOT_POLL is; a poll that added 15 of its own ran the marks early on a slow poll and late on a fast one
describe("a waiter's waited count is the real seconds since its wait began", () => {
  const script = readFileSync(join(import.meta.dir, "../../../scripts/ops/run-slot.sh"), "utf8")

  test("no poll adds a figure of its own", () => {
    expect(script.match(/waited=\$\(\(waited \+/g) ?? []).toEqual([])
  })

  test("each wait records its start, and four loops and hold_wait read the clock against it", () => {
    expect(script.match(/WAIT_FROM=\$SECONDS/g) ?? []).toHaveLength(4)
    expect(script.match(/waited=\$\(\(SECONDS - WAIT_FROM\)\)/g) ?? []).toHaveLength(5)
  })

  // a sampled clock count steps over an exact multiple, so each wait line prints by a threshold it raises past the mark, not by the modulo
  test("each wait line prints by a threshold, and no modulo or first-line flag holds the five-minute marks", () => {
    expect(script.match(/-ge "\$(FAT|QAT|UAT|BAT|SAT|MAT|DAT|CAT)"/g) ?? []).toHaveLength(8)
    expect(script.match(/AT=\$\(\(\(waited \/ 300 \+ 1\) \* 300\)\)/g) ?? []).toHaveLength(8)
    expect(script.match(/% 300/g) ?? []).toEqual([])
    expect(script.match(/(?:F|M|D|C|Q)SAID=/g) ?? []).toEqual([])
  })
})
