import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { chain, LEFTHOOK, repo, takes } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: forms that read heavier than they cost, each waiting on canary before this change, and the forms beside them that still count as a build
describe("commit-lane forms that cost no build", () => {
  const PAGE = "web/next/src/app/page.tsx"
  // each as [the form, staged, unstaged, untracked]; a held big slot at 30% idle leaves no room for a big run
  for (const [what, steps, staged, unstaged, untracked] of [
    // 1: -u stages tracked changes alone, never an untracked file
    [
      "git add -u beside an untracked web/next file",
      "cd ROOT && git add -u && git commit -m x",
      [],
      ["docs/notes.md"],
      ["web/next/src/app/new.tsx"],
    ],
    // 2: -v and -n change nothing staged, -N and -p stage only the paths they name
    [
      "git add -v",
      "cd ROOT && git add -v docs/notes.md && git commit -m x",
      [],
      ["docs/notes.md"],
      [],
    ],
    [
      "git add -n of a web/next file",
      `cd ROOT && git add -n ${PAGE} && git commit -m x`,
      [],
      ["web/next/src/app/page.tsx"],
      [],
    ],
    [
      "git add --dry-run of a web/next file",
      `cd ROOT && git add --dry-run ${PAGE} && git commit -m x`,
      [],
      ["web/next/src/app/page.tsx"],
      [],
    ],
    ["git add -N", "cd ROOT && git add -N docs/new.md && git commit -m x", [], [], ["docs/new.md"]],
    [
      "git add -p",
      "cd ROOT && git add -p docs/notes.md && git commit -m x",
      [],
      ["docs/notes.md"],
      [],
    ],
    // 3: the pathspec file as its own word
    [
      "git add --pathspec-from-file <f>",
      "cd ROOT && git add --pathspec-from-file list.txt && git commit -m x",
      [],
      ["docs/notes.md"],
      [],
    ],
    // 5: one folder named two ways
    [
      "git -C R add and git -C R/ commit",
      "git -C ROOT add docs/notes.md && git -C ROOT/ commit -m x",
      [],
      ["docs/notes.md"],
      [],
    ],
    // 11: a quoted message's #, ?, [ and { are its own text
    [
      "a quoted # in the message",
      'cd ROOT && git commit -m "closes #899"',
      ["docs/notes.md"],
      [],
      [],
    ],
    ["a quoted ? in the message", "cd ROOT && git commit -m 'what?'", ["docs/notes.md"], [], []],
    ["a quoted [ in the message", 'cd ROOT && git commit -m "[x] y"', ["docs/notes.md"], [], []],
    ["a quoted { in the message", "cd ROOT && git commit -m '{a} b'", ["docs/notes.md"], [], []],
    // 13: -n runs no hook, whatever the add before it staged
    [
      "git commit -n after a web/next add",
      `cd ROOT && git add ${PAGE} && git commit -n -m x`,
      [],
      ["web/next/src/app/page.tsx"],
      [],
    ],
    // a merge runs commit-msg alone, never pre-commit, so a merge with its push builds nothing
    [
      "git merge --no-edit then a push",
      "cd ROOT && git merge --no-edit origin/canary && git push origin HEAD:x",
      [],
      [],
      [],
    ],
    ["git -C R merge --no-edit alone", "git -C ROOT merge --no-edit origin/canary", [], [], []],
    ["git merge --ff-only", "cd ROOT && git merge --ff-only origin/canary", [], [], []],
    [
      "git merge --no-ff --no-edit then a push",
      "cd ROOT && git merge --no-ff --no-edit origin/canary && git push origin x",
      [],
      [],
      [],
    ],
  ] as const)
    test(`a chain with ${what} takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, [...staged], [...unstaged], LEFTHOOK, [...untracked])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, chain(m, steps))).toBe("run-slot-commit")
    })

  // a merge that stops on a conflict exits non-zero, so the push after its && never runs
  test("a chain whose merge stops on a conflict takes run-slot-commit and pushes nothing", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    writeFileSync(
      join(m.bin, "git"),
      readFileSync(join(m.bin, "git"), "utf8").replace(
        "#!/bin/bash\n",
        '#!/bin/bash\ncase " $* " in *" merge "*" conflict "*) echo CONFLICT >&2; exit 1 ;; esac\n',
      ),
    )
    m.hold("run-slot", 3, "big")
    const steps = "cd ROOT && git merge --no-edit conflict && git push origin pushed"
    expect(await takes(m, chain(m, steps))).toBe("run-slot-commit")
    expect(existsSync(join(m.root, "pushed"))).toBe(false)
  })

  test("while a chain whose merge ends clean takes run-slot-commit and pushes", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const steps = "cd ROOT && git merge --no-edit clean && git push origin pushed"
    expect(await takes(m, chain(m, steps))).toBe("run-slot-commit")
    expect(existsSync(join(m.root, "pushed"))).toBe(true)
  })
})
