import { parseArgs } from "node:util"

import { type Gate } from "./gates"
import { holderText, prMerge } from "./merge"

const USAGE = `Usage: bun run pr:merge <n> [options]

Squash-merges PR <n> into canary at its current head, and refuses unless every gate passed
at that head and the head is up to date with canary:

  open, ready   the PR is open and not a draft, or the owner's draft whose every other gate
                passes, which pr:merge marks ready (gh pr ready) just before it merges
  author        the repo's owner opened it, or --outside-author names who did
  held          ~/.playground/ops/report/held-prs.json does not list it (or
                PLAYGROUND_HELD_PRS); a file that does not read holds every PR
  base          it merges into canary
  up to date    canary has no commit the head lacks, or the head merges with canary clean,
                which carries its stamp; a conflict needs canary merged in and the look
  keeps canary  no merge of canary into the PR dropped a line canary added that git's own
                merge keeps and the squash still lacks, in a file that merges clean (a
                merge with -s ours drops them); blank lines, moves and rewrites pass, and
                it names each file and merge
  canary        canary's tip holds no red stamp (canary's own run after each batch, posted
                as a commit comment on it); a red one stops every merge
  ci            every GitHub check on the head finished and passed (none reported passes);
                on factory.repo (the checkout's origin when unset) the head must carry a
                GitGuardian check, since a head it never started on ran no secret scan
  body          the PR body is the PR template the Changelog reads
  review        ## ReviewBot · round <n>: 5/5 at <sha7>, at the head or at a commit it
                reaches past clean canary merges and the reviewer's looks
  stamp         the stamp (bun run stamp --help): green, at the head or carried to it past
                clean canary merges (git merges the two parents to the merge's own tree with
                no conflict) and the reviewer's looks; a dashboard-code PR (web/next/,
                api/hono/, packages/{auth,config,db,env}/) also needs a green stamp passing
                verify (Checks), and a web/next/ PR one passing agent-drive (a tester); wait
                waits for CI, and red or no stamp is not ready

A gate reads only comments the repo's owner wrote; the newest stamp of a kind on a commit
wins, so a red after a green refuses.

A merge train (bun run pr:train --help) merges a batch of gated PRs in one run.

It merges under the factory's merge lock (~/.playground/merge.lock, or
PLAYGROUND_MERGE_LOCK_DIR): one merge into canary at a time, every gate read inside it, and
the lock let go however it ends; a lock another PR holds refuses, naming it.

Options
  --explain       print whether the head merges clean with canary now and as which tree
                  (or the files it conflicts in), then each gate and what it found at the
                  head, and merge nothing
  --outside-author <login>
                  merge a PR that login opened, not the repo's owner: only on a lead's go,
                  once its read-only review and every gate have passed
  --repo <o/n>    the repo (default: the one gh sees from this checkout)
  -h, --help      this help`

const parse = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        explain: { type: "boolean" },
        help: { short: "h", type: "boolean" },
        "outside-author": { type: "string" },
        repo: { type: "string" },
      },
    })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    process.exit(1)
  }
}

const { positionals, values } = parse()
const n = Number(positionals[0])
if (values.help || positionals.length !== 1 || !Number.isInteger(n) || n <= 0) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

const print = (gates: Gate[]) => {
  for (const gate of gates) console.log(`${gate.ok ? "✓" : "✗"} ${gate.name}  ${gate.detail}`)
}

try {
  const outcome = await prMerge(n, {
    explain: values.explain,
    outsideAuthor: values["outside-author"],
    repo: values.repo,
  })
  if (outcome.kind === "explained") console.log(outcome.merge)
  print(outcome.gates)
  switch (outcome.kind) {
    case "explained":
      process.exit(outcome.gates.every((gate) => gate.ok) ? 0 : 1)
      break
    case "refused": {
      const missing = outcome.gates.filter((gate) => !gate.ok).map((gate) => gate.name)
      console.error(`Refused: #${n} has not passed ${missing.join(", ")} at its head`)
      process.exit(1)
      break
    }
    case "locked":
      console.error(
        `Refused: the merge lock is held by ${holderText(outcome.holder)}; try again in a minute, and tell your build lead if it is older than 10 minutes`,
      )
      process.exit(1)
      break
    case "failed":
      console.error(`Not merged: ${outcome.reason}`)
      process.exit(1)
      break
    case "merged":
      console.log(`Merged #${n} at ${outcome.sha}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
