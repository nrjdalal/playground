import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { holdLane, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// builder, 5 Nov: the commit lane fails closed, so a flag run-slot does not read counts as a build, even beside Markdown alone
describe("git forms the commit read does not know count as a build", () => {
  for (const flags of [
    ["commit", "--no-such-flag", "-m", "x"],
    ["commit", "-Zm", "x"],
    ["commit", "-pm", "x"],
    ["commit", "-m", "x", "--pathspec-fr=list.txt"],
    ["-c", "core.hooksPath=/x", "commit", "-m", "x"],
    ["--git-dir", "/x/.git", "commit", "-m", "x"],
    ["commit", "-n", "--verify", "-m", "x"],
  ])
    test(`git ${flags.join(" ")} counts as a build`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(
        await m.start("worker-x", {}, undefined, ["git", "-C", m.root, ...flags]).waits(),
      ).toBe(true)
    })

  // review round 12: a git option before a verb run-slot does not know, such as an alias of commit, counts as a build, so it waits beside the held lanes where a medium run starts
  test("git -c alias.ci=commit ci counts as a build", async () => {
    const m = repo({}, ["docs/notes.md"])
    holdLane(m, "run-slot-commit", "commit-wt")
    holdLane(m, "run-slot-clone", "worker-c")
    const argv = ["git", "-C", m.root, "-c", "alias.ci=commit", "ci", "-m", "x"]
    expect(await m.start("worker-m", { RUN_SLOT_SIZE: "medium" }, undefined, argv).waits()).toBe(
      true,
    )
  })
})
