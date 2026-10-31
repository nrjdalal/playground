import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { flagsOf, lidSleepOf } from "../../../../../packages/scripts/src/ops-awake/flags"

const scratch = mkdtempSync(join(tmpdir(), "ops-awake-flags-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// #i19: -s and -i keep the system awake on AC power and on battery; -d and -u stay off, so the display still sleeps and locks.
describe("flagsOf", () => {
  test.each([false, true])("holds no -d or -u, lid sleep %p", (lidSleep) => {
    expect(flagsOf(lidSleep).join(" ")).not.toMatch(/-[a-z]*[du]/)
  })

  test("holds -s -i by default, and -i alone when the machine sleeps with its lid shut", () => {
    expect(flagsOf(false)).toEqual(["-s", "-i"])
    expect(flagsOf(true)).toEqual(["-i"])
  })
})

describe("lidSleepOf", () => {
  test("reads ops-awake.json in the data folder given, on only when its lidSleep is true", async () => {
    const dir = join(scratch, "on")
    mkdirSync(dir)
    writeFileSync(join(dir, "ops-awake.json"), JSON.stringify({ lidSleep: true }))
    expect(await lidSleepOf(dir)).toBe(true)
  })

  test("a missing file, an unreadable one and a wrong value keep the machine awake with its lid shut", async () => {
    expect(await lidSleepOf(join(scratch, "absent"))).toBe(false)
    const bad = join(scratch, "bad")
    mkdirSync(bad)
    writeFileSync(join(bad, "ops-awake.json"), "{ not json")
    expect(await lidSleepOf(bad)).toBe(false)
    const other = join(scratch, "other")
    mkdirSync(other)
    writeFileSync(join(other, "ops-awake.json"), JSON.stringify({ lidSleep: "yes" }))
    expect(await lidSleepOf(other)).toBe(false)
  })
})
