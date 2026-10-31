import { expect, test } from "bun:test"

import { QUERY, rowsOf, searchOf } from "../../../../../packages/scripts/src/retro/table"

const pr = (over: Record<string, unknown> = {}) => ({
  allCommits: { totalCount: 4 },
  comments: {
    nodes: [
      { body: "## ReviewBot · round 1: 3/5 at 1717063 · 1 blocking" },
      { body: "a note from the author" },
      { body: "## ReviewBot · round 2: 5/5 at 0f4d307 · 0 blocking" },
      { body: "## TesterBot · drove it" },
    ],
  },
  firstCommit: { nodes: [{ commit: { authoredDate: "2026-10-31T10:00:00Z" } }] },
  mergedAt: "2026-10-31T11:30:00Z",
  number: 12,
  state: "MERGED",
  timelineItems: { totalCount: 1 },
  title: "fix(PG-12): a title",
  ...over,
})

test("a merged PR reads its first commit to merge, commits, force pushes, review rounds with scores and tester reports", () => {
  expect(rowsOf([pr()], new Date("2026-10-31T12:00:00Z"))).toEqual([
    "pr\tstate\tfirst\tmerged\tmins\tcommits\tfp\trounds\tscores\ttests\ttitle",
    "12\tM\t10:00\t11:30\t90m\tc4\tfp1\tr2\t[1:3 2:5]\tt1\tfix(PG-12): a title",
  ])
})

test("an open PR counts to now, rows sort by number, and a PR with no commit reads its gap as -", () => {
  const open = pr({ mergedAt: null, number: 30, state: "OPEN" })
  const empty = pr({
    comments: { nodes: [] },
    firstCommit: { nodes: [] },
    mergedAt: null,
    number: 7,
    state: "CLOSED",
  })
  expect(rowsOf([open, empty], new Date("2026-10-31T12:00:00Z")).slice(1)).toEqual([
    "7\tC\t-\t-\t-\tc4\tfp1\tr0\t[]\tt0\tfix(PG-12): a title",
    "30\tO\t10:00\t-\t120m\tc4\tfp1\tr2\t[1:3 2:5]\tt1\tfix(PG-12): a title",
  ])
})

test("the search reads the factory's PRs updated since a time, and the query asks for every field rowsOf reads", () => {
  expect(searchOf("acme/factory", "2026-10-31T00:00:00Z")).toBe(
    "repo:acme/factory is:pr updated:>=2026-10-31T00:00:00Z",
  )
  for (const field of ["allCommits", "comments", "firstCommit", "mergedAt", "timelineItems"])
    expect(QUERY).toContain(field)
})
