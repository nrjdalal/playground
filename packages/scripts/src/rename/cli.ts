import { lstatSync } from "node:fs"
import { dirname, join } from "node:path"

import { plan, type Rule, RULES } from "./rules"

// `bun run rename [--write] [--rule <rule>[,<rule>]] [<path prefix>...]`: plans the rename over every tracked file (or those under the prefixes given), with every rule or those named, and prints what it would do; --write moves and edits the files, refusing first on any collision.

const args = process.argv.slice(2)
const write = args.includes("--write")
const ruleAt = args.indexOf("--rule")
const named = ruleAt === -1 ? [...RULES] : (args[ruleAt + 1] ?? "").split(",")
const unknown = named.filter((rule) => !(RULES as readonly string[]).includes(rule))
if (unknown.length) {
  console.error(`rename: no rule ${unknown.join(", ")}; the rules are ${RULES.join(", ")}`)
  process.exit(1)
}
const rules = new Set(named as Rule[])
const prefixes = args.filter((arg, i) => arg !== "--write" && i !== ruleAt && i !== ruleAt + 1)
const root = (await Bun.$`git rev-parse --show-toplevel`.text()).trim()

const paths = (await Bun.$`git -C ${root} ls-files -z`.text())
  .split("\0")
  .filter((path) => path && (!prefixes.length || prefixes.some((p) => path.startsWith(p))))

const files = await Promise.all(
  paths.map(async (path) => {
    const abs = join(root, path)
    if (!lstatSync(abs, { throwIfNoEntry: false })?.isFile()) return { path, text: null }
    const bytes = await Bun.file(abs).bytes()
    return { path, text: bytes.includes(0) ? null : new TextDecoder().decode(bytes) }
  }),
)

const result = plan(files, rules)
const before = new Map(files.map((f) => [f.path, f.text ?? ""]))
const changedLines = (path: string, text: string) => {
  const old = before.get(path)!.split("\n")
  return text.split("\n").filter((line, i) => line !== old[i]).length
}
const area = (path: string) => path.split("/").slice(0, 2).join("/")
const byArea = new Map<string, { edits: number; lines: number; moves: number }>()
const tally = (path: string) =>
  byArea.get(area(path)) ??
  byArea.set(area(path), { edits: 0, lines: 0, moves: 0 }).get(area(path))!
for (const edit of result.edits) {
  const row = tally(edit.path)
  row.edits++
  row.lines += changedLines(edit.path, edit.text)
}
for (const move of result.moves) tally(move.from).moves++

console.log(`rename: ${result.moves.length} moves, ${result.edits.length} edited files`)
for (const [name, row] of [...byArea].sort(([a], [b]) => a.localeCompare(b)))
  console.log(`  ${name}: ${row.moves} moves, ${row.edits} files, ${row.lines} lines`)
for (const collision of result.collisions) console.error(`collision: ${collision}`)
if (result.collisions.length) process.exit(1)
if (!write) {
  console.log("dry run: pass --write to apply")
  process.exit(0)
}

for (const edit of result.edits) await Bun.write(join(root, edit.path), edit.text)
for (const { from, to } of result.moves) {
  await Bun.$`mkdir -p ${join(root, dirname(to))}`
  await Bun.$`git -C ${root} mv ${from} ${to}`
}
console.log("rename: applied")
