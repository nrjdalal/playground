import { beforeEach, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LockStore } from "../../../../../packages/redis/src/index"

// A taker that takes over a stale lock folder can be paused between judging it stale and claiming it (a laptop asleep, a stopped process), long enough for its key to lapse and other takers to come and go; this file pauses it at its claim, with node:fs/promises passed through untouched otherwise.
const { mkdir } = fs
let paused: Promise<void> | null = null
let pauses = 0
mock.module("node:fs/promises", () => ({
  ...fs,
  mkdir: async (path: string, options?: Parameters<typeof mkdir>[1]) => {
    if (paused && String(path).includes("/merge.lock/over-")) {
      pauses++
      const gate = paused
      paused = null
      await gate
    }
    return mkdir(path, options)
  },
}))
const { takeLock } = await import("../../../../../packages/scripts/src/pr-merge/merge")

// Every take succeeds, as when the paused taker's key lapsed and the next taker took it afresh.
const lapsing = (): LockStore => {
  let n = 0
  return {
    close: () => {},
    free: async () => true,
    renew: async () => true,
    take: async (_key, holder) => ({ value: `token${n++} ${holder}` }),
  }
}

// A lock folder whose Redis holder crashed: marked, with a pid that has gone.
const crashed = () => {
  const at = mkdtempSync(join(tmpdir(), "merge-takeover-"))
  mkdirSync(join(at, "merge.lock"))
  writeFileSync(join(at, "merge.lock", "pr"), "140\n")
  writeFileSync(join(at, "merge.lock", "redis"), `lapsed 140\n${Bun.spawnSync(["true"]).pid}\n`)
  return at
}

const pause = () => {
  let wake!: () => void
  paused = new Promise((resolve) => (wake = resolve))
  return () => wake()
}

beforeEach(() => {
  pauses = 0
})

test("a taker paused at its takeover past its key's life is refused by the taker that came after it, and the lock folder never leaves meanwhile", async () => {
  const at = crashed()
  const wake = pause()
  const store = lapsing()
  const first = takeLock(at, 112, { store })
  await Bun.sleep(50)
  const second = await takeLock(at, 150, { store })
  expect("release" in second).toBe(true)
  expect(await takeLock(at, 160)).toEqual({ holder: "150" })
  wake()
  expect(await first).toEqual({ holder: "150" })
  expect(pauses).toBe(1)
  expect(readFileSync(join(at, "merge.lock", "pr"), "utf8")).toBe("150\n")
})

test("a taker paused at its takeover while the next holder took the lock, let it go and another took it afresh is refused by that one", async () => {
  const at = crashed()
  const wake = pause()
  const store = lapsing()
  const first = takeLock(at, 112, { store })
  await Bun.sleep(50)
  const second = await takeLock(at, 150, { store })
  if (!("release" in second)) throw new Error("150 was refused")
  await second.release()
  const third = await takeLock(at, 170, { store })
  expect("release" in third).toBe(true)
  wake()
  expect(await first).toEqual({ holder: "170" })
  expect(pauses).toBe(1)
  expect(readFileSync(join(at, "merge.lock", "pr"), "utf8")).toBe("170\n")
})
