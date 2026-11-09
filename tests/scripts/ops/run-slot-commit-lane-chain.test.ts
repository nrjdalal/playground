import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { chainLane as lane, chainStart as start, LEFTHOOK, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 4 Nov: a commit inside a sh -c chain counts as the bare commit would, so one that runs next build still waits as a big run
// builder, 5 Nov: three review rounds each found one more form that a reading of cd, ~ or env let through, so a chain takes the commit lane only when every step is a form on a closed list, and any other form in a chain that commits counts as a build; a chain starts outside the repo unless it is given the repo, where a bare git step runs in run-slot's own folder
describe("a sh -c chain of git steps", () => {
  test("a chain whose every step is on the closed list takes run-slot-commit beside a big run", async () => {
    for (const steps of [
      "cd ROOT && git add . && git commit -m x && git push origin",
      "git -C ROOT add . && git -C ROOT commit -m x && git -C ROOT push origin",
      "bun run precommit:light && cd ROOT && git commit -m x",
      // review round 13: a quoted ( in a conventional commit message stays a word
      'cd ROOT && git commit -m "docs(PG-899): x"',
      "cd ROOT && git commit -m 'fix(PG-899): x'",
    ]) {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect([steps, await lane(m, steps)]).toEqual([steps, "run-slot-commit"])
    }
  })

  // review round 1 of #1132: a dash chain is read as a sh one, for its lane and for its build
  test("a dash chain on the closed list takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, "cd ROOT && git commit -m x", false, "dash")).toBe("run-slot-commit")
  })

  test("while a dash chain whose commit takes a web/next file waits as a big run", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"], [], LEFTHOOK)
    m.hold("run-slot", 3, "big")
    expect(await start(m, "cd ROOT && git commit -m x", false, "dash").waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // builder, 5 Nov: a bare git step runs in run-slot's own folder, so the chain the issue names takes the commit lane from inside the repo
  test("a chain of bare git steps run from the repo takes run-slot-commit beside a big run", async () => {
    const steps = "git add . && git commit -m x && git push origin"
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, steps, true)).toBe("run-slot-commit")
  })

  // review round 7: an env word before the shell, such as BASH_ENV or PATH, changes what the shell runs
  test("a chain behind an env word counts as a build", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const outside = join(m.root, "outside")
    mkdirSync(outside, { recursive: true })
    const argv = ["env", "BASH_ENV=/dev/null", "sh", "-c", `cd ${m.root} && git commit -m x`]
    expect(await m.start("worker-x", {}, undefined, argv, outside).waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // builder, 5 Nov: from the repo too, where a bare git step alone is on the list, one after a cd - or a relative cd still counts as a build
  for (const steps of [
    "cd - && git add . && git commit -m x",
    "cd docs && git add . && git commit -m x",
  ])
    test(`a bare git step after a cd off the list, run from the repo, counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps, true).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })

  // on the list, a chain still builds when its commit would: review round 1 found a chain whose own add staged a next file read against the index alone
  for (const [what, add, staged, unstaged, untracked] of [
    ["staged before the run", "git add .", ["web/next/src/app/page.tsx"], [], []],
    [
      "staged by the chain's add of the whole tree",
      "git add .",
      [],
      ["web/next/src/app/page.tsx"],
      [],
    ],
    [
      "staged by an add naming its path",
      "git add web/next/src/app/page.tsx",
      [],
      ["web/next/src/app/page.tsx"],
      [],
    ],
    ["untracked, staged by add -A", "git add -A", [], [], ["web/next/src/app/new.tsx"]],
  ] as const)
    test(`a chain on the list whose commit takes a web/next file ${what} waits as a big run`, async () => {
      const m = repo({ idle: 30 }, [...staged], [...unstaged], LEFTHOOK, [...untracked])
      m.hold("run-slot", 3, "big")
      expect(
        await start(m, `cd ROOT && ${add} && git commit -m x && git push origin`).waits(),
      ).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })

  // review round 8: from a subfolder, git ls-files prints an untracked file relative to it unless --full-name
  test("a chain on the list that adds an untracked web/next file from inside web/next waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], [], LEFTHOOK, ["web/next/src/app/new.tsx"])
    mkdirSync(join(m.root, "web/next/src/app"), { recursive: true })
    m.hold("run-slot", 3, "big")
    expect(await start(m, "cd ROOT/web/next && git add . && git commit -m x").waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // review round 9: git add -A, --all and :/ stage the whole tree from any folder, untracked files outside it included
  test("a chain on the list that adds the whole tree from docs, with an untracked web/next file, waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], [], LEFTHOOK, ["web/next/src/app/new.tsx"])
    mkdirSync(join(m.root, "docs"), { recursive: true })
    m.hold("run-slot", 3, "big")
    expect(await start(m, "cd ROOT/docs && git add -A && git commit -m x").waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // review round 10: an add reads its paths from its own folder, so one in another folder than the commit counts as a build
  test("a chain on the list whose add runs in another folder than its commit waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], ["web/next/src/app/page.tsx"])
    mkdirSync(join(m.root, "web"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const steps = "git -C ROOT/web add next/src/app/page.tsx && git -C ROOT commit -m x"
    expect(await start(m, steps).waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  test("while one whose add names only a Markdown file takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, [], ["docs/notes.md", "web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, "cd ROOT && git add docs/notes.md && git commit -m x")).toBe(
      "run-slot-commit",
    )
  })
})
