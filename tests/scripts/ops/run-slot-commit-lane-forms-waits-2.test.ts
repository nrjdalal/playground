import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chain, LEFTHOOK, repo, takes } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: the forms beside the ones that cost no build, each still reading as a build and waiting off the commit lane: the joins and the merge forms
describe("commit-lane forms that still count as a build: joins and merges", () => {
  const PAGE = "web/next/src/app/page.tsx"
  for (const [what, steps, unstaged, untracked] of [
    // review round 1: a cd after && may not have run when any later step joined by ; or || does
    [
      "a cd after && whose later step joins by ;",
      "git -C ROOT add docs/notes.md && cd ROOT && git add . ; git commit -m x",
      [],
      [],
    ],
    [
      "a cd after && whose later step joins by ||",
      "bun run precommit:light && cd ROOT && git add . || git commit -m x",
      [],
      [],
    ],
    // review round 1: git add reads every word after -- as a path, -n included
    [
      "git add -- -n <a web/next file>",
      `cd ROOT && git add -- -n ${PAGE} && git commit -m x`,
      [PAGE],
      [],
    ],
    // a merge option past --no-edit, --ff, --ff-only and --no-ff, or a ref sh expands, is off the list
    [
      "git merge -s ours",
      "cd ROOT && git merge -s ours origin/canary && git push origin x",
      [],
      [],
    ],
    ["git merge -X theirs", "cd ROOT && git merge --no-edit -X theirs origin/canary", [], []],
    ["git merge -m <msg>", "cd ROOT && git merge --no-edit -m x origin/canary", [], []],
    ["git merge of a $REF", 'cd ROOT && git merge --no-edit "$REF"', [], []],
    // a merge that stops on a conflict leaves the other side's files for a later add or commit, so either after a merge counts as a build
    [
      "an add and commit after a merge, joined by ;",
      "cd ROOT && git merge --no-edit origin/canary; git add -A; git commit -m x",
      [],
      [],
    ],
    [
      "a commit after a merge",
      "cd ROOT && git merge --no-edit origin/canary && git commit -m x",
      [],
      [],
    ],
  ] as const)
    test(`a chain with ${what} still waits off the commit lane`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"], [...unstaged], LEFTHOOK, [...untracked])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, chain(m, steps))).toBe("waited")
    })
})
