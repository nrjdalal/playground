import { parseArgs } from "node:util"

import { holderText, lockRootOf } from "./merge"
import { mergeReady } from "./ready"
import {
  buildTrain,
  currentTrain,
  endTrain,
  forecast,
  judgeTrain,
  landTrain,
  type Drop,
  type Train,
} from "./train"

const USAGE = `Usage: bun run pr:train <command> [id] [options]

The merge train: every open PR of the repo owner's whose gates pass at its head rides one
train off canary, ops-checks checks the train once, and a green train merges each PR in order.

  forecast     merge each open PR, gated or not, drafts too, in merge-queue order onto canary
               and each PR ahead of it, and print each predicted conflict with its files and
               the PR it comes from; writes nothing
  build        build a train: each PR whose gates pass (all of pr:merge's but up to date
               and the stamp, which the train's own stamp replaces), in merge-queue order,
               a PR whose newest stamp is red at an earlier head at the back and one red at
               its head held, and a draft that passes the rest,
               which land marks ready just before its squash; each squashed in turn onto
               canary as GitHub's squash merge will, so every step's tree is the tree canary
               holds once that PR merges. A PR that conflicts is left out and told on its PR.
               Pushes train/<id> and keeps trains/<id>.json beside the merge lock (the queue
               is merge-queue.json beside it, or PLAYGROUND_MERGE_QUEUE). --dry-run builds it
               locally and stops
  next [id]    "none" while no train runs, else what the train needs next: "check <step
               commit>" (Checks checks that commit and posts its stamp, with a train step
               naming the train, on every PR up to that step), "land <k>" once a step
               passed, with the PR that broke the step after it when the train bisected to one
  land [id]    under the merge lock: refuses unless canary is still the train's and every PR up
               to the passed step is at its step's head, passes its gates and carries that green
               stamp;
               then squash-merges each in order, checking canary's tree after each against its
               step's; tells each merged PR, tells a culprit it left, and ends the train
  ready        merge-on-ready: each PR build would take, in its order, merges at once through
               pr:merge when every gate passes, its stamp carried across canary's moves while
               it merges clean. One merge a call
  end [id]     delete the train's branch and file it under trains/done/; run it after a land
               refusal that will not clear (canary moved, a head moved) or a note that failed

[id] defaults to the newest train still running.

Options
  --dry-run       build only: build the steps locally, push and tell nothing
  --json          print the result as JSON
  --repo <o/n>    the repo (default: the one gh sees from this checkout)
  -h, --help      this help`

const parse = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean" },
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
const [command, given] = positionals
if (values.help || !command || positionals.length > 2) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

const options = { repo: values.repo }

const idOf = async (): Promise<string> => {
  const id = given ?? (await currentTrain(lockRootOf()))
  if (!id) throw new Error("no train is running; build one first")
  return id
}

const out = (data: unknown, text: string[]) =>
  console.log(values.json ? JSON.stringify(data, null, 2) : text.join("\n"))

const dropLine = (drop: Drop) => `✗ #${drop.n} at ${drop.head.slice(0, 7)} ${drop.why}`

const trainLines = (train: Train) => [
  `Train ${train.id} on canary ${train.canary.slice(0, 7)} (${train.branch}):`,
  ...train.steps.map(
    (step, i) =>
      `  ${i + 1}. #${step.n} at ${step.head.slice(0, 7)}  step ${step.commit.slice(0, 7)}, tree ${step.tree.slice(0, 7)}`,
  ),
  ...train.dropped.map(dropLine),
]

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
    case "build": {
      const result = await buildTrain({ ...options, dryRun: values["dry-run"] })
      out(result, [
        ...(result.train ? trainLines(result.train) : ["No PR is ready to ride a train."]),
        ...result.held.map((held) => `- #${held.n} held: ${held.why}`),
        ...(result.train?.steps.length && !values["dry-run"]
          ? [`check ${result.train.steps.at(-1)?.commit}`]
          : []),
      ])
      break
    }
    case "next": {
      const running = given ?? (await currentTrain(lockRootOf()))
      if (!running) {
        out({ next: { kind: "none" } }, ["none: no train is running; build one"])
        break
      }
      const { next, train } = await judgeTrain(running)
      const step = next.kind === "check" ? train.steps[next.step - 1] : undefined
      const prs = (k: number) =>
        train.steps
          .slice(0, k)
          .map((s) => `#${s.n}`)
          .join(", ")
      out({ next, step, train: train.id }, [
        next.kind === "check" && step
          ? `check ${step.commit} (tree ${step.tree}): step ${next.step} of ${train.steps.length}, ${prs(next.step)}`
          : next.kind === "land"
            ? `land ${next.upTo}${next.upTo > 0 ? `: ${prs(next.upTo)}` : ""}${next.culprit ? `; #${train.steps[next.culprit - 1]?.n} broke step ${next.culprit} and leaves` : ""}`
            : "empty",
      ])
      break
    }
    case "land": {
      const result = await landTrain(await idOf())
      if (values.json && result.kind !== "landed") console.log(JSON.stringify(result, null, 2))
      if (result.kind === "locked") {
        console.error(
          `Refused: the merge lock is held by ${holderText(result.holder)}; try again in a minute`,
        )
        process.exit(1)
      }
      if (result.kind === "check") {
        console.error(`Not yet: step ${result.step} has no stamp yet; run next`)
        process.exit(1)
      }
      if (result.kind === "refused") {
        console.error(["Refused:", ...result.problems.map((p) => `  ${p}`)].join("\n"))
        process.exit(1)
      }
      out(result, [
        ...result.merged.map((m) => `Merged #${m.n} at ${m.sha}`),
        ...(result.culprit !== undefined ? [`#${result.culprit} left the train`] : []),
        ...(result.stopped ? [`Stopped: ${result.stopped}`] : []),
        ...(result.stopped && result.merged.length > 0
          ? [
              `canary ${result.merged.at(-1)?.sha} holds a tree no run stamped: canary's own run stamps it next`,
            ]
          : []),
        ...(result.notEnded ? [`Not ended: ${result.notEnded}; run pr:train end`] : []),
      ])
      if (result.stopped || result.notEnded) process.exit(1)
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
    case "end": {
      const id = await idOf()
      await endTrain(id)
      console.log(`Ended train ${id}`)
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
