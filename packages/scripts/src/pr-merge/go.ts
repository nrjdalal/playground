import { appendFile, mkdir, rename } from "node:fs/promises"
import { dirname } from "node:path"

import { gh, loggedHeads, type Run } from "./merge"
import type { Drop } from "./train"

export { goLogPath } from "./merge"

// The label GitHub Actions wait for (.github/workflows/hosted-check-build.yml, hosted-test.yml): a lead's ci:go puts it on the PR.
export const GATE_LABEL = "Cloud CI"
// The label the Checks lane puts on a PR it runs with no go (scripts/ops/checks/parallel.py); the go swaps it for GATE_LABEL, so a PR never carries both.
export const LOCAL_LABEL = "Local CI"

export type GoOptions = {
  by: string
  forecast: () => Promise<Drop[]>
  log: string
  n: number
  now: () => Date
  // The one login besides the repo's owner whose PR the go may label and log, named on purpose, as pr:merge's --outside-author.
  outsideAuthor?: string
  queue: string
  repo: string
  sha: string
  // Takes back the go at this head: the label off first, so go.py cannot relaunch it, then its log lines and its goAt.
  takeBack?: boolean
}

export type GoOutcome = { lines: string[]; ok: boolean }

type View = {
  author: { login: string }
  headRefOid: string
  labels: { name: string }[]
  state: string
}

const sha7 = (sha: string) => sha.slice(0, 7)

// Whether the log already holds a go for this PR at this head.
const logged = async (log: string, n: number, head: string): Promise<boolean> =>
  (await loggedHeads(log)).some((go) => go.pr === n && go.sha === head)

// Writes through a temp file and a rename so a reader never sees half a file.
const replace = async (path: string, text: string) => {
  const temp = `${path}.${process.pid}.tmp`
  await Bun.write(temp, text)
  await rename(temp, path)
}

// Stamps goAt on the PR's merge queue entry, or clears it when at is undefined, every other key kept; false when the queue does not list it.
const stampQueue = async (path: string, n: number, at: string | undefined): Promise<boolean> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return false
  const data = (await file.json()) as { queue?: { goAt?: string; pr?: unknown }[] }
  const entry = data.queue?.find((item) => Number(item.pr) === n)
  if (!entry) return false
  if (at === undefined) delete entry.goAt
  else entry.goAt = at
  await replace(path, `${JSON.stringify(data, null, 2)}\n`)
  return true
}

// Drops the log's lines for PR n at head, every other line kept as it is.
const dropGo = async (log: string, n: number, head: string) => {
  const kept = (await Bun.file(log).text()).split("\n").filter((line) => {
    try {
      const { pr, sha } = JSON.parse(line) as { pr?: unknown; sha?: unknown }
      return !(pr === n && sha === head)
    } catch {
      return true
    }
  })
  await replace(log, kept.join("\n"))
}

// Takes back the go at head: removes the label first, since go.py relaunches a PR that carries it with a go at its head, then the log lines, then goAt; it signals no process itself: go.py stops the Checks run it started within a cycle, and whoever started a run by hand stops it.
const takeBackGo = async (run: Run, options: GoOptions, view: View): Promise<GoOutcome> => {
  const { log, n, queue, repo } = options
  const head = view.headRefOid
  if (!(await logged(log, n, head))) {
    return { lines: [`Refused: #${n} has no go at ${sha7(head)} to take back`], ok: false }
  }
  const lines: string[] = []
  if (view.labels.some((label) => label.name === GATE_LABEL)) {
    await gh(run, ["pr", "edit", String(n), "-R", repo, "--remove-label", GATE_LABEL])
    lines.push(`#${n} ${GATE_LABEL} removed`)
  } else {
    lines.push(`#${n} did not carry ${GATE_LABEL}`)
  }
  await dropGo(log, n, head)
  lines.push(`go taken back: #${n} at ${sha7(head)}`)
  lines.push(
    (await stampQueue(queue, n, undefined))
      ? `merge queue: #${n} goAt cleared`
      : `#${n} is not in the merge queue: no goAt to clear`,
  )
  lines.push(
    `the label is off: go.py stops the Checks run it started for #${n} within a cycle, and whoever started a run by hand stops it`,
  )
  return { lines, ok: true }
}

// A lead's ci:go for PR n at one head: refuses unless the repo's owner or the outside author it names opened it, it is open and its head starts with sha, then labels it Cloud CI in place of any Local CI, logs the go, stamps its goAt in the merge queue and prints the conflicts pr:train forecast predicts for it; a second go at the same head adds nothing twice. It starts no local CI lane: the label starts GitHub Actions' gate jobs, whose result ops-checks-go posts as the head's stamp.
export const ciGo = async (run: Run, options: GoOptions): Promise<GoOutcome> => {
  const { by, forecast, log, n, now, outsideAuthor, queue, repo, sha, takeBack } = options
  const refuse = (line: string): GoOutcome => ({ lines: [`Refused: ${line}`], ok: false })
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return refuse(`${sha} is not a sha of 7 to 40 hex characters`)
  const view = JSON.parse(
    await gh(run, [
      "pr",
      "view",
      String(n),
      "-R",
      repo,
      "--json",
      "author,headRefOid,labels,state",
    ]),
  ) as View
  const owner = repo.split("/")[0]
  const author = view.author.login
  const login = author.toLowerCase()
  if (login !== owner.toLowerCase() && login !== outsideAuthor?.toLowerCase()) {
    return refuse(
      `#${n} was opened by ${author}, not ${owner}: local CI runs an outside PR only on a go with --outside-author ${author}`,
    )
  }
  if (view.state !== "OPEN") return refuse(`#${n} is ${view.state.toLowerCase()}, not open`)
  if (!view.headRefOid.startsWith(sha)) {
    return refuse(
      `#${n}'s head is ${sha7(view.headRefOid)}, not ${sha}: a moved head needs a new go`,
    )
  }
  const head = view.headRefOid
  if (takeBack) return takeBackGo(run, options, view)
  const lines: string[] = []
  const has = (name: string) => view.labels.some((label) => label.name === name)
  const edit = [
    ...(has(GATE_LABEL) ? [] : ["--add-label", GATE_LABEL]),
    ...(has(LOCAL_LABEL) ? ["--remove-label", LOCAL_LABEL] : []),
  ]
  if (edit.length) await gh(run, ["pr", "edit", String(n), "-R", repo, ...edit])
  lines.push(
    has(GATE_LABEL) ? `#${n} already carries ${GATE_LABEL}` : `#${n} labelled ${GATE_LABEL}`,
  )
  if (has(LOCAL_LABEL)) lines.push(`#${n} ${LOCAL_LABEL} removed`)
  if (await logged(log, n, head)) {
    lines.push(`#${n} already has a go at ${sha7(head)}: nothing logged or stamped again`)
    return { lines: [...lines, ...(await predicted(forecast, n))], ok: true }
  }
  const at = now().toISOString()
  await mkdir(dirname(log), { recursive: true })
  await appendFile(log, `${JSON.stringify({ at, by, pr: n, sha: head })}\n`)
  lines.push(`go logged: #${n} at ${sha7(head)} by ${by}`)
  lines.push(
    (await stampQueue(queue, n, at))
      ? `merge queue: #${n} goAt ${at}`
      : `#${n} is not in the merge queue: no goAt stamped`,
  )
  return { lines: [...lines, ...(await predicted(forecast, n))], ok: true }
}

// pr:train forecast's predicted conflicts for PR n, each with the PR ahead and the files, so the worker merges that PR's branch, or canary once it lands, before its last round; none when clean, and a forecast that cannot run says so without failing the go.
const predicted = async (forecast: () => Promise<Drop[]>, n: number): Promise<string[]> => {
  try {
    return (await forecast())
      .filter((drop) => drop.n === n)
      .map(
        (drop) =>
          `forecast: #${n} ${drop.why}: merge ${drop.with}'s branch, or canary once it lands, before the last round`,
      )
  } catch (error) {
    return [`forecast could not run: ${error instanceof Error ? error.message : String(error)}`]
  }
}
