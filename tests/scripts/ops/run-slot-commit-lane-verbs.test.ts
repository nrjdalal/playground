import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { repo, takes } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 4, 6 and 9: a lone git run's flags and env words decide its lane, a commit's alone beside one that still builds
describe("commit-lane forms of a lone git run", () => {
  const PAGE = "web/next/src/app/page.tsx"
  // 4, 6 and 9: a lone commit whose flags or env words run no build, beside one that still does
  for (const [what, words, staged] of [
    ["commit -e", ["commit", "-e", "-m", "x"], ["docs/notes.md"]],
    ["commit --edit", ["commit", "--edit", "-m", "x"], ["docs/notes.md"]],
    ["commit -nz of a web/next file", ["commit", "-nz", "-m", "x"], [PAGE]],
    ["commit -n -z of a web/next file", ["commit", "-n", "-z", "-m", "x"], [PAGE]],
  ] as const)
    test(`git ${what} takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, [...staged])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, ["git", "-C", m.root, ...words])).toBe("run-slot-commit")
    })

  for (const [what, words] of [
    ["commit -e of a web/next file", ["commit", "-e", "-m", "x"]],
    ["commit -zn of a web/next file, whose -z may take n", ["commit", "-zn", "-m", "x"]],
  ] as const)
    test(`git ${what} still waits as a big run`, async () => {
      const m = repo({ idle: 30 }, [PAGE])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, ["git", "-C", m.root, ...words])).toBe("waited")
    })

  for (const env of [
    "SKIP_ENV_VALIDATION=true",
    "TURBO_CACHE_DIR=/tmp/turbo",
    "GIT_AUTHOR_NAME=x",
    "GIT_COMMITTER_EMAIL=x@y.z",
  ])
    test(`env ${env} git commit takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      const argv = ["env", env, "git", "-C", m.root, "commit", "-m", "x"]
      expect(await takes(m, argv)).toBe("run-slot-commit")
    })

  // 10: a git run that commits nothing, with a listed option or env word, keeps the commit lane
  for (const words of [
    ["-c", "a.b=c", "push", "origin"],
    ["--no-pager", "merge", "main"],
  ])
    test(`git ${words.join(" ")} takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, ["git", "-C", m.root, ...words])).toBe("run-slot-commit")
    })

  test("GIT_SSH_COMMAND=<cmd> git push takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const argv = ["env", "GIT_SSH_COMMAND=ssh", "git", "-C", m.root, "push", "origin"]
    expect(await takes(m, argv)).toBe("run-slot-commit")
  })

  // review round 1: --icase-pathspecs and --glob-pathspecs widen what a commit's paths match past the diff run-slot reads
  for (const [opt, path] of [
    ["--icase-pathspecs", "WEB/NEXT/src/app/page.tsx"],
    ["--glob-pathspecs", "web/next/**/page.tsx"],
  ])
    test(`git ${opt} commit -- <a web/next path> still waits as a big run`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"], [PAGE])
      m.hold("run-slot", 3, "big")
      const argv = ["git", opt, "-C", m.root, "commit", "-m", "x", "--", path]
      expect(await takes(m, argv)).toBe("waited")
    })

  test("git -c core.hooksPath=<dir> push still waits as a big run", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const argv = ["git", "-C", m.root, "-c", "core.hooksPath=/x", "push", "origin"]
    expect(await takes(m, argv)).toBe("waited")
  })
})
