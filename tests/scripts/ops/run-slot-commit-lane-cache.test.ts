import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { log, repo, turbo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: a lone commit waited up to 4,054 s as a big run; under run-slot, commit-slot.ts runs the build bare inside the commit's own slot, so only a build turbo replays whole from its cache, which runs in seconds, leaves the queue
describe("a commit whose next build turbo replays from its cache", () => {
  test("takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    turbo(m, "HIT")
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "-C", m.root, "commit", "-m", "x"]).ran(),
    ).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  // 5 Nov: its pre-commit tsc over packages/scripts then runs bare in the commit's slot, which ran at most 8 s in 32 runs (run-slot.runs.log, 5 Nov), as a bare commit's runs on run-slot-commit too
  test("staging a packages/scripts file takes run-slot-commit beside a big run, its type check with it", async () => {
    const m = repo({ idle: 30 }, ["packages/scripts/src/pr-merge/cli.ts"])
    turbo(m, "HIT")
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "-C", m.root, "commit", "-m", "x"]).ran(),
    ).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  for (const [what, status] of [
    ["one task to run", "MISS"],
    ["a dry run that fails", null],
  ] as const)
    test(`but with ${what} still waits as a big run`, async () => {
      const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
      turbo(m, status)
      m.hold("run-slot", 3, "big")
      expect(
        await m
          .start("worker-x", {}, undefined, ["git", "-C", m.root, "commit", "-m", "x"])
          .waits(),
      ).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
