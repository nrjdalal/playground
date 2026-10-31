// Merge-on-ready: a PR ready before another merges straight away, so each gated PR, in queue order, merges at once through pr:merge when every gate passes, GitHub's checks at its head included. One merge a call.
import { gatesOf, marksReady } from "./gates"
import { gateOptions, prMerge, repoOf, runGh, type Outcome, type Run } from "./merge"
import { gatedOf, resolve, type TrainLocal } from "./train"

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
    // a draft is marked ready on every other gate, as gatedOf does
    const marked = marksReady(pr, all)
    const failing = all.filter((gate) => !gate.ok && !(marked && gate.name === "ready"))
    if (failing.length > 0) continue
    const why = all.find((gate) => gate.name === "ci")?.detail ?? ""
    const outcome = await merge(n)
    if (outcome.kind === "merged") {
      readied.merged = { n, sha: outcome.sha, why }
      return readied
    }
    readied.refused.push({ n, why: refusal(outcome) })
  }
  return readied
}
