import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  flagsOf,
  launchdAwakeOf,
  lidSleepOf,
} from "../../../../../packages/scripts/src/ops-awake/flags"

const scratch = mkdtempSync(join(tmpdir(), "ops-awake-flags-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

describe("flagsOf", () => {
  test("holds -dimsu by default and -dimu when the machine sleeps with its lid shut", () => {
    expect(flagsOf(false)).toEqual(["-dimsu"])
    expect(flagsOf(true)).toEqual(["-dimu"])
  })
})

// launchctl is stubbed: no test reads this Mac's launchd.
describe("launchdAwakeOf", () => {
  test("asks launchctl for com.playground.ops-awake in this user's gui domain and reads loaded from exit 0", async () => {
    const asks: string[][] = []
    const awake = await launchdAwakeOf(async (argv) => {
      asks.push(argv)
      return { code: 0, out: "" }
    })
    expect(awake.state).toBe("loaded")
    expect(awake.code).toBe(0)
    expect(asks).toEqual([
      ["launchctl", "print", `gui/${process.getuid?.() ?? 0}/com.playground.ops-awake`],
    ])
  })

  test("launchctl's not-found exit (113) reads absent and keeps the job allowed to start", async () => {
    const awake = await launchdAwakeOf(async () => ({ code: 113, out: "Could not find service" }))
    expect(awake.state).toBe("absent")
  })

  test("any other exit reads failed, its code and output carried for the caller's reason", async () => {
    const awake = await launchdAwakeOf(async () => ({ code: 3, out: "some usage error" }))
    expect(awake.state).toBe("failed")
    expect(awake.code).toBe(3)
    expect(awake.out).toBe("some usage error")
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
