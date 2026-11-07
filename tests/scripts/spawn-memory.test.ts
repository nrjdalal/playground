import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { launchAfterRm, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them, so each gets the sandbox tests' allowance.
setDefaultTimeout(40_000)

const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
const builtOf = (r: { home: string }, file: string) =>
  JSON.parse(readFileSync(settingsOf(r, file), "utf8"))

// #1484: the auto-memory trial turns memory on for one launch alone, so the shared built file every other session reads stays as it is
describe("--memory <dir> turns auto-memory on for one launch (#1484)", () => {
  const SHARED = "factory-settings-sandbox-400k.json"
  const OWN = "factory-settings-sandbox-400k-memory-probe-x.json"

  test("without it, a probe's built file holds no memory key, as before", async () => {
    const r = await spawn(["probe", "probe-x", "ops", "p.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, SHARED)} `)
    const built = builtOf(r, SHARED)
    expect(built).not.toHaveProperty("autoMemoryEnabled")
    expect(built).not.toHaveProperty("autoMemoryDirectory")
    expect(existsSync(settingsOf(r, OWN))).toBe(false)
  })

  test("with it, the launch reads a built file of its own that sets autoMemoryEnabled and autoMemoryDirectory, and the shared one is not written", async () => {
    const dir = "/tmp/made-up-memory"
    const r = await spawn(["probe", "probe-x", "ops", "p.md", "--memory", dir], [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, OWN)} `)
    expect(builtOf(r, OWN)).toMatchObject({ autoMemoryDirectory: dir, autoMemoryEnabled: true })
    expect(existsSync(settingsOf(r, SHARED))).toBe(false)
  })

  test("it takes an absolute folder, once", async () => {
    const relative = await spawn(["probe", "probe-x", "ops", "p.md", "--memory", "made-up"], [])
    expect(relative.code).not.toBe(0)
    expect(relative.err).toContain("--memory takes an absolute folder")
    const twice = await spawn(
      ["probe", "probe-x", "ops", "p.md", "--memory", "/tmp/a", "--memory", "/tmp/b"],
      [],
    )
    expect(twice.code).not.toBe(0)
    expect(twice.err).toContain("--memory takes an absolute folder")
    const close = await spawn(["close", "probe-x", "--memory", "/tmp/a"], [])
    expect(close.code).not.toBe(0)
    expect(close.err).toContain("close takes a session's name alone")
  })
})
