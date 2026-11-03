import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, type Setup } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// A machine whose fake git fails on a `-C` folder that is not one, answers `git diff --cached --name-only` with `staged`, a plain `git diff --name-only` with `unstaged`, and touches its last argument for anything else, as a commit's marker
const repo = (setup: Setup, staged: string[], unstaged: string[] = []) => {
  const m = machine(setup)
  writeFileSync(
    join(m.bin, "git"),
    `#!/bin/bash
[ "$1" = -C ] && { [ -d "$2" ] || exit 128; }
for a in "$@"; do
  [ "$a" = diff ] || continue
  case " $* " in *" --cached "*) printf '%s\\n' ${staged.join(" ")} ;; *) printf '%s\\n' ${unstaged.join(" ")} ;; esac
  exit 0
done
touch "\${@: -1}"
`,
  )
  chmodSync(join(m.bin, "git"), 0o755)
  return m
}
const log = (m: ReturnType<typeof machine>) => {
  const path = join(m.ops, "run-slot.runs.log")
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}
// a quick lane's holder line, as run-slot writes one: who, pid and when, with no units
const holdLane = (m: ReturnType<typeof machine>, lane: string, who: string) => {
  writeFileSync(join(m.ops, `${lane}.holder`), `${who} ${process.pid} 2026-11-03T06:41:00Z\n`)
  mkdirSync(join(m.ops, lane))
}

// 06:41Z, 3 Nov: a cold next build in a pre-commit ran on run-slot-commit beside a node_modules clone with no units held, and load1 reached 56
describe("the commit and clone lanes hold load units", () => {
  test("a big run waits while a commit's build and a clone hold their lanes", async () => {
    const m = machine()
    holdLane(m, "run-slot-commit", "commit-wt")
    holdLane(m, "run-slot-clone", "worker-c")
    expect(await m.waits("worker-b", { RUN_SLOT_SIZE: "big" })).toBe(true)
  })

  test("a medium run still starts beside them", async () => {
    const m = machine()
    holdLane(m, "run-slot-commit", "commit-wt")
    holdLane(m, "run-slot-clone", "worker-c")
    expect(await m.runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  // idle 30 keeps slots 2 to 4 shut, so one CPU slot is open and 2 units are the whole capacity
  test("a small run still starts beside a held commit lane while one CPU slot is open", async () => {
    const m = machine({ idle: 30 })
    holdLane(m, "run-slot-commit", "commit-wt")
    expect(await m.runs("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a run that gates a merge still starts beside a held clone lane while one CPU slot is open", async () => {
    const m = machine({ idle: 30 })
    holdLane(m, "run-slot-clone", "worker-c")
    expect(await m.runs("ops-checks-1", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a medium run waits beside a held commit lane while one CPU slot is open", async () => {
    const m = machine({ idle: 30 })
    holdLane(m, "run-slot-commit", "commit-wt")
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })
})

// 04:05Z, 3 Nov: a commit staging web/next took run-slot-commit beside its own session's big run, and its next build ran at 1.7 cores with load1 24
describe("a commit whose pre-commit runs next build", () => {
  test("staging a web/next file, from a session holding the big slot, does not start on run-slot-commit while that slot is held", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx", "docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  test("takes a CPU slot as a big run when one is open", async () => {
    const m = repo({}, ["web/next/src/app/page.tsx"])
    const run = m.start("worker-x", {}, undefined, ["git", "commit"])
    expect(await run.ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot waited=/)
  })

  test("git commit -a counts a web/next file it will stage", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit", "-am"]).waits()).toBe(true)
  })

  // @web/next#build builds from api/hono, every package and the root's manifests, so a commit staging only those runs next build too
  for (const file of ["api/hono/src/index.ts", "packages/env/src/data-dir.ts", "bun.lock"]) {
    test(`staging ${file} alone waits as a big run too`, async () => {
      const m = repo({ idle: 30 }, [file])
      m.hold("run-slot", 3, "big")
      expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
    })
  }

  test("git -C <dir> commit -C <rev> reads the rev as the message's commit and still counts a staged web/next file", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m
        .start("worker-x", {}, undefined, ["git", "-C", m.root, "commit", "-C", "HEAD"])
        .waits(),
    ).toBe(true)
  })

  test("git commit -- <path> counts the web/next path it commits", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(
      await m
        .start("worker-x", {}, undefined, [
          "git",
          "commit",
          "-m",
          "x",
          "--",
          "web/next/src/app/page.tsx",
        ])
        .waits(),
    ).toBe(true)
  })

  test("commit-slot.ts's build for a worktree staging a web/next file counts as big", async () => {
    const m = repo({}, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.waits("commit-wt")).toBe(true)
  })
})

describe("a commit that stages no web/next file", () => {
  test("still takes run-slot-commit at once, beside a big run", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("nor does git commit -n, whose pre-commit never runs, though it stages one", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit", "-n", "-m", "x"]).ran()).toBe(
      true,
    )
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("and commit-slot.ts's build for it stays small", async () => {
    const m = repo({}, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.runs("commit-wt")).toBe(true)
  })
})
