import { expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import * as fake from "./run-slot-fake"

const { SCRIPT, machine, stop } = fake

// this file's case is the hang itself, so its budget is its own
setDefaultTimeout(60_000)

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

type Machine = ReturnType<typeof machine>
const until = async (ok: () => boolean) => {
  while (!ok()) await Bun.sleep(20)
}
const logged = (m: Machine, kind: string, pid: number) =>
  existsSync(join(m.ops, "run-slot.runs.log")) &&
  readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
    .split("\n")
    .some((l) => l.split(" ")[1] === kind && l.split(" ")[3] === `${pid}`)
// the command's group leader, whose pid run-slot.sh writes beside its slot once the run starts
const childPids = (m: Machine) =>
  existsSync(m.ops)
    ? readdirSync(m.ops)
        .filter((f) => f.endsWith(".child"))
        .map((f) => Number(readFileSync(join(m.ops, f), "utf8").trim()))
    : []

// 7 Nov 00:38Z, issue 1316: five run-slot.sh processes from these fixtures outlived their tests, each with ppid 1. A gated fixture whose gate never appears is stopped by nothing, so the file's cleanup has to end it and its command
test("a gated fixture whose gate never appears leaves no run-slot child after the file's cleanup", async () => {
  const m = machine()
  const gate = join(m.root, "gate-never")
  const run = m.start("worker-a", {}, SCRIPT, [
    "bash",
    "-c",
    `until [ -e "${gate}" ]; do sleep 0.1; done`,
  ])
  try {
    await until(() => logged(m, "start", run.p.pid))
    const command = childPids(m)
    expect(command.length).toBeGreaterThan(0)
    // what the file's afterAll runs when a test times out; canary has none yet, so the run and its command are left behind
    const end = (fake as { endChildren?: () => Promise<void> | void }).endChildren
    await end?.()
    expect(alive(run.p.pid), `run-slot child ${run.p.pid} of this fixture still runs`).toBe(false)
    for (const pid of command)
      expect(alive(pid), `the fixture's command ${pid} still runs`).toBe(false)
  } finally {
    await stop(run.p)
  }
})

// the worker-x fixture of run-slot-switches.test.ts traps TERM in its loop, so a test that dies before its own KILL leaves a loop nothing can stop by pid; the file's cleanup ends its group, escalating to KILL past the trap
test("a fixture's loop that traps TERM ends with its test", async () => {
  const m = machine()
  const run = m.start("worker-x", {}, SCRIPT, [
    "bash",
    "-c",
    'trap "" TERM; while :; do sleep 0.2; done',
  ])
  try {
    await until(() => logged(m, "start", run.p.pid))
    const command = childPids(m)
    expect(command.length).toBeGreaterThan(0)
    const end = (fake as { endChildren?: () => Promise<void> | void }).endChildren
    await end?.()
    expect(alive(run.p.pid), `run-slot child ${run.p.pid} of this fixture still runs`).toBe(false)
    for (const pid of command)
      expect(alive(pid), `the fixture's loop ${pid} still runs`).toBe(false)
  } finally {
    await stop(run.p)
  }
})
