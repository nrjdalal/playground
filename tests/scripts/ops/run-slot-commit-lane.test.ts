import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, type Setup, stop, WAITING } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// Playground's own lefthook.yml, whose pre-commit runs the build
const LEFTHOOK = readFileSync(join(import.meta.dir, "../../../lefthook.yml"), "utf8")
// A machine whose fake git fails on a `-C` folder that is not one, answers `git config --get alias.<verb>` from a folder whose top level is the root by whether the root's `aliases` file lists that key, answers `git rev-parse --show-toplevel` with its folder's physical path, as git does (the root's, from `docs`, `web` or a folder under it), which holds `lefthook` unless it is null, `git diff --cached --name-only` with `staged`, a plain `git diff --name-only` with `unstaged`, a `git diff --name-only [HEAD] -- <paths>` with each of either under one of the paths (each pathspec read from the `-C` folder, `.` included), `git ls-files --others` with `untracked` (under the paths after a `--`, relative to a `-C` folder under the root unless `--full-name`, every one for `:/`, as git prints them), and touches its last argument for anything else, as a commit's marker
const repo = (
  setup: Setup,
  staged: string[],
  unstaged: string[] = [],
  lefthook: string | null = LEFTHOOK,
  untracked: string[] = [],
) => {
  const m = machine(setup)
  if (lefthook !== null) writeFileSync(join(m.root, "lefthook.yml"), lefthook)
  writeFileSync(
    join(m.bin, "git"),
    `#!/bin/bash
[ "$1" = -C ] && { [ -d "$2" ] || exit 128; }
d=$PWD; [ "$1" = -C ] && d=$2
top() { (case "$1" in ${m.root}/web | ${m.root}/web/* | ${m.root}/docs) cd ${m.root} ;; *) cd "$1" ;; esac; pwd -P); }
case " $* " in *" config --get "*) [ "$(top "$d")" = "$(top ${m.root})" ] && grep -qxF -- "\${@: -1}" ${m.root}/aliases 2>/dev/null; exit ;; esac
case " $* " in *" rev-parse --show-toplevel "*) top "$d"; exit 0 ;; esac
pre=""; case "$d" in ${m.root}/*) pre=\${d#${m.root}/}/ ;; esac
full=""; case " $* " in *" --full-name "*) full=1 ;; esac
case " $* " in *" :/ "*) pre="" ;; esac
# whether path $2 is under pathspec $1, read from the folder, as git reads one
under() { local q=$pre$1; [ "$1" = . ] && q=\${pre%/}; [ -z "$q" ] || case "$2" in "$q" | "$q"/*) ;; *) return 1 ;; esac; }
case " $* " in
  *" ls-files "*" -- "*) while [ "$1" != -- ]; do shift; done; shift
    for f in ${untracked.join(" ")}; do for p in "$@"; do under "$p" "$f" && { [ -n "$full" ] && echo "$f" || echo "\${f#"$pre"}"; }; done; done; exit 0 ;;
  *" ls-files "*) for f in ${untracked.join(" ")}; do case "$f" in "$pre"*) [ -n "$full" ] && echo "$f" || echo "\${f#"$pre"}" ;; esac; done; exit 0 ;;
esac
for a in "$@"; do
  [ "$a" = diff ] || continue
  case " $* " in
    *" --cached "*) printf '%s\\n' ${staged.join(" ")} ;;
    *" -- "*) while [ "$1" != -- ]; do shift; done; shift
      for f in ${[...staged, ...unstaged].join(" ")}; do for p in "$@"; do under "$p" "$f" && echo "$f"; done; done ;;
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
// a fake bun whose `turbo run build --dry=json` reads every task with the cache status given, or fails for null, passing anything else to the machine's own
const turbo = (m: ReturnType<typeof machine>, status: string | null) => {
  renameSync(join(m.bin, "bun"), join(m.bin, "bun-machine"))
  const dry =
    status === null
      ? "exit 1"
      : `echo '{"tasks":[{"command":"next build","cache":{"status":"HIT"}},{"command":"tsc","cache":{"status":"${status}"}}]}'; exit 0`
  writeFileSync(
    join(m.bin, "bun"),
    `#!/bin/bash\ncase " $* " in *" turbo run build --dry=json "*) ${dry} ;; esac\nexec ${join(m.bin, "bun-machine")} "$@"\n`,
  )
  chmodSync(join(m.bin, "bun"), 0o755)
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

  test("git commit --pathspec-from-file counts a web/next file it may commit", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    const argv = [
      "git",
      "-C",
      m.root,
      "commit",
      "-m",
      "x",
      `--pathspec-from-file=${m.root}/list.txt`,
    ]
    expect(await m.start("worker-x", {}, undefined, argv).waits()).toBe(true)
  })

  // builder, 5 Nov: the commit lane fails closed, so a flag run-slot does not read counts as a build, even beside Markdown alone
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

  // review round 11: --work-tree's value is not the verb, so the commit after it is still read
  test("git --work-tree <dir> commit -am counts the web/next file it stages", async () => {
    const m = repo({ idle: 30 }, [], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    const argv = ["git", "--work-tree", m.root, "commit", "-am", "x"]
    expect(await m.start("worker-x", {}, undefined, argv).waits()).toBe(true)
  })

  // review round 12: an env word other than NODE_ENV or RUN_SLOT_HERE, such as GIT_DIR, can point git at another repo
  test("env GIT_DIR=<repo> git -C <docs> commit counts as a build", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    mkdirSync(join(m.root, "docs"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const argv = [
      "env",
      `GIT_DIR=${m.root}/.git`,
      "git",
      "-C",
      `${m.root}/docs`,
      "commit",
      "-m",
      "x",
    ]
    expect(await m.start("worker-x", {}, undefined, argv).waits()).toBe(true)
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

// 4 Nov: a commit inside a sh -c chain counts as the bare commit would, so one that runs next build still waits as a big run
// builder, 5 Nov: three review rounds each found one more form that a reading of cd, ~ or env let through, so a chain takes the commit lane only when every step is a form on a closed list, and any other form in a chain that commits counts as a build; a chain starts outside the repo unless it is given the repo, where a bare git step runs in run-slot's own folder
describe("a sh -c chain of git steps", () => {
  const start = (m: ReturnType<typeof repo>, steps: string, inRepo = false) => {
    const outside = join(m.root, "outside")
    mkdirSync(outside, { recursive: true })
    return m.start(
      "worker-x",
      {},
      undefined,
      ["sh", "-c", steps.replaceAll("ROOT", m.root)],
      inRepo ? m.root : outside,
    )
  }
  // the lane a chain on the closed list takes, read from its start line once it has run
  const lane = async (m: ReturnType<typeof repo>, steps: string, inRepo = false) => {
    await start(m, steps, inRepo).p.exited
    return log(m).match(/ start worker-x \d+ (\S+) waited=/)?.[1]
  }

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

  // builder, 5 Nov: a bare git step runs in run-slot's own folder, so the chain the issue names takes the commit lane from inside the repo
  test("a chain of bare git steps run from the repo takes run-slot-commit beside a big run", async () => {
    const steps = "git add . && git commit -m x && git push origin"
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, steps, true)).toBe("run-slot-commit")
  })

  // the first three rows are the forms review round 3 measured slipping through
  for (const steps of [
    "cd ~ && git add . && git commit -m x",
    "cd $HOME && git add . && git commit -m x",
    "cd ROOT && env A=1 git add . && env A=1 git commit -m x",
    "cd .. && git commit -m x",
    "cd - && git commit -m x",
    "cd `echo ROOT` && git commit -m x",
    "git -c user.name=x -C ROOT commit -m x",
    "cd ROOT && bun run test && git commit -m x",
    // review round 5: a # that sh reads as a comment, and a brace sh expands
    "cd ROOT && git commit -m z#1 && bun run build",
    "cd ROOT && git add . && git commit -m x\n# c\nbun run build",
    "cd ROOT && git add web/next/src/app/{a,b}.tsx && git commit -m x",
    // review round 5: a process substitution runs its command
    "cd ROOT && git add <(bun run build) && git commit -m x",
    "cd ROOT && git commit -m x <(bun run build)",
    "cd ROOT && git commit -m x>(bun run build)",
    "(bun run build) && cd ROOT && git commit -m x",
    // zsh runs the command after |& or &|
    "cd ROOT && git commit -m x |& bun run build",
    "cd ROOT && git commit -m x &| bun run build",
    // builder, 5 Nov: a git add flag outside the list, such as -f, which stages ignored files
    "cd ROOT && git add -f docs/notes.md && git commit -m x",
    // review round 10: an add option cluster
    "cd ROOT && git add -Av && git commit -m x",
    // review round 7: a cd beside |, &, || or in a subshell does not carry to the next step
    "cd ROOT | git commit -m x",
    "cd ROOT & git commit -m x",
    "(cd ROOT); git commit -m x",
    // review round 1 of the cached-commit change: sh joins a \ line break before it reads a # line as a comment
    "cd ROOT && git commit -m x\\\n#;bun run build",
    // review round 2 of the cached-commit change: a line ending in an even run of \ is not joined, a # line ends at its newline, and set -k reads a later VAR=x as env
    "cd ROOT && git commit -m a\\\\\nbun run build",
    "# note \\\nbun run build\ncd ROOT && git commit -m x",
    "set -k\ncd ROOT && git commit -m x",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
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

// 5 Nov: a `bash <script>` whose only steps were commits was never read, so it queued as a general job; its lines go through the same closed list
describe("a bash script file", () => {
  const COMMITS = [
    "#!/bin/bash",
    "# commit and push the docs",
    "set -euo pipefail",
    "cd ROOT",
    "git add docs/notes.md",
    "git commit -m x",
    "git push origin",
  ]
  const script = (m: ReturnType<typeof repo>, lines: string[]) => {
    const path = join(m.root, "outside", "chain.sh")
    mkdirSync(join(m.root, "outside"), { recursive: true })
    writeFileSync(path, lines.join("\n").replaceAll("ROOT", m.root) + "\n")
    return path
  }

  test("whose every line is on the closed list takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, [], ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    // the fake appends its marker as the script's argument, which only a $ word could read
    await m.start("worker-x", {}, undefined, ["bash", script(m, COMMITS)]).p.exited
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  for (const [what, lines, args] of [
    ["a build step", [...COMMITS.slice(0, 4), "bun run build", ...COMMITS.slice(4)], []],
    ["a variable", ["S=x", ...COMMITS], []],
    ["a set that sets arguments", ["set -- a", ...COMMITS], []],
    ["a comment after a step", [...COMMITS, "git push origin # done"], []],
    [
      "a line break into a # line",
      [...COMMITS.slice(0, 5), "git commit -m x\\", "#;bun run build", ...COMMITS.slice(6)],
      [],
    ],
    [
      "an even run of \\ before a line break",
      [...COMMITS.slice(0, 5), "git commit -m a\\\\", "bun run build", ...COMMITS.slice(6)],
      [],
    ],
    [
      "a # line ending in \\",
      [...COMMITS.slice(0, 5), "# note \\", "bun run build", ...COMMITS.slice(5)],
      [],
    ],
    ["a set -k", ["set -k", ...COMMITS], []],
  ] as const)
    test(`with ${what} waits and never takes run-slot-commit`, async () => {
      const m = repo({ idle: 30 }, [], ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(
        await m.start("worker-x", {}, undefined, ["bash", script(m, [...lines]), ...args]).waits(),
      ).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })

  // bash runs the file after an option's argument, so a listed script named as --rcfile's argument must not stand in for it
  test("named after an option word waits and never takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, [], ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const safe = script(m, COMMITS)
    expect(await m.start("worker-x", {}, undefined, ["bash", "--rcfile", safe, safe]).waits()).toBe(
      true,
    )
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // a script's commit of a web/next file follows the cached-build rule, as a lone commit does
  const NEXT = [...COMMITS.slice(0, 4), "git add web/next/src/app/page.tsx", ...COMMITS.slice(5)]
  test("that commits a web/next file turbo replays from its cache takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, [], ["web/next/src/app/page.tsx"])
    turbo(m, "HIT")
    m.hold("run-slot", 3, "big")
    await m.start("worker-x", {}, undefined, ["bash", script(m, NEXT)]).p.exited
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("that commits a web/next file with one task to build waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], ["web/next/src/app/page.tsx"])
    turbo(m, "MISS")
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["bash", script(m, NEXT)]).waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })
})

// 5 Nov: forms that read heavier than they cost, each waiting on canary before this change, and the forms beside them that still count as a build
describe("commit-lane forms that cost no build", () => {
  const outside = (m: ReturnType<typeof repo>) => {
    mkdirSync(join(m.root, "outside"), { recursive: true })
    return join(m.root, "outside")
  }
  // the lane a run takes, read from its start line, or "waited" once it prints a waiting line, when it is stopped
  const takes = async (
    m: ReturnType<typeof repo>,
    argv: string[],
    cwd = outside(m),
    extra: Record<string, string> = {},
  ) => {
    const run = m.start("worker-x", extra, undefined, argv, cwd)
    if (await run.saw(WAITING)) {
      await stop(run.p)
      return "waited"
    }
    return log(m).match(/ start worker-x \d+ (\S+) waited=/)?.[1]
  }
  const chain = (m: ReturnType<typeof repo>, steps: string, shell = "sh") => [
    shell,
    "-c",
    steps.replaceAll("ROOT", m.root),
  ]
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
      [PAGE],
      [],
    ],
    [
      "git add --dry-run of a web/next file",
      `cd ROOT && git add --dry-run ${PAGE} && git commit -m x`,
      [],
      [PAGE],
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
      [PAGE],
      [],
    ],
  ] as const)
    test(`a chain with ${what} takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, [...staged], [...unstaged], LEFTHOOK, [...untracked])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, chain(m, steps))).toBe("run-slot-commit")
    })

  for (const [what, steps, unstaged, untracked] of [
    [
      "git add -u of a tracked web/next change",
      "cd ROOT && git add -u && git commit -m x",
      [PAGE],
      [],
    ],
    [
      "git add -p of a web/next file",
      `cd ROOT && git add -p ${PAGE} && git commit -m x`,
      [PAGE],
      [],
    ],
    [
      "git add -N of an untracked web/next file",
      "cd ROOT && git add -N web/next/src/app/new.tsx && git commit -m x",
      [],
      ["web/next/src/app/new.tsx"],
    ],
    [
      "git add --pathspec-from-file <f> with a web/next change",
      "cd ROOT && git add --pathspec-from-file list.txt && git commit -m x",
      [PAGE],
      [],
    ],
    // 8: an option after -c other than -e, -u, -x, -v or -o pipefail reads no steps
    ["bash -c -O <opt>", "-O", [], []],
    // 13: a glued a(b) splits at its (, and b is off the list
    ["a glued a(b)", "cd ROOT && git commit -m a(b)", [], []],
    // review round 1: an option's value or a word after -- is a path, never a message, so a quoted glob there is off the list
    [
      "git commit --trailer -m <a quoted glob>",
      "cd ROOT && git commit --trailer -m 'web/*'",
      [PAGE],
      [],
    ],
    [
      "git commit --trailer --message <a quoted glob>",
      "cd ROOT && git commit --trailer --message 'web/*'",
      [PAGE],
      [],
    ],
    ["git commit -- -m <a quoted glob>", "cd ROOT && git commit -m x -- -m 'web/*'", [PAGE], []],
    // review round 1: a cd after && may not have run when any later step joined by ; or || does
    [
      "a cd after && whose later step joins by ;",
      "git -C ROOT add docs/notes.md && cd ROOT && git add . ; git commit -m x",
      [],
      [],
    ],
    [
      "a cd after && whose later step joins by ||",
      "bun run precommit:light && cd ROOT && git add . || git commit -m x",
      [],
      [],
    ],
    // review round 1: git add reads every word after -- as a path, -n included
    [
      "git add -- -n <a web/next file>",
      `cd ROOT && git add -- -n ${PAGE} && git commit -m x`,
      [PAGE],
      [],
    ],
  ] as const)
    test(`a chain with ${what} still waits off the commit lane`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"], [...unstaged], LEFTHOOK, [...untracked])
      m.hold("run-slot", 3, "big")
      const argv =
        steps === "-O"
          ? ["bash", "-c", "-O", "extglob", `cd ${m.root} && git commit -m x`]
          : chain(m, steps)
      expect(await takes(m, argv)).toBe("waited")
    })

  // 8: bash -c reads -e, -u, -x, -v and -o pipefail as options before its script, which zsh -c runs as sh does
  for (const argv of [
    ["bash", "-c", "-x", "cd ROOT && git commit -m x"],
    ["bash", "-c", "-eu", "-o", "pipefail", "cd ROOT && git commit -m x"],
    ["zsh", "-c", "cd ROOT && git commit -m x"],
  ])
    test(`${argv.join(" ")} takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(
        await takes(
          m,
          argv.map((a) => a.replaceAll("ROOT", m.root)),
        ),
      ).toBe("run-slot-commit")
    })

  // 13: precommit:light runs the script of the repo it runs in, so after a cd to another repo it is off the list
  test("a chain with bun run precommit:light after a cd to another repo waits", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    mkdirSync(join(m.root, "other"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const steps = "cd ROOT/other && bun run precommit:light && cd ROOT && git commit -m x"
    expect(await takes(m, chain(m, steps), m.root)).toBe("waited")
  })

  test("while one after a cd inside run-slot's own repo takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    mkdirSync(join(m.root, "docs"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const steps = "cd ROOT/docs && bun run precommit:light && git commit -m x"
    expect(await takes(m, chain(m, steps), m.root)).toBe("run-slot-commit")
  })

  // 13: a cd after && that a ; follows may not have run when the commit does
  test("a chain whose cd joins by && and then ; waits", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const steps = "git -C ROOT add docs/notes.md && cd ROOT ; git commit -m x"
    expect(await takes(m, chain(m, steps), m.root)).toBe("waited")
  })

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

  // 7 and 12: beside held commit and clone lanes a medium run starts and a big one waits, so each row reads whether the run counted as a build
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
      expect(await takes(m, chain(m, steps), outside(m), medium)).toBe("waited")
    })

  // review round 2: a verb git does not ship counts as a commit in a chain, whatever config names it, so no alias read can miss one
  for (const steps of [
    "git -c alias.zz=commit zz -m x",
    "git --git-dir ROOT/.git ci -m x",
    "false && cd ROOT ; git ci -m x",
  ])
    test(`a chain with ${steps}, ci and zz in no config, counts as a build`, async () => {
      const m = lanes()
      expect(await takes(m, chain(m, steps), outside(m), medium)).toBe("waited")
    })

  // 13j: git_verb reads past --git-dir to the commit, which chain_safe takes off the list
  test("a chain with git --git-dir <d> commit counts as a build", async () => {
    const m = lanes()
    const steps = "cd ROOT && git --git-dir ROOT/.git commit -m x"
    expect(await takes(m, chain(m, steps), outside(m), medium)).toBe("waited")
  })

  // a chain of git's plumbing reads commits nothing, so it starts as its own size
  for (const steps of [
    "git merge-base HEAD origin/canary && git cat-file -t HEAD",
    "git for-each-ref refs/heads && git merge-base HEAD x",
  ])
    test(`a chain with ${steps} runs as a medium run`, async () => {
      const m = lanes()
      expect(await takes(m, chain(m, steps), outside(m), medium)).toMatch(/^run-slot/)
    })

  // while a plumbing write stays off git_known, so a chain counts it as a commit
  for (const steps of ["git update-ref refs/heads/x HEAD", "git hash-object -w notes.md"])
    test(`a chain with ${steps} counts as a build`, async () => {
      const m = lanes()
      expect(await takes(m, chain(m, steps), outside(m), medium)).toBe("waited")
    })

  test("while git frob, which no alias names, runs as a medium run", async () => {
    const m = lanes("alias.ci\n")
    expect(await takes(m, ["git", "-C", m.root, "frob"], m.root, medium)).toMatch(/^run-slot/)
  })
})
