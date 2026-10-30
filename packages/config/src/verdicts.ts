// The verdicts a Playground PR's gates read, in one module pr:merge and the Dashboard both import, so a format change or a stricter reading cannot leave one reader behind. Every gate comment is posted as the repo's owner. Two kinds: the reviewer's score, and the stamp, the one YAML block every tester posts (Checks, GitHub's jobs, the tester, the reviewer's look and the train): stampText renders it and verdictOf parses it, here alone, so every other reader takes the parsed object.

export type GateName = "review" | "stamp"

export const STAMP_STATUSES = ["green", "red", "wait"] as const
export type StampStatus = (typeof STAMP_STATUSES)[number]

export const CHECK_STATUSES = ["fail", "pass", "skip"] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

// The check names the merge gates and the dashboard read, every check an agent makes prefixed agent-: the tester's agent-drive for web/next/, the reviewer's agent-review of a merge that is not clean, Checks' verify for dashboard code and a train step's train; checks.py names the same.
export const CHECKS = {
  drive: "agent-drive",
  review: "agent-review",
  train: "train",
  verify: "verify",
} as const

// GitHub's gate jobs, by name, with the checks each runs.
export const JOB_CHECKS: Record<string, string[]> = {
  "Audit, Lint, and Build": ["audit", "build", "check-types", "format:check", "lint", "test"],
  test: ["test:skills"],
}

// One check a stamp ran: source is where it ran, a GitHub run id, local (Checks on the Mac or the box, the only place verify's browser check runs) or agent (an agent's own judgement); comment, when given, says why.
export type StampCheck = { comment?: string; source: string; status: CheckStatus }

// A stamp's keys, every one but remark always present: commit is the sha7 it names; remark, when given, is one sentence of at most COMMENT_WORDS words, as each check's comment is.
export type StampKeys = {
  checks: Record<string, StampCheck>
  commit: string
  remark?: string
  status: StampStatus
}

// Pure: whether a check's source is one a stamp takes: a GitHub run id, local or agent.
export const isSource = (source: string): boolean => /^(\d+|agent|local)$/.test(source)

// Pure: a stamp's sources in one line, for a gate's detail: each source its checks name, or no checks.
export const sourcesOf = (stamp: StampKeys): string =>
  [...new Set(Object.values(stamp.checks).map((check) => check.source))].sort().join(", ") ||
  "no checks"

export const COMMENT_WORDS = 20

// Pure: why a comment or remark cannot go in a stamp, or null: empty, more than COMMENT_WORDS words, or a line break.
const badComment = (comment: string | undefined): string | null =>
  comment === undefined
    ? null
    : !comment.trim() || comment.trim().split(/\s+/).length > COMMENT_WORDS || /\n/.test(comment)
      ? `a comment or remark is one line of 1 to ${COMMENT_WORDS} words: "${comment}"`
      : null

// Pure: why a check cannot stand, or null: a name that is not one word, a source that is not a GitHub run id, local or agent, an agent- check from anywhere but agent or any other check from agent, or a bad comment.
const badCheck = (name: string, check: StampCheck): string | null =>
  !WORD.test(name) || !isSource(check.source)
    ? `a check's name is one word and its source a GitHub run id, local or agent: ${name}, ${check.source}`
    : name.startsWith("agent-") !== (check.source === "agent")
      ? `an agent- check, and only one, has source agent: ${name}, ${check.source}`
      : badComment(check.comment)

// Pure: the comment a stamp is posted as, a YAML block; it throws on a comment or remark that is empty, over COMMENT_WORDS words or holds a line break, a check name that is not one word, or a source out of its list.
export function stampText({ checks, commit, remark, status }: StampKeys): string {
  const names = Object.keys(checks).sort()
  const why =
    badComment(remark) ??
    names.map((name) => badCheck(name, checks[name] as StampCheck)).find(Boolean)
  if (why) throw new Error(why)
  const said = (key: string, text: string | undefined, indent: string) =>
    text === undefined ? [] : [`${indent}${key}: ${text.trim()}`]
  return [
    "```yaml",
    `status: ${status}`,
    `commit: ${commit.slice(0, 7)}`,
    names.length === 0 ? "checks: {}" : "checks:",
    ...names.flatMap((name) => [
      `  ${name}:`,
      `    status: ${checks[name]?.status}`,
      `    source: ${checks[name]?.source}`,
      ...said("comment", checks[name]?.comment, "    "),
    ]),
    ...said("remark", remark, ""),
    "```",
  ].join("\n")
}

// round and score: a review's; the stamp's keys: a stamp's, pass being status green.
export type Verdict = {
  at: string
  createdAt?: string
  gate: GateName
  pass: boolean
  round?: number
  score?: number
  stamp?: StampKeys
  text: string
  url?: string
}

const WORD = /^[A-Za-z0-9][\w.:/-]*$/

// ## ReviewBot · round 2: 5/5 at 69a6a4c · 0 blocking, ...
const REVIEW = /^##\s*ReviewBot\s*·\s*round\s+(\d+):\s*(\d)\/5\s+at\s+([0-9a-f]{7,40})/i

const isOf = <T extends string>(list: readonly T[], value: string | undefined): value is T =>
  list.includes(value as T)

// Pure: the stamp a comment's YAML block holds, exactly as stampText writes it, or null: a missing or extra key (an older stamp's runner, run or note among them), a value out of its list, a bad comment, or any other line.
function stampFrom(lines: string[]): StampKeys | null {
  if (lines[0]?.trim() !== "```yaml") return null
  const end = lines.indexOf("```", 1)
  if (end === -1) return null
  const body = lines.slice(1, end)
  const top = (key: string, at: number) =>
    body[at]?.startsWith(`${key}: `) ? body[at]?.slice(key.length + 2) : undefined
  const [status, commit] = [top("status", 0), top("commit", 1)]
  if (!isOf(STAMP_STATUSES, status) || !/^[0-9a-f]{7}$/.test(commit ?? "")) return null
  const checks: Record<string, StampCheck> = {}
  let at = 2
  if (body[at] === "checks: {}") at++
  else if (body[at] === "checks:") {
    at++
    while (/^ {2}\S/.test(body[at] ?? "")) {
      const name = /^ {2}(\S+):$/.exec(body[at] ?? "")?.[1]
      const check = /^ {4}status: (\w+)$/.exec(body[at + 1] ?? "")?.[1]
      const source = /^ {4}source: (\S+)$/.exec(body[at + 2] ?? "")?.[1]
      if (!name || !isOf(CHECK_STATUSES, check) || !source || name in checks) return null
      const said = /^ {4}comment: (.+)$/.exec(body[at + 3] ?? "")?.[1]
      checks[name] =
        said === undefined ? { source, status: check } : { comment: said, source, status: check }
      if (badCheck(name, checks[name] as StampCheck)) return null
      at += said === undefined ? 3 : 4
    }
  } else return null
  const remark = top("remark", at)
  if (badComment(remark) || at + (remark === undefined ? 0 : 1) !== body.length) return null
  const keys: StampKeys = { checks, commit: commit as string, status }
  return remark === undefined ? keys : { ...keys, remark }
}

// Pure: the verdict a comment carries, a review from its first line or a stamp from its YAML block, null for any other comment, a malformed stamp included.
export function verdictOf(body: string): Verdict | null {
  const lines = body
    .trimStart()
    .split("\n")
    .map((line) => line.trimEnd())
  const line = lines[0]?.trim() ?? ""
  const review = REVIEW.exec(line)
  if (review) {
    const [, round, score, at = ""] = review
    return {
      at: at.toLowerCase(),
      gate: "review",
      pass: score === "5",
      round: Number(round),
      score: Number(score),
      text: line,
    }
  }
  const stamp = stampFrom(lines)
  if (!stamp) return null
  return {
    at: stamp.commit,
    gate: "stamp",
    pass: stamp.status === "green",
    stamp,
    text: `${stamp.status} @ ${stamp.commit} · ${sourcesOf(stamp)}`,
  }
}

// Pure: the verdicts a comment carries, none or one.
export const verdictsOf = (body: string): Verdict[] => {
  const verdict = verdictOf(body)
  return verdict ? [verdict] : []
}

// A verdict's sha names the head when it is a prefix of it (a sha7 or the whole sha).
export const atHead = (at: string, head: string): boolean =>
  at.length >= 7 && head.toLowerCase().startsWith(at.toLowerCase())
