// Merge-on-ready: a PR ready before another merges straight away, so each PR a train would take, in queue order, merges at once through pr:merge when every gate passes, with no train. Its stamp carries across canary's moves while it merges clean, so several stamped PRs merge back to back with no new run. One merge a call.
import { gatesOf, marksReady } from "./gates"
import { gateOptions, prMerge, repoOf, runGh, type Outcome, type Run } from "./merge"
import { gatedOf, resolve, TRAIN_SKIPS, type TrainLocal } from "./train"

export type Readied = {
  merged?: { n: number; sha: string; why: string }
  refused: { n: number; why: string }[]
}

// merge: how one PR merges, pr:merge's own path unless a test hands its own.
export type ReadyLocal = TrainLocal & {
  merge?: (n: number) => Promise<Outcome>
}

const refusal = (outcome: Outcome): string =>
  outcome.kind === "locked"
    ? `the merge lock is held by ${outcome.holder}`
    : outcome.kind === "failed"
      ? outcome.reason
      : `has not passed ${outcome.gates
          .filter((gate) => !gate.ok)
          .map((gate) => gate.name)
          .join(", ")}`

export async function mergeReady(
  { repo }: { repo?: string },
  run: Run = runGh,
  local: ReadyLocal = {},
): Promise<Readied> {
  const { facts, queue } = resolve(local)
  const name = await repoOf(run, repo)
  const options = await gateOptions(name)
  const merge = local.merge ?? ((n: number) => prMerge(n, { repo: name }, run))
  const readied: Readied = { refused: [] }
  for (const { facts: pr, n } of (await gatedOf(run, name, facts, queue)).order) {
    const all = gatesOf(pr, options)
    // a draft is marked ready on the gates a train judges, as gatedOf does
    const marked = marksReady(
      pr,
      all.filter((gate) => !TRAIN_SKIPS.has(gate.name)),
    )
    const failing = all.filter((gate) => !gate.ok && !(marked && gate.name === "ready"))
    if (failing.length > 0) continue
    const why = all.find((gate) => gate.name === "stamp")?.detail ?? ""
    const outcome = await merge(n)
    if (outcome.kind === "merged") {
      readied.merged = { n, sha: outcome.sha, why }
      return readied
    }
    readied.refused.push({ n, why: refusal(outcome) })
  }
  return readied
}
