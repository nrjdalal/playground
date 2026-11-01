#!/usr/bin/env bun
// The roster's one writer, ported from ~/.playground/roster.py: atomic writes, times from the UTC clock, titles cut to 40 characters.
import { join } from "node:path"

import {
  dispatcherOf,
  isManagerKind,
  isRosterKind,
  kindOf,
  kindOfName,
  MANAGER_KINDS,
  managerOf,
  ROSTER_KINDS,
  ROSTER_ROLE_OF_KIND,
  slotOfName,
} from "../packages/config/src/kinds"
import { dataDir } from "../packages/env/src/data-dir"
import { factoryRepoOf, loadSessionNames } from "../packages/scripts/src/playground/setting"
import { writeAtomic } from "../packages/scripts/src/write-atomic"
import STATUSES from "./roster-statuses.json"

export const USAGE = `Usage:
  roster.ts set <name> key=value [key=value ...]    (creates the agent if missing, its role from kind= or its name; a new one needs task=)
  roster.ts report <name> <text> [key=value ...]    (sets lastReport, stamps lastReportAt; a new one needs task=)
  roster.ts assign <name> <title> <task> [k=v ...]  (new task, or a checker's next PR with worker= pr=; clears pr/branch/repo/lastReport)
  roster.ts backlog <text>
  roster.ts backlog-done <index> <issue>            (marks the 0-based entry filed: "[#<issue>] <text>")
  roster.ts backfill                                (gives each entry with no kind the one its name's prefix gives)
  roster.ts who <kind>                              (prints the name holding a manager kind's seat; writes nothing)
  roster.ts who dispatcher [1|2]                    (prints the dispatcher in slot 1, Alpha, by default, or 2, Bravo; writes nothing)
Times always come from the UTC clock; titles are capped at 40 chars.`

type Agent = Record<string, unknown> & { name: string }
type Roster = { agents: Agent[]; backlog?: string[]; updatedAt?: string }

class Refusal extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
  }
}

// In the data folder spawn.sh reads it from, PLAYGROUND_DATA_DIR's when set.
const path = join(dataDir(process.env), "roster.json")

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")

async function load(): Promise<Roster> {
  const file = Bun.file(path)
  if (!(await file.exists())) return { agents: [], backlog: [] }
  return (await file.json()) as Roster
}

// The title cut keeps whole characters and fits the reader's 40.
const titled = (value: string): string => {
  let out = ""
  for (const ch of value.replace(/\s*\(?#\d+\)?\s*$/, "")) {
    if (out.length + ch.length > 40) break
    out += ch
  }
  return out
}

const pairsOf = (args: string[]): [string, string][] =>
  args.map((kv) => {
    const at = kv.indexOf("=")
    return at === -1 ? [kv, ""] : [kv.slice(0, at), kv.slice(at + 1)]
  })

// A new agent names its task, since the dashboard's schema drops an agent with none; assign gives it as a word.
function agent(roster: Roster, name: string, pairs: [string, string][], task?: string): Agent {
  const found = roster.agents.find((a) => a.name === name)
  if (found) return found
  if (!(task ?? pairs.find(([k]) => k === "task")?.[1])?.trim()) {
    const fix =
      task === undefined ? "add task=<what it does>" : "give what it does as assign's <task> word"
    throw new Refusal(
      `roster.ts: ${name} is not on the roster yet, and the dashboard drops an agent with no task: ${fix}`,
      1,
    )
  }
  const given = pairs.find(([k]) => k === "kind")?.[1]
  const kind = kindOf(name, given)
  const role = kind ? ROSTER_ROLE_OF_KIND[kind] : slotOfName(name) !== null ? "manager" : "worker"
  const fresh: Agent = { name, role, status: "starting", task: "", title: "" }
  if (kind) fresh.kind = kind
  roster.agents.push(fresh)
  return fresh
}

// The dashboard's schema (api/hono/src/lib/dashboard/roster.ts) and code-review-loop's scan hold a PR by its full URL alone.
const PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

const prUrl = (raw: string, repo: string): string => {
  const n = /^#?([1-9]\d*)$/.exec(raw)?.[1]
  const url = n ? `https://github.com/${repo}/pull/${n}` : raw
  if (PR_URL_RE.test(url)) return url
  throw new Refusal(
    `roster.ts: pr takes https://github.com/<owner>/<name>/pull/<n>, or its number alone, not ${raw}`,
    2,
  )
}

function apply(entry: Agent, pairs: [string, string][], factoryRepo: string): void {
  const given = pairs.find(([k]) => k === "repo")
  const repo = (given ? given[1] : (entry.repo as string | undefined)) || factoryRepo
  for (const [k, raw] of pairs) {
    const v = k === "title" ? titled(raw) : k === "pr" && raw !== "" ? prUrl(raw, repo) : raw
    if (v === "") delete entry[k]
    else entry[k] = v
  }
}

// A session name is spawn.sh's word shape, lowercase words joined by hyphens: a shell loop once passed a whole sentence as a name and roster.ts made three agents of it.
function checkName(cmd: string, name: string): void {
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return
  throw new Refusal(
    `roster.ts: ${cmd} takes a name of lowercase words joined by hyphens, like spawn.sh's, not "${name}"`,
    2,
  )
}

function checkKind(pairs: [string, string][]): void {
  const kind = pairs.find(([k]) => k === "kind")?.[1]
  if (kind && !isRosterKind(kind))
    throw new Refusal(`roster.ts: kind takes one of ${ROSTER_KINDS.join(", ")}, not ${kind}`, 2)
}

// A status is one word from roster-statuses.json, which ops-report reads too, so its finished check knows every ended session.
const STATUS_WORDS: string[] = [...STATUSES.live, ...STATUSES.finished]

function checkStatus(name: string, pairs: [string, string][]): void {
  const status = pairs.find(([k, v]) => k === "status" && !STATUS_WORDS.includes(v))
  if (status)
    throw new Refusal(
      `roster.ts: status takes one of ${STATUS_WORDS.join(", ")}, not "${status[1]}": progress text goes in roster.ts report ${name} "<text>"`,
      2,
    )
}

// An ETA is a future UTC time as `date -u +%FT%TZ` prints one: a worker once sent the literal placeholder <ETA>. An empty eta= clears it, and every eta= given is read, since the last one wins.
function checkEta(pairs: [string, string][]): void {
  for (const [k, eta] of pairs) {
    if (k !== "eta" || eta === "") continue
    const at = Date.parse(eta)
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(eta) &&
      at > Date.now() &&
      new Date(at).toISOString().startsWith(eta.slice(0, 19))
    )
      continue
    throw new Refusal(
      `roster.ts: eta takes a future UTC time, not ${eta}: an ETA is \`date -u\` plus your estimate, in UTC (date -u +%FT%TZ reads ${now()} now)`,
      2,
    )
  }
}

// Every key=value check set, report and assign share.
function checkPairs(name: string, pairs: [string, string][]): void {
  checkKind(pairs)
  checkStatus(name, pairs)
  checkEta(pairs)
}

// A checker moved by halves keeps its old worker or pr, and the sidebar nests it under that worker's ended row.
function checkRetask(
  entry: Agent,
  pairs: [string, string][],
  factoryRepo: string,
  assign = false,
): void {
  const next: Agent = { ...entry }
  apply(next, pairs, factoryRepo)
  if (!["reviewer", "tester"].includes(kindOf(next.name, next.kind) ?? "")) return
  const moved = (k: string) => entry[k] !== undefined && next[k] !== entry[k]
  const given = (k: string) => pairs.some(([p]) => p === k)
  if (assign ? entry.pr && given("pr") !== given("worker") : moved("pr") || moved("worker"))
    throw new Refusal(
      `roster.ts: ${entry.name} is a checker, so it moves to another PR through roster.ts assign ${entry.name} <title> <task> worker=<worker> pr=<url> [repo=<owner>/<name>], which sets its worker, pr, repo and title together`,
      1,
    )
}

async function main(argv: string[]): Promise<void> {
  const [cmd, name, ...rest] = argv
  const known = ["assign", "backfill", "backlog", "backlog-done", "report", "set", "who"]
  if (!cmd || !known.includes(cmd) || (cmd !== "backfill" && !name)) throw new Refusal(USAGE, 2)
  if (cmd === "set" || cmd === "report" || cmd === "assign") checkName(cmd, name!)
  if (cmd === "who") {
    // the dispatcher takes a slot number, 1 (Alpha, the default) or 2 (Bravo), never a label, since labels can be renamed
    const slot = name === "dispatcher" && rest.length <= 1 ? (rest[0] ?? "1") : null
    if (!(isManagerKind(name) && rest.length === 0) && slot !== "1" && slot !== "2")
      throw new Refusal(
        `roster.ts: who takes one of ${[...MANAGER_KINDS, "dispatcher [1|2]"].join(", ")}`,
        2,
      )
    // A roster that does not read leaves today's name, so a spawn still has someone to report to.
    const agents = (await load().catch(() => null))?.agents
    console.log(
      isManagerKind(name) ? managerOf(agents, name) : dispatcherOf(agents, slot === "2" ? 2 : 1),
    )
    return
  }
  const roster = await load()
  // A bare PR number links into factory.repo, read only when one is given.
  const factoryRepo = rest.some((word) => /^pr=#?[1-9]\d*$/.test(word))
    ? await factoryRepoOf().catch((error: Error) => {
        throw new Refusal(`roster.ts: ${error.message}`, 2)
      })
    : ""
  if (cmd === "set") {
    const pairs = pairsOf(rest)
    checkPairs(name!, pairs)
    const entry = agent(roster, name!, pairs)
    checkRetask(entry, pairs, factoryRepo)
    // A new task on an agent holding a pr would show the old PR beside it, so it goes through assign; a title alone renames the row.
    if (entry.pr && pairs.some(([k]) => k === "task"))
      throw new Refusal(
        `roster.ts: ${name} holds a pr, so a new task goes through roster.ts assign ${name} <title> <task>, which clears pr, branch, repo and lastReport`,
        1,
      )
    apply(entry, pairs, factoryRepo)
  } else if (cmd === "report") {
    const [text, ...more] = rest
    if (text === undefined) throw new Refusal(USAGE, 2)
    const pairs = pairsOf(more)
    checkPairs(name!, pairs)
    const entry = agent(roster, name!, pairs)
    checkRetask(entry, pairs, factoryRepo)
    entry.lastReport = text
    entry.lastReportAt = now()
    apply(entry, pairs, factoryRepo)
  } else if (cmd === "assign") {
    const [title, task, ...more] = rest
    if (title === undefined || task === undefined) throw new Refusal(USAGE, 2)
    const pairs = pairsOf(more)
    checkPairs(name!, pairs)
    const entry = agent(roster, name!, pairs, task)
    checkRetask(entry, pairs, factoryRepo, true)
    for (const k of ["pr", "branch", "repo", "lastReport", "lastReportAt", "eta", "ticket"])
      delete entry[k]
    Object.assign(entry, { status: "working", task })
    apply(entry, [["title", title], ...pairs], factoryRepo)
  } else if (cmd === "backlog") {
    if (rest.length > 0) throw new Refusal('usage: roster.ts backlog "<text>"', 2)
    roster.backlog = [...(roster.backlog ?? []), name!]
  } else if (cmd === "backlog-done") {
    const backlog = roster.backlog ?? []
    const [issue, ...extra] = rest
    const at = Number(name)
    if (!issue || !/^[1-9]\d*$/.test(issue))
      throw new Refusal(
        `roster.ts: backlog-done takes a positive issue number${issue ? `, not ${issue}` : ""}`,
        2,
      )
    if (extra.length > 0)
      throw new Refusal(
        `roster.ts: backlog-done takes one issue number, not also ${extra.join(" ")}`,
        2,
      )
    if (backlog.length === 0)
      throw new Refusal("roster.ts: backlog-done finds the backlog empty", 1)
    if (!/^(0|[1-9]\d*)$/.test(name!) || at >= backlog.length)
      throw new Refusal(
        `roster.ts: backlog-done takes an index from 0 to ${backlog.length - 1}, not ${name}`,
        2,
      )
    if (/^\[#[1-9]\d*\] /.test(backlog[at]!))
      throw new Refusal(`roster.ts: backlog entry ${at} is already marked: ${backlog[at]}`, 1)
    backlog[at] = `[#${issue}] ${backlog[at]}`
  } else {
    for (const entry of roster.agents) {
      const kind = kindOfName(entry.name)
      if (entry.kind === undefined && kind) entry.kind = kind
    }
  }
  roster.updatedAt = now()
  await writeAtomic(path, JSON.stringify(roster, null, 2))
}

if (import.meta.main) {
  try {
    loadSessionNames()
    await main(process.argv.slice(2))
  } catch (err) {
    if (!(err instanceof Refusal)) throw err
    console.error(err.message)
    process.exit(err.code)
  }
}
