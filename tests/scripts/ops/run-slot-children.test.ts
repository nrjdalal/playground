import { beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the child `bun test` run's file, whose flagged tests hang and stop the fixtures this file reads evidence about
const runSlotChildrenFixture = join(import.meta.dir, "run-slot-children-fixture.test.ts")

// this file drives a child `bun test` run, so its budget is its own
setDefaultTimeout(120_000)

// whether pid (or its group, with `group`) holds nothing, polled, since a read right after an end can still race the last breath
const gone = async (pid: number, group = false) => {
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      process.kill(group ? -pid : pid, 0)
    } catch {
      return true
    }
    if (Date.now() > deadline) return false
    await Bun.sleep(50)
  }
}

type Evidence = {
  aRunner: number
  aCommand: number[]
  bRunner: number
  bCommand: number[]
}
// both cases read one child `bun test` run of the fixture file, so its ~20s hang and stop run once, not twice
let code: number | undefined
let read: Evidence
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "children-fixture-"))
  const evidence = join(dir, "evidence.json")
  const p = Bun.spawn([process.execPath, "test", runSlotChildrenFixture], {
    env: { ...process.env, RUN_SLOT_FIXTURE_HANG: "1", RUN_SLOT_FIXTURE_EVIDENCE: evidence },
    stdout: "ignore",
    stderr: "ignore",
  })
  code = await p.exited
  read = JSON.parse(readFileSync(evidence, "utf8")) as Evidence
  rmSync(dir, { force: true, recursive: true })
}, 120_000)

// 7 Nov 00:38Z, issue 1316: five run-slot.sh processes from these fixtures outlived their tests, each with ppid 1, since a child left running when its test fails or times out is stopped by nothing. The child `bun test` run starts a fixture that hangs past its own timeout, so what ends it is the file's afterAll or bun's own timeout handling, never a call this file makes; the outer reads the pids the fixture recorded and asserts them gone.
test("a fixture hung past its test's timeout ends with its file: runner and command alike", async () => {
  expect(code, "the child run's hang test should have failed on its timeout").not.toBe(0)
  expect(
    await gone(read.aRunner),
    `run-slot child ${read.aRunner} of the hung fixture still runs`,
  ).toBe(true)
  for (const pid of read.aCommand)
    expect(await gone(pid, true), `the hung fixture's command ${pid} still runs`).toBe(true)
})

test("a fixture's loop that traps TERM, orphaned by its own stop, ends in the file's afterAll", async () => {
  expect(
    await gone(read.bRunner),
    `run-slot child ${read.bRunner} of the stopped fixture still runs`,
  ).toBe(true)
  for (const pid of read.bCommand)
    expect(await gone(pid, true), `the stopped fixture's loop ${pid} still runs`).toBe(true)
})
