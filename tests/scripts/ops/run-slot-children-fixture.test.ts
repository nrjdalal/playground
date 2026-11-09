import { setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SCRIPT, machine, stop } from "./run-slot-fake"

// The child `bun test` run behind run-slot-children.test.ts's two cases: one test hangs past its own timeout, which bun's own timeout handling ends, its dangling run-slot.sh and the command alike, and one stops a loop that traps TERM by its own stop, whose KILL leaves the loop an orphan that only the file's afterAll (endChildren) ends. Each writes the handles it started to the evidence file the outer test reads, so the outer asserts on real pids. Without RUN_SLOT_FIXTURE_HANG the suite's own run of this file starts nothing and passes.
setDefaultTimeout(30_000)

const evidencePath = () =>
  process.env.RUN_SLOT_FIXTURE_EVIDENCE ??
  join(tmpdir(), `run-slot-children-fixture-${process.pid}.json`)

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

if (process.env.RUN_SLOT_FIXTURE_HANG) {
  test("a gated fixture whose gate never appears, hung past this test's timeout", async () => {
    const m = machine()
    const gate = join(m.root, "gate-never")
    const run = m.start("worker-a", {}, SCRIPT, [
      "bash",
      "-c",
      `touch "$0"; until [ -e "${gate}" ]; do sleep 0.1; done`,
    ])
    await until(() => logged(m, "start", run.p.pid))
    await until(() => existsSync(run.marker))
    writeFileSync(evidencePath(), JSON.stringify({ aRunner: run.p.pid, aCommand: childPids(m) }))
    await Bun.sleep(120_000)
  }, 8_000)

  test("a loop that traps TERM, stopped by its own stop", async () => {
    const m = machine()
    const run = m.start("worker-x", {}, SCRIPT, [
      "bash",
      "-c",
      'touch "$0"; trap "" TERM; while :; do sleep 0.2; done',
    ])
    await until(() => logged(m, "start", run.p.pid))
    await until(() => existsSync(run.marker))
    const bCommand = childPids(m)
    await stop(run.p)
    const read = existsSync(evidencePath())
      ? (JSON.parse(readFileSync(evidencePath(), "utf8")) as Record<string, unknown>)
      : {}
    writeFileSync(evidencePath(), JSON.stringify({ ...read, bRunner: run.p.pid, bCommand }))
  })
}
