import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, type Setup } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// Playground's own lefthook.yml, whose pre-commit runs the build
const LEFTHOOK = readFileSync(join(import.meta.dir, "../../../lefthook.yml"), "utf8")
// A machine whose fake git fails on a `-C` folder that is not one, answers `git rev-parse --show-toplevel` with its folder, which holds `lefthook` unless it is null, `git diff --cached --name-only` with `staged`, a plain `git diff --name-only` with `unstaged`, a `git diff --name-only HEAD -- <paths>` with each of either under one of the paths, and touches its last argument for anything else, as a commit's marker
const repo = (
  setup: Setup,
  staged: string[],
  unstaged: string[] = [],
  lefthook: string | null = LEFTHOOK,
) => {
  const m = machine(setup)
  if (lefthook !== null) writeFileSync(join(m.root, "lefthook.yml"), lefthook)
  writeFileSync(
    join(m.bin, "git"),
    `#!/bin/bash
[ "$1" = -C ] && { [ -d "$2" ] || exit 128; }
case " $* " in *" rev-parse --show-toplevel "*) [ "$1" = -C ] && cd "$2"; pwd; exit 0 ;; esac
for a in "$@"; do
  [ "$a" = diff ] || continue
  case " $* " in
    *" --cached "*) printf '%s\\n' ${staged.join(" ")} ;;
    *" -- "*) while [ "$1" != -- ]; do shift; done; shift
      for f in ${[...staged, ...unstaged].join(" ")}; do for p in "$@"; do case "$f" in "$p"|"$p"/*) echo "$f" ;; esac; done; done ;;
    *) printf '%s\\n' ${unstaged.join(" ")} ;;
  esac
  exit 0
done
touch "\${@: -1}"
`,
  )
  chmodSync(join(m.bin, "git"), 0o755)
  return m
}
// a pre-commit step as commit-slot.ts hands it to run-slot, its last word the step's name (sh's $0), touching the marker the fake appends
const step = (name: string) => ["sh", "-c", 'touch "$1"', name]
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
    expect(await m.runs("ops-checks-1", { RUN_SLOT_SIZE: "medium" })).toBe(true)
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

  // lefthook skips its build only when every staged file is Markdown or a Python test under tests/, and a README feeds @web/next#build's hash
  test("staging Markdown under api/hono beside a file outside the build trees waits as a big run too", async () => {
    const m = repo({ idle: 30 }, ["api/hono/README.md", "scripts/ops/run-slot.sh"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
  })

  test("staging a Python file under packages waits as a big run, since lefthook skips only tests/'s", async () => {
    const m = repo({ idle: 30 }, ["packages/scripts/src/tool.py"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
  })

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
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
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

  test("git commit <folder> counts a build file git finds under the folder it names", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["packages/env/src/data-dir.ts"])
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "commit", "-m", "x", "packages"]).waits(),
    ).toBe(true)
  })

  test("git commit -uno reads its n as the untracked mode, not -n, and still counts a staged web/next file", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "commit", "-uno", "-m", "x"]).waits(),
    ).toBe(true)
  })

  test("commit-slot.ts's build for a worktree staging a web/next file counts as big", async () => {
    const m = repo({}, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.start("commit-wt", {}, undefined, step("build")).waits()).toBe(true)
  })

  // commit-slot.ts also runs a staged tree's type check as commit-<worktree>, which builds nothing
  test("commit-slot.ts's type check for that worktree keeps its own size", async () => {
    const m = repo({}, ["packages/scripts/src/x.ts"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.start("commit-wt", {}, undefined, step("check-types")).ran()).toBe(true)
  })

  // commit-slot.ts marks each step it hands run-slot RUN_SLOT_COMMIT_STEP=1, which sends it to run-slot-commit, but for a build that runs next build
  test("commit-slot.ts's marked build for it still waits as a big run, off run-slot-commit", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    const run = m.start("commit-wt", { RUN_SLOT_COMMIT_STEP: "1" }, undefined, step("build"))
    expect(await run.waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  test("while its marked type check takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m
        .start("commit-wt", { RUN_SLOT_COMMIT_STEP: "1" }, undefined, step("check-types"))
        .ran(),
    ).toBe(true)
    expect(log(m)).toMatch(/ start commit-wt \d+ run-slot-commit waited=/)
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

  test("nor does git commit -S<keyid> whose key id holds an a, which reads no -a", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "commit", "-Sabc", "-m", "x"]).ran(),
    ).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  // lefthook's build step skips a commit whose every staged file is Markdown or a Python test under tests/, so it runs no next build
  test("nor does one staging only Markdown under api/hono and packages", async () => {
    const m = repo({ idle: 30 }, ["api/hono/README.md", "packages/env/README.md"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("and commit-slot.ts's build for it stays small", async () => {
    const m = repo({}, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.start("commit-wt", {}, undefined, step("build")).ran()).toBe(true)
  })
})

// the dispatcher, 4 Nov: a commit in another repo, whose pre-commit ran lint-staged and commitlint with no build, sat 65 minutes in the big-run queue for a 1-second job
describe("a commit in a repo whose lefthook.yml pre-commit runs no build", () => {
  const OTHER = `pre-commit:
  commands:
    lint-staged:
      run: bunx lint-staged
pre-push:
  commands:
    build:
      run: bun run build
commit-msg:
  commands:
    commitlint:
      run: bunx commitlint --edit {1}
`
  test("takes run-slot-commit at once with a web/next file staged, beside a big run", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx", "packages/env/src/x.ts"], [], OTHER)
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("while one whose pre-commit lists its build as a quoted job still waits as a big run", async () => {
    const jobs = `pre-commit:\n  jobs:\n    - run: "bun run build"\n`
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"], [], jobs)
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
  })

  test("but one in a repo with no lefthook.yml takes run-slot-commit at once too", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"], [], null)
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })
})
