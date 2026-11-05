import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, machine, stop } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const set = async (m: ReturnType<typeof machine>, ...args: string[]) => {
  const p = Bun.spawn(["bash", SCRIPT, "set", ...args], {
    cwd: m.root,
    env: m.env(),
    stderr: "pipe",
  })
  return { code: await p.exited, err: await new Response(p.stderr).text() }
}

const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`

// dispatcher, 5 Nov: run-slot.focus is approved on a 180-minute cap, with ops' upkeep running while heavy runs queue
describe("run-slot.focus", () => {
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

  test("on, the focused session's own reviewer and tester run while another session's run waits", async () => {
    const m = machine()
    await set(m, "abc-worker", "focus", "--for", "30m", "--reason", "an urgent ticket")
    expect(await m.runs("abc-reviewer", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.runs("abc-tester", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.waits("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
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
    const p = Bun.spawn(["bash", SCRIPT, "preempt"], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
      stdout: "pipe",
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
})
