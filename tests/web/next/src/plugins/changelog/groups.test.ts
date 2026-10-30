import { describe, expect, test } from "bun:test"

import type { ChangelogEntry } from "../../../../../../api/hono/src/plugins/changelog/types"
import {
  byVersion,
  entrySlug,
  findEntry,
  issueParts,
  linkIssues,
  nextOpen,
  openVersions,
  repoOfEntry,
  versionName,
  withLinked,
} from "../../../../../../web/next/src/plugins/changelog/groups"

const entry = (id: string, at: string, over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id,
  actor: "seed",
  at,
  createdAt: at,
  detail: null,
  images: [],
  kind: "feature",
  link: null,
  sourceKey: null,
  text: id,
  ...over,
})

const release = (tag: string, at: string) =>
  entry(tag, at, { kind: "release", text: `Version ${tag} is out, with 2 changes.` })

describe("byVersion", () => {
  test("puts each change in the first version tagged at or after it, Not shipped yet on top", () => {
    const groups = byVersion([
      entry("a", "2026-10-01T10:00:00Z"),
      release("v0.0.3", "2026-10-02T10:00:00Z"),
      entry("b", "2026-10-02T10:00:00Z"),
      entry("c", "2026-10-03T10:00:00Z"),
      release("v0.0.4", "2026-10-04T10:00:00Z"),
      entry("d", "2026-10-05T10:00:00Z"),
      entry("e", "2026-10-06T10:00:00Z"),
    ])
    expect(groups.map((g) => [g.id, g.entries.map((e) => e.id)])).toEqual([
      ["unshipped", ["e", "d"]],
      ["v0.0.4", ["c"]],
      ["v0.0.3", ["b", "a"]],
    ])
  })

  test("leaves out a group with no changes, and Not shipped yet when main has every change", () => {
    const groups = byVersion([
      release("v0.0.2", "2026-09-01T10:00:00Z"),
      entry("a", "2026-10-01T10:00:00Z"),
      release("v0.0.3", "2026-10-02T10:00:00Z"),
    ])
    expect(groups.map((g) => g.id)).toEqual(["v0.0.3"])
    expect(byVersion([])).toEqual([])
  })

  test("names a version by its tag", () => {
    expect(versionName(release("v0.0.4", "2026-10-04T10:00:00Z"))).toBe("v0.0.4")
  })
})

describe("an entry's link", () => {
  const UUID = "6ae6a9d9-0000-4000-8000-000000000001"
  const merge = entry(UUID, "2026-10-07T10:00:00Z", {
    link: "https://github.com/acme/archive/pull/253",
    sourceKey: "pr:acme/archive#253",
  })
  const version = entry("6ae6a9d9-0000-4000-8000-000000000002", "2026-10-07T11:00:00Z", {
    kind: "release",
    link: "https://github.com/acme/archive/releases/tag/v0.0.9",
    sourceKey: "release:v0.0.9",
  })
  const rule = entry("6ae6a9d9-0000-4000-8000-000000000003", "2026-10-07T12:00:00Z", {
    kind: "rule",
    sourceKey: "rule:classified",
  })
  const byHand = entry("6ae6a9d9-0000-4000-8000-000000000004", "2026-10-07T13:00:00Z", {
    kind: "ops",
  })
  // a line added by hand after the merge, linking the same PR: it keeps its id, so pr-253 still opens the merge
  const byHandLinking = entry("6ae6a9d9-0000-4000-8000-000000000005", "2026-10-07T14:00:00Z", {
    kind: "ops",
    link: "https://github.com/acme/archive/pull/253",
  })

  test("names a merge by its PR, a version by its tag, a rule by its key, and a line by hand by its id", () => {
    expect(entrySlug(merge)).toBe("pr-253")
    expect(entrySlug(version)).toBe("v0.0.9")
    expect(entrySlug(rule)).toBe("rule-classified")
    expect(entrySlug(byHand)).toBe(byHand.id)
    expect(entrySlug(byHandLinking)).toBe(byHandLinking.id)
  })

  test("opens by that name, and an old link by its id", () => {
    const entries = [byHandLinking, merge, version, rule, byHand]
    expect(findEntry(entries, "pr-253")).toBe(merge)
    expect(findEntry(entries, "v0.0.9")).toBe(version)
    expect(findEntry(entries, "rule-classified")).toBe(rule)
    expect(findEntry(entries, UUID)).toBe(merge)
    expect(findEntry(entries, "pr-1")).toBeUndefined()
    expect(findEntry(entries, null)).toBeUndefined()
  })
})

describe("an entry's issue numbers", () => {
  const REPO = "acme/archive"

  test("finds the repository from the link, else the source key", () => {
    expect(repoOfEntry({ link: "https://github.com/acme/archive/pull/269", sourceKey: null })).toBe(
      REPO,
    )
    expect(repoOfEntry({ link: null, sourceKey: "pr:acme/archive#269" })).toBe(REPO)
    expect(repoOfEntry({ link: null, sourceKey: "rule:classified" })).toBeNull()
  })

  test("makes each #n in a detail a link to that issue, leaving code and links alone", () => {
    expect(
      linkIssues("Closes #177; see `#12` and [#9](https://x.y/9). Not a&#39;s or a#1.", REPO),
    ).toBe(
      "Closes [#177](https://github.com/acme/archive/issues/177); see `#12` and [#9](https://x.y/9). Not a&#39;s or a#1.",
    )
    expect(linkIssues("#177", null)).toBe("#177")
  })

  test("splits a line into its words and its #n links", () => {
    expect(issueParts("Merge train for #177, at last", REPO)).toEqual([
      { href: null, text: "Merge train for " },
      { href: "https://github.com/acme/archive/issues/177", text: "#177" },
      { href: null, text: ", at last" },
    ])
    expect(issueParts("No repo #1", null)).toEqual([{ href: null, text: "No repo #1" }])
  })
})

describe('openVersions (the owner: "changelog should look like inbox, like the accordions")', () => {
  const group = (id: string, entries: string[], release: string | null = null) => ({
    entries: entries.map((entryId) => ({ id: entryId }) as ChangelogEntry),
    id,
    release: release ? ({ id: release } as ChangelogEntry) : null,
  })
  const shown = [group("next", ["pr-3"]), group("v2", ["pr-2"], "v2"), group("v1", ["pr-1"], "v1")]
  const base = { filtering: false, linked: null, opened: null, shown }

  test('the top row (the newest version, or "Not shipped yet") starts open, the rest folded', () => {
    expect(openVersions(base)).toEqual(["next"])
  })

  test("while a search or filter is set, every version it leaves is open, so no match hides", () => {
    expect(openVersions({ ...base, filtering: true, shown: shown.slice(1) })).toEqual(["v2", "v1"])
  })

  test("your own opens and folds hold, a shut row opening included", () => {
    expect(openVersions({ ...base, opened: ["next", "v1"] })).toEqual(["next", "v1"])
    expect(openVersions({ ...base, opened: [] })).toEqual([])
  })

  test("a linked entry's version opens, by a change or by the version itself", () => {
    expect(openVersions({ ...base, linked: "pr-1" })).toEqual(["next", "v1"])
    expect(openVersions({ ...base, linked: "v2" })).toEqual(["next", "v2"])
    expect(openVersions({ ...base, linked: "pr-3" })).toEqual(["next"])
  })

  test("a fold of the linked version holds, and a new link opens its version once", () => {
    expect(openVersions({ ...base, linked: "pr-1", opened: ["next"] })).toEqual(["next"])
    expect(withLinked(["next"], "pr-2", shown)).toEqual(["next", "v2"])
    expect(withLinked(["next", "v2"], "pr-2", shown)).toEqual(["next", "v2"])
    expect(withLinked(["next"], null, shown)).toEqual(["next"])
  })

  test("a new link opens its version on top of the default, so the version linked before stays open", () => {
    const state = { ids: null, key: "k", link: "pr-1" }
    const now = { filtering: false, key: "k", linked: "pr-3", shown }
    expect(nextOpen(state, now)).toEqual({ ids: ["next", "v1"], key: "k", link: "pr-3" })
    expect(nextOpen(state, { ...now, linked: null }).ids).toEqual(["next", "v1"])
    expect(nextOpen(state, { ...now, linked: "pr-1" })).toBe(state)
  })

  test("a new search or filter drops your folds, so going back to an earlier one never hides a match", () => {
    const folded = { ids: [] as string[], key: "a", link: null }
    expect(nextOpen(folded, { filtering: true, key: "b", linked: null, shown })).toEqual({
      ids: null,
      key: "b",
      link: null,
    })
  })
})
