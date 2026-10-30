import type { ChangelogEntry } from "@api/hono"

// One part of the page: the changes main has not taken yet, or one version with the changes it carried.
export type VersionGroup = {
  entries: ChangelogEntry[]
  id: string
  release: ChangelogEntry | null
}

// A change belongs to the first version tagged at or after it, since a version takes all of canary when main takes it; one after the newest version is not shipped yet. Groups go newest first, Not shipped yet on top while it holds anything, each group's changes newest first.
export function byVersion(entries: ChangelogEntry[]): VersionGroup[] {
  const newestFirst = (a: ChangelogEntry, b: ChangelogEntry) => b.at.localeCompare(a.at)
  const releases = entries.filter((entry) => entry.kind === "release").sort(newestFirst)
  const groups: VersionGroup[] = [
    { entries: [], id: "unshipped", release: null },
    ...releases.map((release) => ({ entries: [], id: release.id, release })),
  ]
  const oldestFirst = [...releases].reverse()
  for (const entry of [...entries].sort(newestFirst)) {
    if (entry.kind === "release") continue
    const shippedIn = oldestFirst.find((release) => release.at >= entry.at)
    groups.find((group) => group.release === (shippedIn ?? null))!.entries.push(entry)
  }
  return groups.filter((group) => group.entries.length)
}

// A version's name from its release line ("Version v0.0.4 is out, with 6 changes." reads v0.0.4).
export const versionName = (release: ChangelogEntry): string =>
  release.text.match(/^Version (\S+) is out/)?.[1] ?? release.text

type Linked = Pick<ChangelogEntry, "id" | "link" | "sourceKey">

// An entry's name in a ?entry= link, one a person can read: `pr-253` for a merge, the tag (`v0.0.9`) for a version, `rule-<key>` and the like from its source key, else (a line added by hand, even one linking a PR) its id.
export function entrySlug(entry: Linked): string {
  if (!entry.sourceKey) return entry.id
  const pr = entry.link?.match(/\/pull\/(\d+)$/)?.[1]
  if (pr) return `pr-${pr}`
  const tag = entry.link?.match(/\/releases\/tag\/([^/]+)$/)?.[1]
  if (tag) return tag
  const key = entry.sourceKey.match(/^([a-z]+):([\w.-]+)$/)
  return key ? `${key[1]}-${key[2]}` : entry.id
}

// The entry a ?entry= link names, by its slug or, for a link made before slugs, its id.
export const findEntry = <T extends Linked>(entries: T[], key: string | null): T | undefined =>
  key === null ? undefined : entries.find((entry) => entrySlug(entry) === key || entry.id === key)

// The repository an entry came from (`owner/name`), from its link or its source key; null for a line with neither.
export function repoOfEntry(entry: Pick<ChangelogEntry, "link" | "sourceKey">): string | null {
  return (
    entry.link?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\//)?.[1] ??
    entry.sourceKey?.match(/^pr:([\w.-]+\/[\w.-]+)#\d+$/)?.[1] ??
    null
  )
}

// A `#<n>` standing on its own: not inside a word, a path, an entity, a link's text or a code span.
const ISSUE_SOURCE = String.raw`(?<![\w&/#[\x60-])(#\d+)\b`
const ISSUE = new RegExp(ISSUE_SOURCE, "g")

// Markdown with each `#<n>` a link to that issue in the entry's repository (GitHub sends a PR's number on to the PR), leaving code spans and links as they are.
export function linkIssues(markdown: string, repo: string | null): string {
  if (!repo) return markdown
  return markdown
    .split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            ISSUE,
            (issue: string) => `[${issue}](https://github.com/${repo}/issues/${issue.slice(1)})`,
          ),
    )
    .join("")
}

// A line split into its words and its `#<n>`s, each number with the URL it opens, for a heading that renders no Markdown.
export function issueParts(
  text: string,
  repo: string | null,
): { href: string | null; text: string }[] {
  if (!repo) return [{ href: null, text }]
  return text
    .split(new RegExp(ISSUE_SOURCE))
    .filter(Boolean)
    .map((part) =>
      /^#\d+$/.test(part)
        ? { href: `https://github.com/${repo}/issues/${part.slice(1)}`, text: part }
        : { href: null, text: part },
    )
}

// Pure: ids with the version a linked entry (a change or the version itself) sits in opened too.
export function withLinked(ids: string[], linked: string | null, shown: VersionGroup[]): string[] {
  const home = linked
    ? shown.find(
        (group) =>
          group.release?.id === linked || group.entries.some((entry) => entry.id === linked),
      )
    : undefined
  return home && !ids.includes(home.id) ? [...ids, home.id] : ids
}

// Pure: the versions open in the list. Your own opens and folds hold until the search or a filter changes, a fold of the linked version included; until then the top row is open, or every version left while a search or filter is set, so no match hides behind a shut row, and a linked entry's version with it.
export function openVersions({
  filtering,
  linked,
  opened,
  shown,
}: {
  filtering: boolean
  linked: string | null
  opened: string[] | null
  shown: VersionGroup[]
}): string[] {
  return (
    opened ??
    withLinked(
      (filtering ? shown : shown.slice(0, 1)).map((group) => group.id),
      linked,
      shown,
    )
  )
}

// The list's open versions as state: your opens and folds (null until your first), the search and filters they were made under, and the link they last opened.
export type OpenState = { ids: string[] | null; key: string; link: string | null }

// Pure: the state for this render. A new search or filter drops your opens and folds, so its matches show; a new link opens its version once, on top of what was open, so it never folds another by itself and a fold after it holds.
export function nextOpen(
  state: OpenState,
  now: { filtering: boolean; key: string; linked: string | null; shown: VersionGroup[] },
): OpenState {
  if (state.key !== now.key) return { ids: null, key: now.key, link: now.linked }
  if (state.link === now.linked) return state
  const before =
    state.ids ??
    openVersions({ filtering: now.filtering, linked: state.link, opened: null, shown: now.shown })
  return { ids: withLinked(before, now.linked, now.shown), key: now.key, link: now.linked }
}
