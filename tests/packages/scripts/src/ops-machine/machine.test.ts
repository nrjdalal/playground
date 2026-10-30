import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readMachine,
  roleOf,
  sampleMachine,
  sampleOf,
} from "../../../../../packages/scripts/src/ops-machine/machine"

const scratch = mkdtempSync(join(tmpdir(), "ops-machine-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const SYSCTL: Record<string, string> = {
  "hw.ncpu": "12",
  "kern.memorystatus_level": "64",
  "kern.memorystatus_vm_pressure_level": "2",
  "vm.loadavg": "{ 3.10 4.20 5.30 }",
  "vm.swapusage": "total = 2048.00M  used = 512.25M  free = 1535.75M  (encrypted)",
}

test("a session's role is its seat's: a manager, a worker, checker, runner or probe, else other", () => {
  expect(roleOf("b7k2mq-planner")).toBe("manager")
  expect(roleOf("b7k2mq-reviewer")).toBe("reviewer")
  expect(roleOf("b7k2mq-runner")).toBe("runner")
  expect(roleOf("b7k2mq-researcher")).toBe("other")
  expect(roleOf("my-own-session")).toBe("other")
})

test("a sample reads load, memory and swap from sysctl, and counts sessions by role and backend", () => {
  const sample = sampleOf({
    at: new Date("2026-01-02T03:04:05.678Z"),
    sessions: [
      { args: "claude --model glm-4.6", name: "b7k2mq-worker" },
      { args: "claude", name: "c8m3nr-worker" },
      { args: "claude", name: "d9n4ps-builder" },
    ],
    sysctl: SYSCTL,
    waiters: 2,
  })
  expect(sample).toEqual({
    at: "2026-01-02T03:04:05Z",
    backends: { claude: 2, glm: 1 },
    cores: 12,
    freePct: 64,
    load1: 3.1,
    load15: 5.3,
    load5: 4.2,
    pressure: 2,
    roles: { manager: 1, worker: 2 },
    runSlotWaiters: 2,
    sessions: 3,
    swapUsedMB: 512.25,
  })
})

test("one read appends its line to the ops folder's machine.jsonl, and a failed sysctl writes nothing", async () => {
  const ops = join(scratch, "ops")
  mkdirSync(join(ops, "run-slot.waiters"), { recursive: true })
  writeFileSync(join(ops, "run-slot.waiters", "a"), "")
  const run = async (argv: string[]) =>
    argv[0] === "sysctl"
      ? { code: 0, out: `${SYSCTL[argv[2]!]}\n` }
      : { code: 0, out: "  41 claude --model glm-4.6\n" }
  await sampleMachine(run, ops, [{ name: "b7k2mq-worker", pid: 41 }], new Date(0))
  const lines = readFileSync(join(ops, "machine.jsonl"), "utf8").trim().split("\n")
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0]!)).toMatchObject({
    backends: { claude: 0, glm: 1 },
    runSlotWaiters: 1,
    sessions: 1,
  })
  const failing = async () => ({ code: 1, out: "" })
  await expect(sampleMachine(failing, ops, [])).rejects.toThrow("sysctl hw.ncpu exited 1")
  expect(readFileSync(join(ops, "machine.jsonl"), "utf8").trim().split("\n")).toHaveLength(1)
  expect(await readMachine(run, join(scratch, "unwritten"), [])).toMatchObject({ sessions: 0 })
  expect(existsSync(join(scratch, "unwritten"))).toBe(false)
})
