import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"

import { launchAfterRm, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
const closed = "factory-settings-sandbox-closed-400k.json"
const open = "factory-settings-400k.json"

// A worker or reviewer starts in the closed sandbox unless --no-sandbox, for a start that runs a stack or needs loopback; a tester drives a stack, so it stays off it.
describe("a worker or reviewer starts in the closed sandbox by default", () => {
  const worker = ["worker", "worker-brave-otter", "b.md"]
  const reviewer = ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1"]

  test.each([
    ["a worker", worker],
    ["a reviewer", reviewer],
  ])("%s with no flag takes the closed sandbox, and its row records it", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closed)} `)
    expect(r.roster).toContain("sandbox=on")
  })

  test.each([
    ["a worker", worker],
    ["a reviewer", reviewer],
  ])("%s with --no-sandbox takes the plain file", async (_, args) => {
    const r = await spawn([...args, "--no-sandbox"], [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, open)} `)
    expect(r.roster?.some((word) => word.startsWith("sandbox=on"))).toBe(false)
  })

  test("a tester never takes it", async () => {
    const r = await spawn(
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1"],
      [],
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, open)} `)
  })

  test.each([
    ["a tester", ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1"]],
    ["a probe", ["probe", "probe-x", "ops", "p.md"]],
    ["a runner", ["runner", "runner-calm-heron", "b.md"]],
  ])("--no-sandbox with %s is refused before herdr runs", async (_, args) => {
    const r = await spawn([...args, "--no-sandbox"], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--no-sandbox is for a worker's or a reviewer's start")
    expect(r.roster).toBeUndefined()
  })

  test("--no-sandbox beside --sandbox is refused", async () => {
    const r = await spawn([...worker, "--sandbox", "--no-sandbox"], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--sandbox and --no-sandbox go one at a time")
  })
})
