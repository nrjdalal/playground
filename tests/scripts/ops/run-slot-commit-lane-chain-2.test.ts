import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, LEFTHOOK, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// on the list, a chain still builds when its commit would: review round 1 found a chain whose own add staged a next file read against the index alone
describe("a sh -c chain of git steps: the chain's own add stages the file", () => {
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
})
