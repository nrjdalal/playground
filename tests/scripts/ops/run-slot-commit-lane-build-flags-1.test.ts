import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// builder, 5 Nov: the commit lane fails closed, so a flag run-slot does not read counts as a build, even beside Markdown alone
describe("git forms the commit read does not know count as a build", () => {
  for (const flags of [
    ["commit", "--no-such-flag", "-m", "x"],
    ["commit", "-Zm", "x"],
    ["commit", "-pm", "x"],
    ["commit", "-m", "x", "--pathspec-fr=list.txt"],
  ])
    test(`git ${flags.join(" ")} counts as a build`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(
        await m.start("worker-x", {}, undefined, ["git", "-C", m.root, ...flags]).waits(),
      ).toBe(true)
    })
})
