// ship:merge <n>: merges the ship PR into main with a merge commit at its head, only when its body holds the pin's gate and rehearsal lines, both gate checks are green there, and the ship's freeze names the next version.

import { ciGate, REQUIRED_CHECKS, type Check } from "./gates"
import { freezeLine, freezeStatus, heldPath } from "./held"
import { gh, repoOf, runGh, type Run } from "./merge"
import { gateLine, REHEARSAL_RESULTS, rehearsalLine } from "./ship-lines"

export type ShipFacts = {
  base: string
  body: string
  checks: Check[]
  // The `"*"` line while it holds, null when none is set or it has lapsed.
  freeze: string | null
  head: string
  state: string
  // The version this ship tags: the last tag's patch plus one.
  version: string
}

// Pure: why the ship PR may not merge, one line each; none means it may.
export function shipRefusals(facts: ShipFacts): string[] {
  const refusals: string[] = []
  if (facts.state !== "OPEN" || facts.base !== "main")
    refusals.push(
      `pr: it is ${facts.state.toLowerCase()} into ${facts.base}: ship:merge merges an open ship PR into main`,
    )
  const lines = new Set(facts.body.split(/\r?\n/).map((line) => line.trim()))
  const pass = gateLine(facts.head, false)
  const fail = gateLine(facts.head, true)
  if (lines.has(fail))
    refusals.push(
      `gate: the body holds "${fail}": a FAIL holds the ship, by the ship skill's step 1 line for a ship that stops`,
    )
  else if (!lines.has(pass))
    refusals.push(
      `gate: the body holds no "${pass}" line: run bun run gate:new-user ${facts.head} and write its last line into the body on a line of its own`,
    )
  if (!REHEARSAL_RESULTS.some((result) => lines.has(rehearsalLine(facts.head, result))))
    refusals.push(
      `rehearsal: the body holds no ${REHEARSAL_RESULTS.map((r) => `"${rehearsalLine(facts.head, r)}"`).join(" or ")} line, on a line of its own`,
    )
  const gateChecks = facts.checks.filter((check) => REQUIRED_CHECKS.includes(check.name ?? ""))
  const ci = ciGate(gateChecks, { required: REQUIRED_CHECKS })
  if (!ci.ok) refusals.push(`ci: ${ci.detail}`)
  if (facts.freeze !== freezeLine(facts.version))
    refusals.push(
      `freeze: ${facts.freeze ? `the "*" line reads "${facts.freeze}"` : 'no "*" line holds'}, so run bun run ship:freeze ${facts.version} (the ship skill's step 1)`,
    )
  return refusals
}

// Pure: the version after a tag, its patch plus one.
export function nextVersion(tag: string): string {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim())
  if (!match) throw new Error(`the last tag ${tag || "(none)"} is not vX.Y.Z`)
  return `v${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export async function shipFactsOf(
  run: Run,
  repo: string,
  n: number,
  now = Date.now(),
): Promise<ShipFacts> {
  const view = JSON.parse(
    await gh(run, [
      "pr",
      "view",
      String(n),
      "-R",
      repo,
      "--json",
      "baseRefName,body,headRefOid,state,statusCheckRollup",
    ]),
  ) as {
    baseRefName: string
    body: string | null
    headRefOid: string
    state: string
    statusCheckRollup: Check[] | null
  }
  const tag = await gh(run, ["api", `repos/${repo}/releases/latest`, "--jq", ".tag_name"])
  const status = await freezeStatus(heldPath(), now)
  return {
    base: view.baseRefName,
    body: view.body ?? "",
    checks: view.statusCheckRollup ?? [],
    freeze: status && !status.lapsed ? status.line : null,
    head: view.headRefOid,
    state: view.state,
    version: nextVersion(tag),
  }
}

// Reads the ship PR, and merges it at exactly the head it read when nothing refuses: `--match-head-commit` refuses if the head moved since.
export async function shipMerge(
  run: Run,
  repo: string,
  n: number,
): Promise<{ refusals: string[] } | { sha: string }> {
  const facts = await shipFactsOf(run, repo, n)
  const refusals = shipRefusals(facts)
  if (refusals.length > 0) return { refusals }
  await gh(run, [
    "pr",
    "merge",
    String(n),
    "-R",
    repo,
    "--merge",
    "--match-head-commit",
    facts.head,
  ])
  const sha = await gh(run, [
    "pr",
    "view",
    String(n),
    "-R",
    repo,
    "--json",
    "mergeCommit",
    "--jq",
    ".mergeCommit.oid",
  ])
  return { sha }
}

const USAGE = `Usage: bun run ship:merge <n>

Merges ship PR <n> into main with a merge commit at its head, the ship skill's step 3, and refuses,
naming each reason, unless its body holds the new-user gate's PASS line and the invitee rehearsal's
line for that head, Audit, Lint, and Build and test are green there, and ship:freeze holds the
next version.`

if (import.meta.main) {
  const [arg = "", ...rest] = process.argv.slice(2)
  if (!/^\d+$/.test(arg) || rest.length > 0) {
    console.log(USAGE)
    process.exit(arg === "-h" || arg === "--help" ? 0 : 1)
  }
  try {
    const repo = await repoOf(runGh)
    const outcome = await shipMerge(runGh, repo, Number(arg))
    if ("refusals" in outcome) {
      console.error(
        `ship:merge: #${arg} not merged:\n${outcome.refusals.map((r) => `- ${r}`).join("\n")}`,
      )
      process.exit(1)
    }
    console.log(`ship:merge: merged #${arg} at ${outcome.sha}`)
  } catch (error) {
    console.error(`ship:merge: ${(error as Error).message}`)
    process.exit(1)
  }
}
