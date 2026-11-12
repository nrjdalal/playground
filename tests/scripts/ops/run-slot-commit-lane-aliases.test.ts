import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { chain, holdLane, repo, takes } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 7 and 12: beside held commit and clone lanes a medium run starts and a big one waits, so each row reads whether the run counted as a build
describe("a git verb an alias names and git's plumbing", () => {
  const lanes = (aliases = "") => {
    const m = repo({}, ["docs/notes.md"])
    if (aliases) writeFileSync(join(m.root, "aliases"), aliases)
    holdLane(m, "run-slot-commit", "commit-wt")
    holdLane(m, "run-slot-clone", "worker-c")
    return m
  }
  const medium = { RUN_SLOT_SIZE: "medium" }

  // 7: git -p reads past to its verb, log, so the commit word in its --grep is not a commit
  test("git -p log --grep commit runs as a medium run", async () => {
    const m = lanes()
    const argv = ["git", "-C", m.root, "-p", "log", "--grep", "commit"]
    expect(await takes(m, argv, m.root, medium)).toMatch(/^run-slot/)
  })

  test("git ci, an alias in the repo's config, counts as a build", async () => {
    const m = lanes("alias.ci\n")
    expect(await takes(m, ["git", "-C", m.root, "ci", "-m", "x"], m.root, medium)).toBe("waited")
  })

  // review round 1: an alias in the folder a chain's step names by -C or cds into counts as a build
  for (const steps of ["git -C ROOT ci -m x", "cd ROOT && git ci -m x"])
    test(`a chain with ${steps}, ci an alias in that repo's config, counts as a build`, async () => {
      const m = lanes("alias.ci\n")
      expect(await takes(m, chain(m, steps), undefined, medium)).toBe("waited")
    })

  // review round 2: a verb git does not ship counts as a commit in a chain, whatever config names it, so no alias read can miss one
  for (const steps of [
    "git -c alias.zz=commit zz -m x",
    "git --git-dir ROOT/.git ci -m x",
    "false && cd ROOT ; git ci -m x",
  ])
    test(`a chain with ${steps}, ci and zz in no config, counts as a build`, async () => {
      const m = lanes()
      expect(await takes(m, chain(m, steps), undefined, medium)).toBe("waited")
    })

  // 13j: git_verb reads past --git-dir to the commit, which chain_safe takes off the list
  test("a chain with git --git-dir <d> commit counts as a build", async () => {
    const m = lanes()
    const steps = "cd ROOT && git --git-dir ROOT/.git commit -m x"
    expect(await takes(m, chain(m, steps), undefined, medium)).toBe("waited")
  })

  // a chain of git's plumbing reads commits nothing, so it starts as its own size
  for (const steps of [
    "git merge-base HEAD origin/canary && git cat-file -t HEAD",
    "git for-each-ref refs/heads && git merge-base HEAD x",
  ])
    test(`a chain with ${steps} runs as a medium run`, async () => {
      const m = lanes()
      expect(await takes(m, chain(m, steps), undefined, medium)).toMatch(/^run-slot/)
    })

  // while a plumbing write stays off git_known, so a chain counts it as a commit
  for (const steps of ["git update-ref refs/heads/x HEAD", "git hash-object -w notes.md"])
    test(`a chain with ${steps} counts as a build`, async () => {
      const m = lanes()
      expect(await takes(m, chain(m, steps), undefined, medium)).toBe("waited")
    })

  test("while git frob, which no alias names, runs as a medium run", async () => {
    const m = lanes("alias.ci\n")
    expect(await takes(m, ["git", "-C", m.root, "frob"], m.root, medium)).toMatch(/^run-slot/)
  })
})
