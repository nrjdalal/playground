import { diff, record } from "./record"
import { commitTree, workingTree } from "./tree"

// `bun run parity [--base <ref>] [--head <ref>] [--print]`, or `bun run parity replay` (replay/cli.ts): diffs the head (the working tree unless --head names a commit) against the base (the local `parity-baseline` tag unless --base names another), printing each line the head lost or changed and exiting 1 on any; --print prints the head's recording instead.

if (process.argv[2] === "replay") {
  const { replay } = await import("./replay/cli")
  process.exit(await replay(process.argv.slice(3)))
}

const args = process.argv.slice(2)
const option = (name: string) => {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args[at + 1]
}
const root = (await Bun.$`git rev-parse --show-toplevel`.text()).trim()
const baseRef = option("--base") ?? "parity-baseline"
const headRef = option("--head")
const head = record(headRef ? await commitTree(root, headRef) : await workingTree(root))

if (args.includes("--print")) {
  console.log(head.join("\n"))
  process.exit(0)
}

const base = record(await commitTree(root, baseRef))
const cases = (lines: string[]) =>
  lines.filter((l) => l.startsWith("tests\t")).reduce((sum, l) => sum + Number(l.split("\t")[2]), 0)
const lines = diff(base, head)
for (const line of lines) console.log(line)
console.error(
  `parity: ${headRef ?? "the working tree"} against ${baseRef}: ${lines.length} lines; test cases ${cases(base)} -> ${cases(head)}`,
)
process.exit(lines.length ? 1 : 0)
