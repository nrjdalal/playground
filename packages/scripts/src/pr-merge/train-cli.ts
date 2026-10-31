import { parseArgs } from "node:util"

import { mergeReady } from "./ready"
import { forecast, type Drop } from "./train"

const USAGE = `Usage: bun run pr:train <command> [options]

The merge queue: the repo owner's open PRs in merge-queue.json's order (beside the merge lock,
or PLAYGROUND_MERGE_QUEUE).

  forecast     merge each open PR, gated or not, drafts too, in merge-queue order onto canary
               and each PR ahead of it, and print each predicted conflict with its files and
               the PR it comes from; writes nothing
  ready        merge-on-ready: the first PR, in queue order, whose every pr:merge gate passes
               at its head merges at once through pr:merge. One merge a call

Options
  --json          print the result as JSON
  --repo <o/n>    the repo (default: the one gh sees from this checkout)
  -h, --help      this help`

const parse = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        help: { short: "h", type: "boolean" },
        json: { type: "boolean" },
        repo: { type: "string" },
      },
    })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    process.exit(1)
  }
}

const { positionals, values } = parse()
const [command] = positionals
if (values.help || !command || positionals.length > 1) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

const options = { repo: values.repo }

const out = (data: unknown, text: string[]) =>
  console.log(values.json ? JSON.stringify(data, null, 2) : text.join("\n"))

const dropLine = (drop: Drop) => `✗ #${drop.n} at ${drop.head.slice(0, 7)} ${drop.why}`

try {
  switch (command) {
    case "forecast": {
      const result = await forecast(options)
      out(result, [
        `Merge-queue order on canary ${result.canary.slice(0, 7)}: ${result.order.map((n) => `#${n}`).join(", ") || "no open PR"}`,
        ...(result.conflicts.length > 0
          ? result.conflicts.map(dropLine)
          : ["✓ no predicted conflict"]),
      ])
      break
    }
    case "ready": {
      const result = await mergeReady(options)
      out(result, [
        result.merged
          ? `Merged #${result.merged.n} on ready at ${result.merged.sha}: ${result.merged.why}`
          : "Nothing merged on ready.",
        ...result.refused.map((r) => `- #${r.n} refused: ${r.why}`),
      ])
      break
    }
    default:
      console.error(`unknown command ${command}\n\n${USAGE}`)
      process.exit(1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
