import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, stop } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const WAIT = /^run-slot\.sh: waiting for load5 under (\d+)/gm

// A machine at the load given, with run-slot.load5-cap's cap when one is given, and a fake git and bun that touch their last word, the marker
const loaded = (load5: number, cap?: number) => {
  const m = machine({ load1: load5 })
  if (cap !== undefined) writeFileSync(join(m.ops, "run-slot.load5-cap"), `${cap}\n`)
  for (const bin of ["bun", "git"]) {
    writeFileSync(
      join(m.bin, bin),
      '#!/bin/bash\ncase " $* " in *" rev-parse "*) exit 0 ;; esac\ntouch "${@: -1}"\n',
    )
    chmodSync(join(m.bin, bin), 0o755)
  }
  // moves the fake load from one figure to another in sysctl and uptime, as a load that falls
  const setLoad = (from: number, to: number) => {
    for (const bin of ["sysctl", "uptime"]) {
      const path = join(m.bin, bin)
      writeFileSync(path, readFileSync(path, "utf8").split(from.toFixed(2)).join(to.toFixed(2)))
    }
  }
  const lane = (who: string) =>
    readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
      .split("\n")
      .find((l) => l.split(" ")[1] === "start" && l.split(" ")[2] === who)
      ?.split(" ")[4]
  return { ...m, lane, setLoad }
}

// issue 1385, 7 Nov: 7 commit- and quick-lane starts at load5 17 to 19 against the owner's cap of 15, since no load gate held either lane
describe("a commit-lane start", () => {
  test("waits while load5 is at or over run-slot.load5-cap's cap, and starts once it is under", async () => {
    const m = loaded(18, 15)
    const run = m.start("worker-c", {}, undefined, ["git", "merge", "--no-edit"])
    expect(await run.saw(WAIT)).toBe(true)
    expect(existsSync(run.marker)).toBe(false)
    expect(existsSync(join(m.ops, "run-slot-commit"))).toBe(false)
    m.setLoad(18, 10)
    expect(await run.ran()).toBe(true)
    expect(m.lane("worker-c")).toBe("run-slot-commit")
  })

  test("reads the cap at each poll, so a cap raised mid-wait lets it start", async () => {
    const m = loaded(18, 15)
    const run = m.start("worker-c", {}, undefined, ["git", "merge", "--no-edit"])
    expect(await run.saw(WAIT)).toBe(true)
    writeFileSync(join(m.ops, "run-slot.load5-cap"), "20\n")
    expect(await run.ran()).toBe(true)
  })

  test("waits under load_line's 22 while no switch stands", async () => {
    const m = loaded(23)
    const run = m.start("worker-c", {}, undefined, ["git", "merge", "--no-edit"])
    expect(await run.saw(WAIT)).toBe(true)
    expect(existsSync(run.marker)).toBe(false)
    expect(readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")).not.toMatch(/ start worker-c /)
    await stop(run.p)
  })

  test("starts at once under the cap", async () => {
    const m = loaded(14, 15)
    const run = m.start("worker-c", {}, undefined, ["git", "merge", "--no-edit"])
    expect(await run.ran()).toBe(true)
    expect(await run.saw(WAIT)).toBe(false)
  })

  test("starts once its bound has passed, and says so", async () => {
    const m = loaded(18, 15)
    const run = m.start("worker-c", { RUN_SLOT_LOAD_WAIT: "1" }, undefined, [
      "git",
      "merge",
      "--no-edit",
    ])
    expect(await run.ran()).toBe(true)
    expect(
      await run.saw(/load5 18 is still at or over 15 after \d+s, so this commit run starts/g),
    ).toBe(true)
  })

  test("but the merge train's starts at once", async () => {
    const m = loaded(18, 15)
    const run = m.start("ops-merge-train", {}, undefined, ["git", "merge", "--no-edit"])
    expect(await run.ran()).toBe(true)
    expect(await run.saw(WAIT)).toBe(false)
  })
})

describe("a quick-lane start", () => {
  test("waits the same way", async () => {
    const m = loaded(18, 15)
    const run = m.start("worker-q", {}, undefined, ["bun", "run", "docs:wrap"])
    expect(await run.saw(WAIT)).toBe(true)
    expect(existsSync(run.marker)).toBe(false)
    m.setLoad(18, 10)
    expect(await run.ran()).toBe(true)
    expect(m.lane("worker-q")).toBe("run-slot-quick")
  })
})
