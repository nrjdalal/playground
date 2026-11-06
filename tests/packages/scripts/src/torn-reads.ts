import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A reader process that stats path in a tight loop until stopped, counting each read that finds it missing or of a size none of sizes names, as a guard starting mid-write would load it; its files go in dir.
export const watchTorn = async (
  path: string,
  sizes: number[],
  dir: string,
): Promise<() => Promise<{ reads: number; torn: number }>> => {
  const ready = join(dir, "torn-ready")
  const stop = join(dir, "torn-stop")
  const counts = join(dir, "torn-counts.json")
  const reader = join(dir, "torn-reader.ts")
  writeFileSync(
    reader,
    `import { existsSync, statSync, writeFileSync } from "node:fs"\nconst sizes = ${JSON.stringify(sizes)}\nlet reads = 0\nlet torn = 0\nwriteFileSync(${JSON.stringify(ready)}, "")\nwhile (!existsSync(${JSON.stringify(stop)})) {\n  reads++\n  try {\n    if (!sizes.includes(statSync(${JSON.stringify(path)}).size)) torn++\n  } catch {\n    torn++\n  }\n}\nwriteFileSync(${JSON.stringify(counts)}, JSON.stringify({ reads, torn }))\n`,
  )
  const watcher = Bun.spawn([process.execPath, reader])
  while (!existsSync(ready)) await Bun.sleep(5)
  return async () => {
    writeFileSync(stop, "")
    await watcher.exited
    return JSON.parse(readFileSync(counts, "utf8"))
  }
}
