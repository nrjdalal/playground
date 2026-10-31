import { expect, test } from "bun:test"
import { join } from "node:path"

import { shards } from "../../../../packages/scripts/src/test-shards"

const sum = (files: string[], timings: Record<string, number>) =>
  files.reduce((total, file) => total + (timings[file] ?? 0), 0)

test("files go longest first to the lightest shard, as many shards as the budget needs", () => {
  const timings = { a: 90, b: 80, c: 70, d: 30, e: 20, f: 10 }
  const split = shards(timings, Object.keys(timings), 100)
  expect(split).toHaveLength(3)
  expect(split.map((files) => sum(files, timings))).toEqual([100, 100, 100])
  expect(split).toEqual([
    ["a", "f"],
    ["b", "e"],
    ["c", "d"],
  ])
})

test("a file with no timing goes to the lightest shard, and none is dropped", () => {
  const timings = { a: 90, b: 40, c: 30 }
  const split = shards(timings, ["a", "b", "c", "new"], 120)
  expect(split).toEqual([["a"], ["b", "c", "new"]])
  expect(split.flat().sort()).toEqual(["a", "b", "c", "new"])
})

test("several new files spread across the shards rather than piling on one", () => {
  const split = shards({ a: 60, b: 60 }, ["a", "b", "x", "y"], 120)
  expect(split).toEqual([
    ["a", "x"],
    ["b", "y"],
  ])
})

test("a timing for a file that is gone is ignored, and one shard is the least", () => {
  expect(shards({ gone: 500, a: 10 }, ["a"], 100)).toEqual([["a"]])
  expect(shards({}, [], 100)).toEqual([[]])
})

test("the shard count grows with the suite", () => {
  const timings = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, 25]))
  expect(shards(timings, Object.keys(timings).slice(0, 20), 100)).toHaveLength(5)
  expect(shards(timings, Object.keys(timings), 100)).toHaveLength(10)
})

test("the CLI prints the matrix and one shard's files as paths bun reads as paths", () => {
  const cli = join(import.meta.dir, "../../../../packages/scripts/src/test-shards.ts")
  const run = (...args: string[]) => {
    const child = Bun.spawnSync(["bun", cli, ...args])
    expect(child.stderr.toString()).toBe("")
    expect(child.exitCode).toBe(0)
    return child.stdout.toString()
  }
  const matrix = JSON.parse(run("matrix"))
  expect(matrix.length).toBeGreaterThan(1)
  expect(matrix).toEqual(matrix.map((_: unknown, i: number) => i + 1))
  const all = matrix.flatMap((shard: number) => run("files", String(shard)).trim().split("\n"))
  expect(
    all.every((file: string) => file.startsWith("./tests/") && file.endsWith(".test.ts")),
  ).toBe(true)
  expect(new Set(all).size).toBe(all.length)
  expect(all).toContain("./tests/packages/scripts/src/test-shards.test.ts")
})
