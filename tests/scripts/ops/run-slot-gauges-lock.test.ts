import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine } from "./run-slot-fake"

// a check waits on its looks' exits, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>
const now = () => Math.floor(Date.now() / 1000)
// a top that takes a second, as the real one's two samples do, so looks that start together overlap it; each call is a line in top.log
const slowTop = (m: Machine, idle = 80) => {
  writeFileSync(
    join(m.bin, "top"),
    `#!/bin/bash\necho "$*" >> ${join(m.root, "top.log")}\nsleep 1\necho "CPU usage: 1.00% user, 1.00% sys, 98.00% idle "\necho "CPU usage: 10.00% user, 10.00% sys, ${idle}% idle "\n`,
  )
  chmodSync(join(m.bin, "top"), 0o755)
}
const tops = (m: Machine) => {
  const path = join(m.root, "top.log")
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0
}
// a cached reading taken `age` seconds ago
const cache = (m: Machine, age: number, idle: string, swap = "0") =>
  writeFileSync(join(m.ops, "run-slot.gauges"), `${now() - age} ${idle} ${swap}\n`)
const lock = (m: Machine) => join(m.ops, "run-slot.gauges.lock")
// how many of run-slot to run-slot-4 are held or open now, read by `count` looks started together
const looks = async (m: Machine, count = 1) =>
  Promise.all(
    Array.from({ length: count }, async () => {
      const p = Bun.spawn(["bash", SCRIPT, "slots"], {
        cwd: m.root,
        env: m.env(),
        stderr: "ignore",
      })
      await p.exited
      return (await new Response(p.stdout).text()).trim()
    }),
  )

// 3 Nov, 10:53 to 10:58Z: 26 waiters each found run-slot.gauges stale and ran top at once, 16 to 23 tops at a time, and load1 reached 56.8
describe("the gauges refresh under one lock", () => {
  test("eight looks at a stale reading run top once", async () => {
    const m = machine()
    slowTop(m)
    cache(m, 60, "80")
    expect(await looks(m, 8)).toEqual(Array(8).fill("4"))
    expect(tops(m)).toBe(1)
  })

  test("eight looks with no reading yet run top once", async () => {
    const m = machine()
    slowTop(m)
    await looks(m, 8)
    expect(tops(m)).toBe(1)
  })

  test("the refresher takes the lock away once it has written the reading", async () => {
    const m = machine()
    expect(await looks(m)).toEqual(["4"])
    expect(existsSync(lock(m))).toBe(false)
    expect(readFileSync(join(m.ops, "run-slot.gauges"), "utf8")).toMatch(/^\d+ 80 0\n$/)
  })

  test("a look that finds the lock held keeps the stale reading and runs no top", async () => {
    const m = machine({ idle: 80 })
    cache(m, 60, "30")
    mkdirSync(lock(m))
    expect(await looks(m)).toEqual(["1"])
    expect(tops(m)).toBe(0)
  })

  test("a look that finds the lock held and no reading at all keeps the lanes shut", async () => {
    const m = machine({ idle: 80 })
    mkdirSync(lock(m))
    expect(await looks(m)).toEqual(["1"])
    expect(tops(m)).toBe(0)
  })

  test("a lock 30 s old is a dead refresher's, so a look takes it over and refreshes", async () => {
    const m = machine({ idle: 80 })
    cache(m, 60, "30")
    mkdirSync(lock(m))
    utimesSync(lock(m), now() - 31, now() - 31)
    expect(await looks(m)).toEqual(["4"])
    expect(tops(m)).toBe(1)
    expect(existsSync(lock(m))).toBe(false)
  })

  test("a lock 20 s old, a slow refresher's, still holds", async () => {
    const m = machine({ idle: 80 })
    cache(m, 60, "30")
    mkdirSync(lock(m))
    utimesSync(lock(m), now() - 20, now() - 20)
    expect(await looks(m)).toEqual(["1"])
    expect(tops(m)).toBe(0)
  })
})
