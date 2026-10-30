// The lines canary added that a merge of canary into the PR dropped from git's own merge of the two in a file that merges without a conflict, and that the squash onto canary still lacks: a merge with -s ours drops them while every other gate reads green, since canary is then an ancestor of the head.

import type { Run } from "./merge"

// One line a diff removes, by its path and line number on the old side.
export type Removed = { content: string; line: number; path: string }
// One -U0 hunk: the lines it removes, then the lines it adds in their place.
export type Hunk = { added: string[]; removed: Removed[] }
// A line the squash would lose, with the PR's merge commit that dropped it and its line in git's own merge.
export type LostLine = { commit: string; line: number; path: string }
// The lines lost, or why they could not be read.
export type Lost = LostLine[] | string

// A removed line this close to a line its hunk adds is a rewrite, not a loss (a ratio of 2 x their longest common subsequence over their lengths).
export const REWRITE_RATIO = 0.8
// Past this many characters a line is compared word by word (a doc paragraph is one line of thousands), and past RATIO_WORDS words by its common start and end, since the ratio's cost grows with the product of the lengths.
const RATIO_CHARS = 400
const RATIO_WORDS = 5000

// A user's diff.noprefix or diff.mnemonicPrefix would move the a/ the paths are read by, so the prefixes are named.
const DIFF_OPTIONS = [
  "--dst-prefix=b/",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "-M",
  "-U0",
]

const ESCAPES: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 }

// Pure: a diff's path, unquoted when git C-quotes it (a byte past ASCII as octal, a tab, a quote or a backslash in the name).
export function unquote(path: string): string {
  if (!(path.startsWith('"') && path.endsWith('"'))) return path
  const bytes: number[] = []
  const body = path.slice(1, -1)
  for (let k = 0; k < body.length; k++) {
    if (body[k] !== "\\") {
      bytes.push(...new TextEncoder().encode(body[k]))
      continue
    }
    const octal = /^[0-7]{3}/.exec(body.slice(k + 1))?.[0]
    if (octal) {
      bytes.push(Number.parseInt(octal, 8))
      k += 3
    } else bytes.push(ESCAPES[body[++k]] ?? body.charCodeAt(k))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// Pure: git diff -U0's hunks. A file's old path comes from its --- a/ line (less the tab git adds after a name holding a space), else its diff --git line (a rename with no edit has neither ---), never from +++, which is /dev/null for a deleted file.
export function hunksOf(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  let path = ""
  let hunk: Hunk | undefined
  let line = 0
  for (const text of diff.split("\n")) {
    if (text.startsWith("diff --git ")) {
      hunk = undefined
      path = unquote(/^diff --git (".*?"|.+?) "?b\//.exec(text)?.[1] ?? "").replace(/^a\//, "")
    } else if (!hunk && text.startsWith("--- ")) {
      const old = unquote(text.slice(4).replace(/\t$/, ""))
      if (old !== "/dev/null") path = old.replace(/^a\//, "")
    } else if (text.startsWith("@@ ")) {
      line = Number(/^@@ -(\d+)/.exec(text)?.[1] ?? 0)
      hunk = { added: [], removed: [] }
      hunks.push(hunk)
    } else if (hunk && text.startsWith("-")) {
      hunk.removed.push({ content: text.slice(1), line: line++, path })
    } else if (hunk && text.startsWith("+")) hunk.added.push(text.slice(1))
  }
  return hunks
}

// Pure: 2 x the longest common subsequence of two sequences over their lengths.
function ratio<T>(a: T[], b: T[]): number {
  if (a.length + b.length === 0) return 1
  let prev = Array.from({ length: b.length + 1 }, () => 0)
  for (const x of a) {
    const next = Array.from({ length: b.length + 1 }, () => 0)
    for (let j = 0; j < b.length; j++) {
      next[j + 1] = x === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], next[j])
    }
    prev = next
  }
  return (2 * prev[b.length]) / (a.length + b.length)
}

// Pure: how alike two lines are, 1 for the same text.
export function likeness(a: string, b: string): number {
  if (a === b) return 1
  if (a.length <= RATIO_CHARS && b.length <= RATIO_CHARS) return ratio([...a], [...b])
  const wa = a.split(/\s+/)
  const wb = b.split(/\s+/)
  if (wa.length <= RATIO_WORDS && wb.length <= RATIO_WORDS) return ratio(wa, wb)
  let start = 0
  while (start < a.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end))
    end++
  return (2 * (start + end)) / (a.length + b.length)
}

// Two lines whose lengths alone keep them under REWRITE_RATIO are never compared, so a hunk of many long lines stays cheap.
const rewrites = (a: string, b: string): boolean =>
  (2 * Math.min(a.length, b.length)) / (a.length + b.length || 1) >= REWRITE_RATIO &&
  likeness(a, b) >= REWRITE_RATIO

// Pure: the lines a diff removes that it does not keep in another shape: every removed line but a blank one, a move (its text added anywhere in the diff) and a rewrite (a line its hunk adds is REWRITE_RATIO alike).
export function candidates(hunks: Hunk[]): Removed[] {
  const addedAnywhere = new Set(hunks.flatMap((h) => h.added.map((a) => a.trim())))
  return hunks.flatMap((hunk) =>
    hunk.removed.filter(
      (r) =>
        r.content.trim() !== "" &&
        !addedAnywhere.has(r.content.trim()) &&
        !hunk.added.some((a) => rewrites(r.content.trim(), a.trim())),
    ),
  )
}

// Pure: git merge-tree --write-tree --name-only -z's tree and the files it conflicts on.
export function mergeTreeOf(out: string): { conflicted: Set<string>; tree: string } {
  const parts = out.split("\0")
  const end = parts.indexOf("", 1)
  return {
    conflicted: new Set(parts.slice(1, end === -1 ? undefined : end)),
    tree: parts[0].trim(),
  }
}

// What each PR merge dropped from git's own merge of its parents, in the files git merges without a conflict (its author resolved a conflicted file by hand, and a resolution reworks the lines around it), of the lines its second parent holds and its first lacks, that canary still holds and the squash tree lacks. A git read that fails says why rather than passing.
export async function lostLines(
  git: Run,
  canary: string,
  head: string,
  squash: string | null,
): Promise<Lost> {
  if (!squash) return "the head conflicts with canary, so its squash cannot be read"
  const list = await git(["rev-list", "--merges", head, `^${canary}`])
  if (list.code !== 0) return `git rev-list exited ${list.code}`
  const lines = new Map<string, Set<string> | string>()
  const linesOf = async (rev: string, path: string): Promise<Set<string> | string> => {
    const key = `${rev}:${path}`
    const known = lines.get(key)
    if (known) return known
    const shown = await git(["cat-file", "-p", key])
    const read =
      shown.code === 0
        ? new Set(shown.stdout.split("\n").map((l) => l.trim()))
        : (await git(["cat-file", "-e", key])).code === 0
          ? `git cat-file ${/^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev}:${path} exited ${shown.code}`
          : new Set<string>()
    lines.set(key, read)
    return read
  }
  const lost: LostLine[] = []
  for (const merge of list.stdout.split("\n").filter(Boolean)) {
    const parents = await git(["rev-parse", `${merge}^1`, `${merge}^2`])
    if (parents.code !== 0) return `git rev-parse ${merge.slice(0, 7)} exited ${parents.code}`
    const [ours, theirs] = parents.stdout.trim().split("\n")
    const own = await git(["merge-tree", "--write-tree", "--name-only", "-z", ours, theirs])
    if (own.code > 1) return `git merge-tree ${merge.slice(0, 7)} exited ${own.code}`
    const { conflicted, tree } = mergeTreeOf(own.stdout)
    const diff = await git(["diff", ...DIFF_OPTIONS, tree, merge])
    if (diff.code !== 0) return `git diff ${merge.slice(0, 7)} exited ${diff.code}`
    for (const r of candidates(hunksOf(diff.stdout))) {
      if (conflicted.has(r.path)) continue
      const content = r.content.trim()
      const sides = await Promise.all(
        [theirs, ours, squash, canary].map((rev) => linesOf(rev, r.path)),
      )
      const why = sides.find((side) => typeof side === "string")
      if (why) return why
      const [inTheirs, inOurs, inSquash, inCanary] = sides as Set<string>[]
      if (
        inTheirs.has(content) &&
        !inOurs.has(content) &&
        !inSquash.has(content) &&
        inCanary.has(content)
      )
        lost.push({ commit: merge, line: r.line, path: r.path })
    }
  }
  return lost
}
