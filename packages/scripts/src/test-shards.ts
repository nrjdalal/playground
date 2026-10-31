// test-shards.ts matrix | files <shard>: CI's split of the suite into shards by tests/timings.json, each about BUDGET_MS of file time, so the suite's wall time stays near one shard's as it grows.
import { existsSync, readFileSync } from "node:fs"

// recorded file time per shard: on CI a shard of 3 workers ran 180s of wall time for 335s recorded (the slowest of four, measured), so 300s gives about 160s, inside the 3-minute target
export const BUDGET_MS = 300_000
const TIMINGS = "tests/timings.json"
// bun test's own file patterns
const PATTERN = "tests/**/*{.test,_test,.spec,_spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"

// Pure: files longest first, each to the lightest shard (the first on a tie), as many shards as the total over budget needs; a file with no timing weighs the known files' mean, so new files spread, and it goes after them.
export function shards(
  timings: Record<string, number>,
  files: string[],
  budget: number,
): string[][] {
  const known = files.filter((file) => file in timings)
  const mean = known.length
    ? known.reduce((sum, file) => sum + timings[file]!, 0) / known.length
    : 0
  const weight = (file: string) => timings[file] ?? mean
  const order = [
    ...known.sort((a, b) => timings[b]! - timings[a]! || a.localeCompare(b)),
    ...files.filter((file) => !(file in timings)).sort(),
  ]
  const total = order.reduce((sum, file) => sum + weight(file), 0)
  const count = Math.max(1, Math.ceil(total / budget))
  const split: string[][] = Array.from({ length: count }, () => [])
  const load = Array.from({ length: count }, () => 0)
  for (const file of order) {
    const lightest = load.indexOf(Math.min(...load))
    split[lightest]!.push(file)
    load[lightest]! += weight(file)
  }
  return split
}

if (import.meta.main) {
  const [verb, shard] = process.argv.slice(2)
  const timings: Record<string, number> = existsSync(TIMINGS)
    ? (JSON.parse(readFileSync(TIMINGS, "utf8")).files ?? {})
    : {}
  const files = [...new Bun.Glob(PATTERN).scanSync(".")].sort()
  const split = shards(timings, files, BUDGET_MS)
  if (verb === "matrix") console.log(JSON.stringify(split.map((_, i) => i + 1)))
  else if (verb === "files" && Number(shard) >= 1 && Number(shard) <= split.length)
    console.log(split[Number(shard) - 1]!.map((file) => `./${file}`).join("\n"))
  else {
    console.error(`usage: test-shards.ts matrix | files <1-${split.length}>`)
    process.exit(2)
  }
}
