import { expect, test } from "bun:test"

import {
  type Page,
  type Pr,
  QUERY,
  readAll,
  rowsOf,
  searchOf,
} from "../../../../../packages/scripts/src/retro/table"

const by = (login: string, body: string) => ({ author: { login }, body })
const NOW = new Date("2026-10-31T12:00:00Z")

const pr = (over: Partial<Pr> = {}): Pr => ({
  allCommits: { totalCount: 4 },
  comments: {
    nodes: [
      by("acme", "## ReviewBot · round 1: 3/5 at 1717063 · 1 blocking"),
      by("acme", "a note from the author"),
      by("acme", "## ReviewBot · round 2: 5/5 at 0f4d307 · 0 blocking"),
      by("acme", "## TesterBot · FAIL at 1717063 · the card is blank"),
      by("acme", "## TesterBot · PASS at 0f4d307 · drove it"),
      by("someone", "## ReviewBot · round 3: 5/5 at 0f4d307 · copied"),
    ],
    totalCount: 6,
  },
  firstCommit: { nodes: [{ commit: { authoredDate: "2026-10-31T10:00:00Z" } }] },
  mergedAt: "2026-10-31T11:30:00Z",
  number: 12,
  state: "MERGED",
  timelineItems: { totalCount: 1 },
  title: "fix(PG-12): a title",
  ...over,
})

test("a merged PR reads its first commit to merge, commits, force pushes, the owner's review rounds, and its tester passes out of its tester verdicts", () => {
  expect(rowsOf([pr()], "acme", NOW)).toEqual([
    "pr\tstate\tfirst\tmerged\ttook\tcommits\tfp\trounds\tscores\ttests\ttitle",
    "12\tM\t10:00\t11:30\t90m\tc4\tfp1\tr2\t[1:3 2:5]\tt1/2\tfix(PG-12): a title",
  ])
})

test("an open PR counts to now, rows sort by number, a PR with no commit reads its gap as -, and comments past one read are named", () => {
  const open = pr({ mergedAt: null, number: 30, state: "OPEN" })
  const empty = pr({
    comments: { nodes: [], totalCount: 140 },
    firstCommit: { nodes: [] },
    mergedAt: null,
    number: 7,
    state: "CLOSED",
  })
  expect(rowsOf([open, empty], "acme", NOW).slice(1)).toEqual([
    "7\tC\t-\t-\t-\tc4\tfp1\tr0\t[]\tt0/0\tfix(PG-12): a title",
    "30\tO\t10:00\t-\t120m\tc4\tfp1\tr2\t[1:3 2:5]\tt1/2\tfix(PG-12): a title",
    "#7: read 0 of 140 comments, so later verdicts are missing from its row",
  ])
})

test("every page of the search is read, each from the last one's end", async () => {
  const asked: (string | null)[] = []
  const pages: Record<string, Page> = {
    first: { nodes: [pr({ number: 1 })], pageInfo: { endCursor: "c1", hasNextPage: true } },
    c1: { nodes: [pr({ number: 2 })], pageInfo: { endCursor: "c2", hasNextPage: false } },
  }
  const prs = await readAll(async (after) => (asked.push(after), pages[after ?? "first"]!))
  expect(prs.map((p) => p.number)).toEqual([1, 2])
  expect(asked).toEqual([null, "c1"])
})

test("the search reads the factory's PRs updated since a time, and the query pages and asks for every field rowsOf reads", () => {
  expect(searchOf("acme/factory", "2026-10-31T00:00:00Z")).toBe(
    "repo:acme/factory is:pr updated:>=2026-10-31T00:00:00Z",
  )
  for (const field of [
    "after: $after",
    "allCommits",
    "author { login }",
    "endCursor",
    "firstCommit",
    "hasNextPage",
    "mergedAt",
    "timelineItems",
    "totalCount",
  ])
    expect(QUERY).toContain(field)
})
