import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, machine, runSlot, set, stop } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`

// dispatcher, 5 Nov: run-slot.focus is approved on a 180-minute cap, with ops' upkeep running while heavy runs queue
describe("run-slot.focus", () => {
  // PG-1383: a queued run printed "No such file or directory" for the missing run-slot.focus on every poll, since its read's 2>/dev/null came after the <
  test("absent, with no run-slot.priority either, a queued run waits and prints no read error", async () => {
    // idle 30 keeps slots 2 to 4 shut, so the held run-slot leaves the run queued
    const m = machine({ idle: 30 })
    m.hold("run-slot", 2, "medium")
    const queued = m.start("worker-q", { RUN_SLOT_SIZE: "small" })
    expect(await queued.waits()).toBe(true)
    expect(existsSync(join(m.ops, "run-slot.focus"))).toBe(false)
    expect(existsSync(join(m.ops, "run-slot.priority"))).toBe(false)
    expect(queued.stderr()).toMatch(WAITING)
    // the queued-behind lines are the wait's own, so with them taken out stderr is empty, a missing file's error included
    const stray = queued
      .stderr()
      .split("\n")
      .filter((l) => l !== "" && l.search(WAITING) !== 0)
    expect(stray).toEqual([])
  })

  // round 2 of the review: the commit, merge and clone block's own focus wait read an unbound threshold and exited 1 under set -u, so a clone under another session's focus died where it should have waited
  test("a clone under another session's focus waits and says its focus line", async () => {
    const m = machine()
    await set(m, "worker-f", "focus", "--for", "180m", "--reason", "demo")
    mkdirSync(join(m.root, "node_modules"))
    const run = m.start("worker-c", {}, SCRIPT, ["cp", "-R", "node_modules"])
    expect(await run.saw(/waiting for worker-f's focus to end/gm)).toBe(true)
    await stop(run.p)
  })

  test("a set over 180 minutes is refused and writes nothing, and 180 minutes holds", async () => {
    const m = machine()
    const over = await set(m, "worker-f", "focus", "--for", "181m", "--reason", "demo")
    expect(over.code).toBe(2)
    expect(over.err).toContain("180 minutes at most")
    expect(existsSync(join(m.ops, "run-slot.focus"))).toBe(false)
    expect((await set(m, "worker-f", "focus", "--for", "4h", "--reason", "demo")).code).toBe(2)
    expect((await set(m, "worker-f", "focus", "--for", "180m", "--reason", "demo")).code).toBe(0)
    expect(readFileSync(join(m.ops, "run-slot.focus"), "utf8")).toStartWith("worker-f ")
  })

  test("on, another session's heavy run waits while the focus session's and ops-tick's run", async () => {
    const m = machine()
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
    expect(await m.waits("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.runs("worker-f", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.runs("ops-tick", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("on, the focus session's run starts while an older run of another session waits in the queue", async () => {
    const m = machine()
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
    const older = m.start("worker-x", { RUN_SLOT_SIZE: "small" })
    expect(await older.saw(WAITING)).toBe(true)
    expect(await m.runs("worker-f", { RUN_SLOT_SIZE: "small" })).toBe(true)
    await stop(older.p)
  })

  test("off, lifted through the .lifted move, the heavy run goes on", async () => {
    const m = machine()
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
    renameSync(join(m.ops, "run-slot.focus"), join(m.ops, "run-slot.focus.lifted-20261105T0700Z"))
    expect(await m.runs("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("lapsed, past its expiry, the switch drops itself and the heavy run goes on", async () => {
    const m = machine()
    const now = Date.now()
    writeFileSync(
      join(m.ops, "run-slot.focus"),
      `worker-f ${iso(now - 3_600_000)} ${iso(now - 60_000)} demo\n`,
    )
    expect(await m.runs("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(existsSync(join(m.ops, "run-slot.focus"))).toBe(false)
  })

  // issue 1491: a second process lifts the focus right after focus_holder's switch_on reads it, the second focus read (the first is the startup sweep's) and the point both sides pass through, so each side's read meets no file
  test("the focus file going between the presence check and the read reads as no focus, with no cut error", async () => {
    const m = machine({ idle: 30 })
    m.hold("run-slot", 2, "medium")
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
    writeFileSync(
      join(m.bin, "head"),
      `#!/bin/bash\nn=$(cat "${m.ops}/head-count" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "${m.ops}/head-count"\nout=$(/usr/bin/head "$@"); rc=$?\ncase "$*" in *run-slot.focus*) [ "$n" -ge 2 ] && rm -f "${m.ops}/run-slot.focus" ;; esac\nprintf '%s' "$out"\nexit $rc\n`,
    )
    chmodSync(join(m.bin, "head"), 0o755)
    const queued = m.start("worker-q", { RUN_SLOT_SIZE: "small" })
    expect(await queued.saw(WAITING)).toBe(true)
    // the wait's own lines aside, stderr names no read error: the vanished file reads as no focus (canary fails here on its cut: line)
    const stray = queued
      .stderr()
      .split("\n")
      .filter((l) => l !== "" && l.search(WAITING) !== 0)
    expect(stray).toEqual([])
    await stop(queued.p)
  })

  test("on, the focused session's own reviewer and tester run while another session's run waits", async () => {
    const m = machine()
    await set(m, "abc-worker", "focus", "--for", "30m", "--reason", "an urgent ticket")
    expect(await m.runs("abc-reviewer", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.runs("abc-tester", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.waits("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("on, a checker with an id of its own runs when its roster row names the focused session as its worker, and another session's checker waits", async () => {
    const m = machine({
      roster: {
        agents: [
          { kind: "reviewer", name: "k3m9px-reviewer", worker: "abc-worker" },
          { kind: "tester", name: "b7c8dq-tester", worker: "worker-x" },
        ],
      },
    })
    await set(m, "abc-worker", "focus", "--for", "30m", "--reason", "an urgent ticket")
    expect(await m.runs("k3m9px-reviewer", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.waits("b7c8dq-tester", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

// for an urgent ticket the owner wants everything else stopped, so its fix goes first
describe("run-slot.sh preempt", () => {
  // a run that marks itself started, then waits a minute, as a suite in a slot does
  const hang = (m: ReturnType<typeof machine>) => {
    writeFileSync(join(m.bin, "hang"), '#!/bin/bash\ntouch "$1.started"\nexec sleep 60\n')
    chmodSync(join(m.bin, "hang"), 0o755)
  }
  const started = async (run: { marker: string }) => {
    while (!existsSync(`${run.marker}.started`)) await Bun.sleep(20)
  }
  const preempt = async (m: ReturnType<typeof machine>) => {
    const p = runSlot(["bash", SCRIPT, "preempt"], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
      stdout: "pipe",
      ops: m.ops,
    })
    return {
      code: await p.exited,
      err: await new Response(p.stderr).text(),
      out: await new Response(p.stdout).text(),
    }
  }

  test("stops the run another session holds a slot with, which exits saying focus preempted it, and leaves the focused session's run", async () => {
    const m = machine()
    hang(m)
    const other = m.start("worker-x", { RUN_SLOT_SIZE: "small" }, SCRIPT, ["hang"])
    const own = m.start("worker-f", { RUN_SLOT_SIZE: "small" }, SCRIPT, ["hang"])
    await started(other)
    await started(own)
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "an urgent ticket")
    const r = await preempt(m)
    expect(r.code).toBe(0)
    expect(r.out).toContain("preempted worker-x's run")
    expect(r.out).not.toContain("worker-f's run")
    expect(await other.p.exited).toBe(143)
    expect(await other.saw(/^run-slot\.sh: focus preempted this run for worker-f/gm)).toBe(true)
    expect(readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")).toMatch(/ preempt worker-x \d+ /)
    expect(own.p.exitCode).toBeNull()
    await stop(own.p)
  })

  test("leaves the run of the focused session's checker with an id of its own, which its roster row names", async () => {
    const m = machine({
      roster: { agents: [{ kind: "reviewer", name: "k3m9px-reviewer", worker: "worker-f" }] },
    })
    hang(m)
    const checker = m.start("k3m9px-reviewer", { RUN_SLOT_SIZE: "small" }, SCRIPT, ["hang"])
    await started(checker)
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "an urgent ticket")
    const r = await preempt(m)
    expect(r.code).toBe(0)
    expect(r.out).not.toContain("k3m9px-reviewer's run")
    expect(checker.p.exitCode).toBeNull()
    await stop(checker.p)
  })

  test("leaves alone a recorded pid that is not the holder's own child leading its own group", async () => {
    const m = machine()
    m.hold("run-slot", 1, "small")
    const outside = Bun.spawn(["sleep", "60"])
    writeFileSync(join(m.ops, "run-slot.child"), `${outside.pid}\n`)
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "an urgent ticket")
    const r = await preempt(m)
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "run-slot: worker-held's run has no child of its holder leading its own group; left alone",
    )
    expect(existsSync(join(m.ops, "run-slot.preempted"))).toBe(false)
    expect(outside.exitCode).toBeNull()
    outside.kill()
    await outside.exited
  })

  test("with no focus standing, stops nothing and says so", async () => {
    const m = machine()
    hang(m)
    const other = m.start("worker-x", { RUN_SLOT_SIZE: "small" }, SCRIPT, ["hang"])
    await started(other)
    const r = await preempt(m)
    expect(r.code).toBe(2)
    expect(r.err).toContain("no focus stands")
    expect(other.p.exitCode).toBeNull()
    await stop(other.p)
  })

  test("a focus that goes between the presence check and the read stops nothing", async () => {
    const m = machine()
    hang(m)
    const other = m.start("worker-x", { RUN_SLOT_SIZE: "small" }, SCRIPT, ["hang"])
    await started(other)
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "an urgent ticket")
    // the fake head stands in for a second process that lifts the focus right after preempt's switch_on reads it
    writeFileSync(
      join(m.bin, "head"),
      `#!/bin/bash\nout=$(/usr/bin/head "$@"); rc=$?\ncase "$*" in *run-slot.focus*) rm -f "${m.ops}/run-slot.focus" ;; esac\nprintf '%s' "$out"\nexit $rc\n`,
    )
    chmodSync(join(m.bin, "head"), 0o755)
    const r = await preempt(m)
    expect(r.code).toBe(2)
    expect(r.err).toContain("no focus stands")
    expect(other.p.exitCode).toBeNull()
    await stop(other.p)
  })
})
