// The trace ratchet: counts each kind of private trace (kinds.ts) over the tree, past every live name the switch's migration moves (LIVE_NAMES, its allowlist, piece 21's reason) and past the paths the seed leaves out, so a check fails when any count rises above counts.json and each trace-out lowers it.
import { existsSync } from "node:fs"
import { join } from "node:path"

import { LIVE_NAMES } from "../rename/rules"
import { UPSTREAM_SKILLS } from "../vendor-upstream/stage"
import {
  EMPTY_LIST,
  isPublicList,
  type Kind,
  LIST_KEYS,
  patterns,
  type PublicList,
  readPast,
  type Repos,
  UNSET_REPOS,
} from "./kinds"

export type Counts = Partial<Record<Kind, number>>
export type File = { path: string; text: string }

export const COUNTS = join(import.meta.dir, "counts.json")
export const KEPT = join(import.meta.dir, "kept.json")

// A hit kept on purpose: the line, trimmed, that holds it in its file, how many of its kind that line holds, how many identical lines carry it (copies, 1 when absent), and why it stays.
export type Kept = {
  copies?: number
  hits: number
  kind: Kind
  line: string
  path: string
  reason: string
}

// Left out of the seed, so never counted: these counts and the kept hits, whose lines hold the hits they keep, the files that define the old names, and core's upstream skills, whose text is upstream's.
export const LEFT_OUT = [
  /^packages\/scripts\/src\/rename\/rules\.ts$/,
  /^packages\/scripts\/src\/trace-count\/counts\.json$/,
  /^packages\/scripts\/src\/trace-count\/kept\.json$/,
  /^packages\/scripts\/src\/trace-count\/kinds\.ts$/,
  new RegExp(`^extensions/core/(upstream|skills/(${UPSTREAM_SKILLS.join("|")}))/`),
]

// In the seed but never counted, nor swapped: a lockfile, whose integrity hashes can spell a list value by chance and break the install when rewritten.
export const LOCKFILES = [/(?:^|\/)bun\.lock$/, /(?:^|\/)package-lock\.json$/]

// Left out of one kind alone: the dashboard's and the Changelog's fixtures and the recorded replays mimic real data, so their PR numbers are no provenance, and a test's issue numbers are its own made-up data.
const LEFT_OUT_OF: Partial<Record<Kind, RegExp[]>> = {
  issueRefs: [
    /^api\/hono\/src\/fixtures\/dashboard\.json$/,
    /^api\/hono\/src\/plugins\/changelog\/fixture\.ts$/,
    /^packages\/scripts\/src\/parity\/replay\/fixtures\//,
    /^tests\//,
  ],
}

const LIVE = new RegExp(LIVE_NAMES.join("|"), "g")

// No person's address, so no trace: a domain reserved for examples (RFC 2606 and 6761) or the fixtures' local.host, an ssh remote's git user, and a package's version.
const NOT_A_PERSON = [
  /@(?:[a-z\d-]+\.)*(?:example\.(?:com|net|org)|example|test|invalid|localhost|local\.host)$/i,
  /^git@/,
  /@\d+\.\d+/,
]

// Each kind's hits in one file's text, past the live names, the read-past repositories and the kinds its path is left out of.
const hitsIn = (path: string, text: string, kinds: [Kind, RegExp][], repos: Repos): Counts => {
  const said = readPast(text.replace(LIVE, ""), repos)
  const hits: Counts = {}
  for (const [kind, re] of kinds) {
    if (LEFT_OUT_OF[kind]?.some((out) => out.test(path))) continue
    hits[kind] = (said.match(re) ?? []).filter(
      (hit) => kind !== "emails" || !NOT_A_PERSON.some((re) => re.test(hit)),
    ).length
  }
  return hits
}

// Why a kept entry no longer stands in its file, or nothing when its one line still holds its hits.
const keptMiss = (
  entry: Kept,
  file: File | undefined,
  kinds: [Kind, RegExp][],
  repos: Repos,
): string | undefined => {
  if (!file) return "its file is gone"
  if ([...LEFT_OUT, ...LOCKFILES].some((re) => re.test(entry.path)))
    return "its file is never counted"
  const copies = entry.copies ?? 1
  const lines = file.text.split("\n").filter((line) => line.trim() === entry.line)
  if (lines.length === 0) return "no line reads as its text"
  if (lines.length !== copies)
    return `${lines.length} ${lines.length === 1 ? "line reads" : "lines read"} as its text, not ${copies}, so set its copies or give it a longer one`
  const held = hitsIn(entry.path, lines[0]!, kinds, repos)[entry.kind] ?? 0
  if (held < entry.hits) return `its line holds ${held} ${entry.kind}, not ${entry.hits}`
}

// Every kind with a pattern gets a count, 0 included, so a kind a run could not measure (an empty list) is absent rather than read as gone; each kept entry that still stands takes its hits off.
export function count(
  files: File[],
  list: PublicList = EMPTY_LIST,
  repos: Repos = UNSET_REPOS,
  kept: Kept[] = [],
): Counts {
  const kinds = patterns(list, repos)
  const counts: Counts = Object.fromEntries(kinds.map(([kind]) => [kind, 0]))
  const byPath = new Map(files.map((file) => [file.path, file]))
  for (const { path, text } of files) {
    if ([...LEFT_OUT, ...LOCKFILES].some((re) => re.test(path))) continue
    for (const [kind, n] of Object.entries(hitsIn(path, text, kinds, repos)))
      counts[kind as Kind]! += n!
  }
  for (const entry of kept)
    if (counts[entry.kind] !== undefined && !keptMiss(entry, byPath.get(entry.path), kinds, repos))
      counts[entry.kind]! -= entry.hits * (entry.copies ?? 1)
  return counts
}

// Each kept entry that no longer stands, by its path and line, so the commit that clears its hit drops it too.
export function stale(
  files: File[],
  kept: Kept[],
  list: PublicList = EMPTY_LIST,
  repos: Repos = UNSET_REPOS,
): string[] {
  const kinds = patterns(list, repos)
  const byPath = new Map(files.map((file) => [file.path, file]))
  return kept.flatMap((entry) => {
    if (!kinds.some(([kind]) => kind === entry.kind)) return []
    const miss = keptMiss(entry, byPath.get(entry.path), kinds, repos)
    return miss ? [`${entry.path}: "${entry.line}" (${entry.kind}): ${miss}`] : []
  })
}

// Each measured kind whose count is over its baseline, or has none yet.
export const risen = (now: Counts, baseline: Counts): string[] =>
  Object.entries(now).flatMap(([kind, n]) => {
    const was = baseline[kind as Kind]
    if (was !== undefined && n <= was) return []
    return [
      `${kind}: ${n} in the tree, counts.json allows ${was ?? "none, since it has no count yet"}`,
    ]
  })

// The refusal for the risen lines, naming the fix where a kind has one.
export const refusal = (over: string[]): string =>
  `trace-count: a count rose; write the new text in plain words${over.some((line) => line.startsWith("issueRefs:")) ? "; describe the case in words; a doc cites no issue number" : ""}:\n${over.join("\n")}`

// The baseline with each measured kind lowered to its count; a kind this run did not measure keeps its count.
export const lowered = (now: Counts, baseline: Counts): Counts =>
  Object.fromEntries(
    [...new Set([...Object.keys(baseline), ...Object.keys(now)])]
      .sort()
      .map((kind) => [
        kind,
        Math.min(baseline[kind as Kind] ?? Infinity, now[kind as Kind] ?? Infinity),
      ]),
  )

const SKIPPED = /(?:^|\/)(?:\.git|\.next|\.turbo|coverage|dist|node_modules)\//

// The tree's text files: git's tracked and untracked ones where a .git is, else every file but build output and installs (the runner box's copy, which holds no ignored file).
export async function tree(root: string): Promise<File[]> {
  const listed = existsSync(join(root, ".git"))
    ? Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: root,
      })
    : undefined
  const paths =
    listed?.exitCode === 0
      ? listed.stdout.toString().split("\0").filter(Boolean)
      : [...new Bun.Glob("**/*").scanSync({ cwd: root, dot: true })].filter((p) => !SKIPPED.test(p))
  const files: File[] = []
  for (const path of paths) {
    const file = Bun.file(join(root, path))
    if (!(await file.exists())) continue
    const bytes = await file.bytes()
    if (!bytes.includes(0)) files.push({ path, text: new TextDecoder().decode(bytes) })
  }
  return files
}

// No-public-leak's list, or the refusal for one the count cannot trust: a missing file or a key with no entry leaves its kinds with no pattern, so they would count nothing and a trace would pass unseen.
export async function list(path: string): Promise<{ list: PublicList } | { refusal: string }> {
  const fix = `ask Ops for the owner to type ! playground ext put <scope> list no-public-leak <file> --reason <why> in Ops' pane, every key (${LIST_KEYS.join(", ")}) holding an entry`
  if (!existsSync(path)) return { refusal: `no ${path}, so its kinds would count nothing: ${fix}` }
  const value: unknown = await Bun.file(path)
    .json()
    .catch(() => undefined)
  if (!isPublicList(value)) return { refusal: `${path} is not no-public-leak's list: ${fix}` }
  const empty = LIST_KEYS.filter((key) => value[key].length === 0)
  if (empty.length > 0)
    return {
      refusal: `${path} has no ${empty.join(", ")}, so those kinds would count nothing: ${fix}`,
    }
  return { list: value }
}
