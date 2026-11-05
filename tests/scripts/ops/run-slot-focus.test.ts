import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine } from "./run-slot-fake"

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
})
