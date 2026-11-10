import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chain, LEFTHOOK, repo, takes } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: the forms beside the ones that cost no build, each still reading as a build and waiting off the commit lane: the add forms and the message's own words
describe("commit-lane forms that still count as a build: the add forms", () => {
  const PAGE = "web/next/src/app/page.tsx"
  for (const [what, steps, unstaged, untracked] of [
    [
      "git add -u of a tracked web/next change",
      "cd ROOT && git add -u && git commit -m x",
      [PAGE],
      [],
    ],
    [
      "git add -p of a web/next file",
      `cd ROOT && git add -p ${PAGE} && git commit -m x`,
      [PAGE],
      [],
    ],
    [
      "git add -N of an untracked web/next file",
      "cd ROOT && git add -N web/next/src/app/new.tsx && git commit -m x",
      [],
      ["web/next/src/app/new.tsx"],
    ],
    [
      "git add --pathspec-from-file <f> with a web/next change",
      "cd ROOT && git add --pathspec-from-file list.txt && git commit -m x",
      [PAGE],
      [],
    ],
    // 8: an option after -c other than -e, -u, -x, -v or -o pipefail reads no steps
    ["bash -c -O <opt>", "-O", [], []],
    // 13: a glued a(b) splits at its (, and b is off the list
    ["a glued a(b)", "cd ROOT && git commit -m a(b)", [], []],
    // review round 1: an option's value or a word after -- is a path, never a message, so a quoted glob there is off the list
    [
      "git commit --trailer -m <a quoted glob>",
      "cd ROOT && git commit --trailer -m 'web/*'",
      [PAGE],
      [],
    ],
    [
      "git commit --trailer --message <a quoted glob>",
      "cd ROOT && git commit --trailer --message 'web/*'",
      [PAGE],
      [],
    ],
    ["git commit -- -m <a quoted glob>", "cd ROOT && git commit -m x -- -m 'web/*'", [PAGE], []],
  ] as const)
    test(`a chain with ${what} still waits off the commit lane`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"], [...unstaged], LEFTHOOK, [...untracked])
      m.hold("run-slot", 3, "big")
      const argv =
        steps === "-O"
          ? ["bash", "-c", "-O", "extglob", `cd ${m.root} && git commit -m x`]
          : chain(m, steps)
      expect(await takes(m, argv)).toBe("waited")
    })
})
