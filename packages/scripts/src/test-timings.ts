// test-timings.ts <dir>: merges CI's shard timings in <dir> (one folder per shard, its timings.json and shard-files) over tests/timings.json, so the shard planner splits by the last passing run's times; with no shard there it keeps the committed file.
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const TIMINGS = "tests/timings.json"

export type Timings = Record<string, number>
export type Shard = { files: string[]; timings: Timings }

const usable = (ms: unknown): ms is number =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= 0

// Pure: each shard's own files take its fresh timing, every other file keeps its old one, a file that is gone drops, and the result runs slowest first, as bun writes it.
export function refresh(
  base: Timings,
  shards: Shard[],
  exists: (file: string) => boolean,
): Timings {
  const next: Timings = { ...base }
  for (const shard of shards)
    for (const listed of shard.files) {
      const file = listed.replace(/^\.\//, "")
      if (usable(shard.timings[file])) next[file] = shard.timings[file]
    }
  return Object.fromEntries(
    Object.entries(next)
      .filter(([file]) => exists(file))
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b)),
  )
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (!dir) {
    console.error("usage: test-timings.ts <dir of shard folders>")
    process.exit(2)
  }
  const read = async (path: string): Promise<Timings> => (await Bun.file(path).json()).files ?? {}
  const folders = existsSync(dir)
    ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "shard-files")))
    : []
  if (folders.length === 0) {
    console.error(`test-timings: no shard in ${dir}, so the split keeps the committed timings`)
    process.exit(0)
  }
  const shards = await Promise.all(
    folders.map(async (name) => ({
      files: (await Bun.file(join(dir, name, "shard-files")).text()).split("\n").filter(Boolean),
      timings: await read(join(dir, name, "timings.json")),
    })),
  )
  const files = refresh(await read(TIMINGS), shards, existsSync)
  await Bun.write(TIMINGS, `${JSON.stringify({ version: 1, files }, null, 2)}\n`)
  console.error(`test-timings: ${Object.keys(files).length} files, ${shards.length} shards merged`)
}
