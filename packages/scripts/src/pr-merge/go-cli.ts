import { parseArgs } from "node:util"

import { ciGo, GATE_LABEL, goLogPath, LOCAL_LABEL } from "./go"
import { repoOf, runGh } from "./merge"
import { forecast, queuePath } from "./train"

const USAGE = `Usage: bun run ci:go <n> <sha7> [options]

A lead's ci:go for PR <n> at head <sha7>. Refuses unless the repo's owner opened the
PR, or --outside-author names who did, it is open, and its head starts with <sha7>; then:

  label   adds ${GATE_LABEL}, the go ops-checks-go reads to start a Checks run (scripts/ops/checks/go.py),
          and takes off ${LOCAL_LABEL}, the Checks lane's label for a run with no go
  log     appends {pr, sha, at, by} to ops/gos.jsonl beside the merge lock
          (~/.playground, or PLAYGROUND_MERGE_LOCK_DIR)
  queue   stamps the PR's goAt in merge-queue.json beside it (or PLAYGROUND_MERGE_QUEUE)
  forecast prints each conflict pr:train forecast predicts for <n>, with the PR ahead and
          its files: merge that PR's branch, or canary once it lands, before the last round;
          it reads the owner's PRs alone, so an --outside-author go prints none

It starts no local CI lane: the label starts GitHub Actions' Audit, Lint, and Build and test,
whose result ops-checks-go posts as the head's stamp (bun run stamp --help), and
go.py runs Checks, verify alone, on a dashboard PR. A second go at the same head adds nothing twice
and says so; a moved head needs a new go.

Take back a go with \`bun run ci:go <n> <sha7> --take-back\`: it removes ${GATE_LABEL} first, so
go.py cannot relaunch it, then drops that head's lines from ops/gos.jsonl and clears its goAt.
It refuses a head with no go and stops no process itself: go.py ends a run it started within a
cycle of the label coming off, and whoever started a run by hand stops it.

Options
  --by <name>   who gave the go (default: builder)
  --outside-author <login>
                go a PR that login opened, not the repo's owner, so Checks runs its head:
                only once its read-only review has passed
  --repo <o/n>  the repo (default: the one gh sees from this checkout)
  --take-back   take back the go at this head
  -h, --help    this help`

const parse = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        by: { default: "builder", type: "string" },
        help: { short: "h", type: "boolean" },
        "outside-author": { type: "string" },
        repo: { type: "string" },
        "take-back": { type: "boolean" },
      },
    })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    process.exit(1)
  }
}

const { positionals, values } = parse()
const n = Number(positionals[0])
const sha = positionals[1] ?? ""
if (values.help || positionals.length !== 2 || !Number.isInteger(n) || n <= 0) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

try {
  const outcome = await ciGo(runGh, {
    by: values.by,
    forecast: async () => (await forecast({ repo: values.repo })).conflicts,
    log: goLogPath(),
    n,
    now: () => new Date(),
    outsideAuthor: values["outside-author"],
    queue: queuePath(),
    repo: await repoOf(runGh, values.repo),
    sha,
    takeBack: values["take-back"],
  })
  for (const line of outcome.lines) (outcome.ok ? console.log : console.error)(line)
  process.exit(outcome.ok ? 0 : 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
