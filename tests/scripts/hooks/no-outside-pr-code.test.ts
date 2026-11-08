import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import {
  check,
  live,
  type Lookup,
  readMode,
  runnerOf,
} from "../../../scripts/hooks/no-outside-pr-code"

// A made-up machine: every repo, login, session and folder here is invented, and only the live lookup's rows touch a scratch folder.
// HOME is this machine's own, since the shell reader expands a ~ by it
const HOME = homedir()
const MAIN = "/m/pg"
const TREES = `${MAIN}/.claude/worktrees`
const OUTSIDE = `${TREES}/review-501`
const INSTALLED = `${TREES}/review-505`
// a folder the PR ships with a bare repository's shape, whose config git would read
const EMBEDDED = `${OUTSIDE}/emb`
const SKILLS = `${HOME}/.playground/orgs/home/abc123/skills`
const STATE = `${SKILLS}/code-review-loop/scripts/state.ts`
const CORE_STATE = `${MAIN}/extensions/core/skills/code-review-loop/scripts/state.ts`
const SLOT = `${HOME}/.playground/ops/run-slot.sh`

const pull = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`
const PRS: Record<string, { author: string; owner: string; ownerType: string }> = {
  "acme-org/tools#504": { author: "colleague-dev", owner: "acme-org", ownerType: "Organization" },
  "acme-owner/widgets#501": { author: "ext-dev", owner: "acme-owner", ownerType: "User" },
  "acme-owner/widgets#502": { author: "acme-owner", owner: "acme-owner", ownerType: "User" },
}
const SESSIONS: Record<string, string[]> = {
  "s-issue": ["https://github.com/acme-owner/widgets/issues/77"],
  "s-mixed": [pull("acme-owner/widgets", 502), pull("acme-owner/widgets", 501)],
  "s-none": [],
  "s-org": [pull("acme-org/tools", 504)],
  "s-out": [pull("acme-owner/widgets", 501)],
  "s-own": [pull("acme-owner/widgets", 502)],
  "s-unread": [pull("acme-owner/widgets", 509)],
}

const HELD: Record<string, string[]> = {
  [MAIN]: [".git"],
  [EMBEDDED]: ["HEAD", "objects", "refs"],
  [INSTALLED]: [".git", "node_modules"],
  [OUTSIDE]: [".git", "bunfig.toml"],
}

const RUNNERS: Record<string, string> = { ".mjs": "node", ".py": "python3", ".ts": "bun" }
// made-up skill scripts whose first line is read by runnerOf itself, for the env shapes it reads as a word other than the program
const SHAPES = `${SKILLS}/shapes/scripts`
const SHEBANGS: Record<string, string> = {
  [`${SHAPES}/canary`]: "#!/usr/bin/env bun-canary",
  [`${SHAPES}/double-quoted`]: '#!/usr/bin/env -S "bun" --smol',
  [`${SHAPES}/glued-assignment`]: "#!/usr/bin/env -SFOO=1 bun",
  [`${SHAPES}/glued-option`]: "#!/usr/bin/env -S-i bun",
  [`${SHAPES}/glued-quoted`]: "#!/usr/bin/env -S'bun'",
  [`${SHAPES}/no-shebang`]: "console.log(1)",
  [`${SHAPES}/python`]: "#!/usr/bin/env python3",
  [`${SHAPES}/shell`]: "#!/bin/sh",
}

const lookup: Lookup = {
  author: async (repo, pr) => PRS[`${repo}#${pr}`],
  holds: (folder, entry) => HELD[folder]?.includes(entry) ?? false,
  main: MAIN,
  prsOf: async (sessionId) => SESSIONS[String(sessionId)] ?? [],
  // each made-up script's shebang by its extension, as a skill's scripts name theirs
  runner: (script) =>
    script in SHEBANGS
      ? runnerOf(SHEBANGS[script])
      : RUNNERS[script.slice(script.lastIndexOf("."))],
}

const call = (
  command: string,
  cwd = MAIN,
  session = "s-out",
  tool = "Bash",
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({ cwd, session_id: session, tool_input: { command }, tool_name: tool, ...extra })

const as = (role: string) => ({ HOME, PATH: "/usr/bin:/bin", PLAYGROUND_ROLE: role })

const judge = (raw: string, role = "reviewer") => check(raw, as(role), lookup)

describe("no-outside-pr-code keeps a checker of an outside author's PR in read mode", () => {
  test.each([
    ["a test run in the clone", call("bun test", OUTSIDE)],
    ["a cd into the clone, then a build", call("cd .claude/worktrees/review-501 && bun run build")],
    ["bun's --cwd into the clone", call(`bun --cwd ${OUTSIDE} test`)],
    ["a shell's -c script that enters the clone", call(`bash -c "cd ${OUTSIDE} && make"`)],
    ["the clone's file piped into an interpreter", call(`cat ${OUTSIDE}/x.ts | bun -`)],
    ["node on the clone's script", call(`node ${OUTSIDE}/scripts/x.js`)],
    ["an install, whose scripts the PR holds", call("bun install", OUTSIDE)],
    ["a test run through run-slot", call(`${SLOT} m4k7pq-reviewer -- bun run test:file x.test.ts`)],
    [
      "a file outside the clone that imports it",
      call("bun --no-env-file --no-install /s/probe.ts"),
    ],
    ["a test file outside the clone", call("bun run test:file /s/x.test.ts")],
    ["a shell script outside the clone", call("bash /s/run.sh")],
    ["a test run in the folder that holds the clone", call("bun test", TREES)],
    ["a cd into that folder, then a test run", call(`cd ${TREES} && bun test`)],
    ["the clone named in another case", call(`cd ${TREES}/REVIEW-501 && bun test`)],
    ["find's -exec", call(`find ${MAIN}/.Claude -name x -exec bun {} ;`)],
    ["a wrapper's program", call("env bun test")],
    ["xargs' program", call("ls | xargs bun")],
    ["a program the PR names cat", call("./cat package.json", OUTSIDE)],
    ["a PATH set on the command", call(`PATH=${OUTSIDE}/bin cat x`)],
    ["a PATH set before the command", call(`PATH=${OUTSIDE}/bin; cat x`)],
    ["a BASH_ENV set on a skill's script", call(`BASH_ENV=${OUTSIDE}/x.sh bash ${STATE}`)],
    ["a substitution that runs a test", call("echo $(bun test)")],
    ["an eval of a test run", call(`eval "bun test"`)],
    ["a source of a file", call(`source ${OUTSIDE}/x.sh`)],
    ["make", call("make", OUTSIDE)],
    ["npx", call("npx vitest", OUTSIDE)],
    ["a checkout in a clone with node_modules", call(`git -C ${INSTALLED} checkout --detach abc`)],
    [
      "a checkout with an option of git's own",
      call(`git -c core.hooksPath=/x -C ${OUTSIDE} checkout --detach abc`),
    ],
    ["gh's checkout, which runs the folder's git hooks", call("gh pr checkout 501")],
    ["a fetch with an upload pack", call(`git -C ${OUTSIDE} fetch --upload-pack=/x origin`)],
    ["a clone through a remote helper", call("git clone ext::sh /m/x")],
    [
      "a clone with an option",
      call("git clone --config core.hooksPath=/x https://github.com/a/b /m/x"),
    ],
    ["python on a script outside a skill", call("python3 /s/x.py")],
    [
      "bun on a skill's script, since bun reads the folder's bunfig.toml",
      call(`bun ${SKILLS}/x/y.ts`),
    ],
    [
      "a bun skill script by its path in a clone that holds a bunfig.toml",
      call(`${SKILLS}/code-review-loop/scripts/state.ts pr 501`, OUTSIDE),
    ],
    [
      "a bun core skill script by its path in a subfolder of that clone",
      call(
        `${MAIN}/extensions/core/skills/code-review-loop/scripts/state.ts pr 501`,
        `${OUTSIDE}/src`,
      ),
    ],
    [
      "a bun skill script by its path from a folder the hook cannot read",
      call(`${SKILLS}/code-review-loop/scripts/state.ts pr 501`, "review-501"),
    ],
    [
      "a bun skill script by its path from a scratch folder outside every work tree",
      call(`${SKILLS}/code-review-loop/scripts/state.ts pr 501`, "/s/scratch"),
    ],
    [
      "a bun skill script by its path from a clone inside the main checkout",
      call(`${SKILLS}/code-review-loop/scripts/state.ts pr 501`, INSTALLED),
    ],
    ["a bun-canary skill script by its path in a clone", call(`${SHAPES}/canary`, OUTSIDE)],
    ["a skill script whose env -S quotes bun in a clone", call(`${SHAPES}/double-quoted`, OUTSIDE)],
    [
      "a skill script whose env -S glues an assignment before bun in a clone",
      call(`${SHAPES}/glued-assignment`, OUTSIDE),
    ],
    [
      "a skill script whose env -S glues an option before bun in a clone",
      call(`${SHAPES}/glued-option`, OUTSIDE),
    ],
    [
      "a skill script whose env -S glues a quoted bun in a clone",
      call(`${SHAPES}/glued-quoted`, OUTSIDE),
    ],
    [
      "the playground command in a folder with the PR's bunfig.toml",
      call("playground rules clock", OUTSIDE),
    ],
    ["a shell's -c script that runs a test", call(`bash -c "bun test"`)],
    ["a shell fed its script on stdin", call(`cat ${OUTSIDE}/x.sh | bash`)],
    ["an interpreter fed its script on stdin", call("python3 - <<'EOF'\nimport x\nEOF")],
    [
      "a skill's path inside the clone",
      call(`python3 ${OUTSIDE}/extensions/core/skills/x/scripts/s.py`),
    ],
    ["sed with a script that runs a command", call(`sed -n -e '1e bun test' ${OUTSIDE}/a.ts`)],
    ["git grep's pager", call(`git -C ${OUTSIDE} grep -O/bin/sh foo`)],
    ["sed's substitution that writes a file", call(`sed 's/a/b/w /x' ${OUTSIDE}/a.ts`)],
    [
      "git ls-remote, whose upload pack runs a program",
      call("git ls-remote --upload-pack=/x origin"),
    ],
    ["a loop that sets PATH", call(`for PATH in ${OUTSIDE}/bin; do cat x; done`)],
    ["a read that sets PATH", call(`echo ${OUTSIDE}/bin | read PATH; cat x`)],
    ["a run-slot copy at another path", call(`${OUTSIDE}/run-slot.sh m4k7pq-reviewer -- cat x`)],
    ["a Monitor watch of the PR's tests", call("bun test --watch", OUTSIDE, "s-out", "Monitor")],
    [
      "a sub-agent's call, which carries its parent's session",
      call("bun test", OUTSIDE, "s-out", "Bash", { agent_id: "a-1" }),
    ],
    [
      "gh's clone handing git the PR's hooks folder",
      call(`gh repo clone acme-owner/widgets /m/x -- -c core.hooksPath=${OUTSIDE}/.githooks`),
    ],
    [
      "gh's fork clone handing git an option",
      call(`gh repo fork acme-owner/widgets --clone -- -c core.hooksPath=${OUTSIDE}/.githooks`),
    ],
    [
      "python on a path that climbs out of the data folder's orgs",
      call(`python3 ${HOME}/.playground/orgs/../../../tmp/s/skills/p.py`),
    ],
    [
      "a program whose path climbs out of the main checkout's extensions",
      call(`${MAIN}/extensions/../../../tmp/s/skills/p.py`),
    ],
    ["a git read in a bare repo the PR ships", call(`git -C ${EMBEDDED} diff HEAD~1 HEAD`)],
    ["a git read below that bare repo", call("git diff HEAD~1 HEAD", `${EMBEDDED}/refs`)],
    [
      "git's own -c reopening bare repos",
      call(`git -c safe.bareRepository=all -C ${EMBEDDED} diff`),
    ],
    ["git's --git-dir naming that bare repo", call(`git --git-dir=${EMBEDDED} diff HEAD~1 HEAD`)],
    ["git's --work-tree", call(`git --work-tree=${OUTSIDE} --git-dir=${EMBEDDED} log`)],
    ["a GIT_DIR prefix", call(`GIT_DIR=${EMBEDDED} git log`)],
    ["a GIT_WORK_TREE prefix", call(`GIT_WORK_TREE=${OUTSIDE} git diff`, OUTSIDE)],
    ["a second -C", call(`git -C ${OUTSIDE} -C emb diff`)],
    [
      "playground add, which starts a session no read mode holds",
      call("playground add --brief /s/brief-x.md"),
    ],
    ["a manager verb of the playground command", call("playground builder")],
    ["gh's own alias for a PR's checkout", call("gh pr co 501")],
    ["gh's checkout after a flag", call("gh pr -R acme-owner/widgets checkout 501")],
    ["gh's issue develop with a checkout", call("gh issue develop 501 --checkout")],
    [
      "git grep's pager by an abbreviated option",
      call(`git -C ${OUTSIDE} grep --open="touch X; true" needle`),
    ],
    ["git log's output file by an abbreviated option", call(`git -C ${OUTSIDE} log --out=/x`)],
    ["git grep's pager in a cluster of short flags", call(`git -C ${OUTSIDE} grep -iO/bin/sh foo`)],
    ["a fetch from a relative path the PR ships", call("git fetch ./evil", OUTSIDE)],
    ["a fetch from an absolute path", call(`git -C ${OUTSIDE} fetch /abs/evil pull/1/head`)],
    ["a remote added at a path", call(`git -C ${OUTSIDE} remote add x ./evil`)],
    [
      "a fetch whose upload pack runs a program",
      call(`git -C ${OUTSIDE} fetch --upload-pack=/x origin`),
    ],
    [
      "a fetch that follows the PR's submodules",
      call(`git -C ${OUTSIDE} fetch --recurse-submodules origin`),
    ],
    [
      "a detached checkout from below an installed clone's root",
      call(`git -C ${INSTALLED}/src checkout --detach abc`),
    ],
  ])("%s", async (_, raw) => {
    expect(await judge(raw)).toContain("no-outside-pr-code")
  })

  test("a tester's run of the PR's stack", async () => {
    expect(await judge(call("bun run dev", OUTSIDE), "tester")).toContain("no-outside-pr-code")
  })

  test("the reason names the reads to use and the checks to score on", async () => {
    const reason = await judge(call("bun test", OUTSIDE))
    expect(reason).toContain("git show")
    expect(reason).toContain("GitHub checks")
  })
})

describe("no-outside-pr-code lets read mode read, fetch and post", () => {
  test.each([
    ["git diff in the clone", call(`git -C ${OUTSIDE} diff origin/canary...HEAD`)],
    ["git show of a file at a rev", call(`git -C ${OUTSIDE} show abc:package.json`)],
    ["git log", call(`git -C ${OUTSIDE} log --oneline -5`)],
    ["gh pr diff", call("gh pr diff 501 --repo acme-owner/widgets")],
    ["gh pr view", call("gh pr view 501 --repo acme-owner/widgets --json headRefOid")],
    ["a review posted with gh", call("gh pr review 501 --comment --body-file /s/r.md")],
    ["gh api", call("gh api repos/acme-owner/widgets/pulls/501/comments")],
    ["a fetch of the PR's head", call(`git -C ${OUTSIDE} fetch origin pull/501/head`)],
    [
      "a detached checkout in a clone with no node_modules",
      call(`git -C ${OUTSIDE} checkout --detach abc`),
    ],
    ["a detached switch", call(`git -C ${OUTSIDE} switch --detach abc`)],
    ["the brief's worktree add", call(`git -C ${MAIN} worktree add --detach ${OUTSIDE} abc`)],
    [
      "the brief's fresh clone",
      call(`git clone https://github.com/acme-owner/widgets.git ${TREES}/review-widgets-503`),
    ],
    ["gh's clone", call(`gh repo clone acme-owner/widgets ${TREES}/review-widgets-503`)],
    ["the review skill's state.ts run by its path, shebang and all", call(`${STATE} pr 501`)],
    ["a read through run-slot", call(`${SLOT} m4k7pq-reviewer -- git -C ${OUTSIDE} diff`)],
    [
      "a read through run-slot by ~",
      call(`~/.playground/ops/run-slot.sh m4k7pq-reviewer -- cat x`),
    ],
    ["a file piped into jq", call(`cat ${OUTSIDE}/package.json | jq .scripts`)],
    ["grep over the clone", call(`grep -rn foo ${OUTSIDE}/src`)],
    ["a variable of the line's own", call(`S=${OUTSIDE}; cat $S/x`)],
    ["the clock", call("date -u +%FT%TZ")],
    [
      "a bun skill script by its path from the main checkout",
      call(`${SKILLS}/code-review-loop/scripts/state.ts pr 501`),
    ],
    [
      "a bun skill script by its path from a folder in the main checkout's tree",
      call(`${SKILLS}/code-review-loop/scripts/state.ts pr 501`, `${MAIN}/docs`),
    ],
    [
      "a python skill script by its path in a clone with a bunfig.toml",
      call(`${SHAPES}/python`, OUTSIDE),
    ],
    ["a sh skill script by its path in a clone", call(`${SHAPES}/shell`, OUTSIDE)],
    ["a skill script with no shebang in a clone", call(`${SHAPES}/no-shebang`, OUTSIDE)],
    ["a glued -S skill script from the main checkout", call(`${SHAPES}/glued-assignment`)],
    [
      "the review skill's state.ts from the main checkout, run by its path",
      call(`${CORE_STATE} wait acme-owner/widgets 501 abc`),
    ],
    ["a quiet fetch of two refs", call(`git -C ${OUTSIDE} fetch -q origin pr-501 canary`)],
    ["a quiet detached checkout", call(`git -C ${OUTSIDE} checkout -q --detach abc`)],
    ["sed printing a line range", call(`sed -n 222,300p ${OUTSIDE}/a.ts`)],
    [
      "sed printing a pattern range",
      call("gh pr view 501 --json body --jq .body | sed -n '/## Evidence/,/## Merge Danger/p'"),
    ],
    ["sed's plain substitution", call("gh run view 9 --log | sed 's/\\x1b\\[[0-9;]*m//g' | head")],
    [
      "git's merge-base into a variable",
      call(
        `MB=$(git -C ${OUTSIDE} merge-base origin/canary HEAD); git -C ${OUTSIDE} diff --stat $MB HEAD`,
      ),
    ],
    ["git's worktree list", call(`git -C ${MAIN} worktree list`)],
    [
      "git ls-tree and cat-file",
      call(`git -C ${OUTSIDE} ls-tree -r --name-only HEAD && git -C ${OUTSIDE} cat-file -p HEAD`),
    ],
    ["a shell's -c script of reads", call(`bash -c "cat ${OUTSIDE}/a.ts | wc -l"`)],
    [
      "a loop that polls GitHub until a check ends",
      call('for i in 1 2; do sleep 1; c=$(gh api x --jq .a); [ "$c" = done ] && break; done'),
    ],
    ["a case on a read", call("case $(git -C /m/x rev-parse HEAD) in abc) echo same;; esac")],
    ["a loop of reads", call(`for f in a b; do cat ${OUTSIDE}/$f; done | head -40`)],
    ["the playground command", call("playground rules clock")],
    ["playground's skill lookup", call("playground ext which triage-and-implement")],
    ["a git read in the clone's own folder", call("git diff HEAD~1 HEAD", OUTSIDE)],
    ["git log's one-line form", call(`git -C ${OUTSIDE} log --oneline -5`)],
    ["git diff's --text", call(`git -C ${OUTSIDE} diff --text HEAD~1 HEAD`)],
    ["git log's pickaxe holding an O", call(`git -C ${OUTSIDE} log -SfOo`)],
    ["git grep's pattern holding an O", call(`git -C ${OUTSIDE} grep -eFOO`)],
    ["a fetch of every remote, pruned", call(`git -C ${OUTSIDE} fetch --all -p`)],
    [
      "a fetch with -p, a depth and the PR's ref",
      call(`git -C ${OUTSIDE} fetch -p --depth=50 origin pull/501/head`),
    ],
    ["a remote's URL", call(`git -C ${OUTSIDE} remote get-url origin`)],
    [
      "a fetch from the PR's GitHub URL",
      call(`git -C ${OUTSIDE} fetch https://github.com/acme-owner/widgets.git pull/501/head`),
    ],
    ["ls and wc", call(`ls ${OUTSIDE} && wc -l ${OUTSIDE}/a.ts`)],
  ])("%s", async (_, raw) => {
    expect(await judge(raw)).toBeUndefined()
  })

  test("a tool other than Bash and Monitor", async () => {
    expect(await judge(call("bun test", OUTSIDE, "s-out", "Read"))).toBeUndefined()
  })
})

describe("no-outside-pr-code reads the session's PRs to choose read mode", () => {
  test.each([
    ["a checker of the owner's own PR", "s-own"],
    ["a checker of an org repo's PR", "s-org"],
  ])("%s runs the PR's tests as before", async (_, session) => {
    expect(await judge(call("bun test", OUTSIDE, session))).toBeUndefined()
  })

  test.each([
    ["one outside PR among its PRs", "s-mixed", "outside author"],
    ["a PR the hook cannot read", "s-unread", "GitHub did not answer for acme-owner/widgets#509"],
    ["no PR on its row", "s-none", "bun scripts/roster.ts set <this session's name> pr=<pull url>"],
    [
      "only an issue on its row",
      "s-issue",
      "bun scripts/roster.ts set <this session's name> pr=<pull url>",
    ],
  ])("a checker with %s is in read mode", async (_, session, words) => {
    expect(await judge(call("bun test", OUTSIDE, session))).toContain(words)
  })

  test("a GIT_DIR the session exports keeps git out, since the walk would not find that repository", async () => {
    const exported = { ...as("reviewer"), GIT_DIR: EMBEDDED }
    expect(await check(call("git log", OUTSIDE), exported, lookup)).toContain("outside author")
  })

  test.each(["worker", "lead", ""])("a %s session is never in read mode", async (role) => {
    expect(await judge(call("bun test", OUTSIDE), role)).toBeUndefined()
  })
})

describe("no-outside-pr-code's live lookup", () => {
  const scratch = mkdtempSync(join(tmpdir(), "outside-pr-"))
  const environment = {
    CLAUDE_CONFIG_DIR: join(scratch, "claude"),
    HOME: scratch,
    PLAYGROUND_DATA_DIR: join(scratch, "data"),
  }
  const registry = (sessionId: string, name: string) =>
    Bun.write(
      join(scratch, "claude", "sessions", `${sessionId}.json`),
      JSON.stringify({ name, sessionId }),
    )
  const roster = (agents: unknown) =>
    Bun.write(join(scratch, "data", "roster.json"), JSON.stringify({ agents }))

  test("a row's pr and prs, found by the session's registry name", async () => {
    await registry("s-live", "m4k7pq-reviewer")
    await roster([
      {
        kind: "reviewer",
        name: "m4k7pq-reviewer",
        pr: pull("acme-owner/widgets", 502),
        prs: [pull("acme-owner/widgets", 501)],
      },
    ])
    expect(await live(environment).prsOf("s-live")).toEqual([
      pull("acme-owner/widgets", 502),
      pull("acme-owner/widgets", 501),
    ])
  })

  test("a checker spawned with --pr, whose row holds pr alone, is out of the fail-closed mode", async () => {
    await registry("s-spawned", "w2r9tx-reviewer")
    await roster([
      { kind: "reviewer", name: "w2r9tx-reviewer", pr: pull("acme-owner/widgets", 502) },
    ])
    const prs = await live(environment).prsOf("s-spawned")
    expect(prs).toEqual([pull("acme-owner/widgets", 502)])
    const own = { ...lookup, prsOf: async () => prs }
    expect(await check(call("bun test", OUTSIDE, "s-spawned"), as("reviewer"), own)).toBeUndefined()
  })

  test("an ended checker restarted with --pr, whose row holds pr and prs, reads that PR", async () => {
    await registry("s-restart", "h5c2vb-reviewer")
    const url = pull("acme-owner/widgets", 502)
    await roster([
      { kind: "reviewer", name: "h5c2vb-reviewer", pr: url, prs: [url], status: "starting" },
    ])
    expect(await live(environment).prsOf("s-restart")).toEqual([url])
  })

  test("a checker started with --pr naming an issue alone stays in the fail-closed mode until its PR opens", async () => {
    await registry("s-issue", "j8d4nf-tester")
    const issue = "https://github.com/acme-owner/widgets/issues/77"
    await roster([{ kind: "tester", name: "j8d4nf-tester", prs: [issue] }])
    const prs = await live(environment).prsOf("s-issue")
    expect(prs).toEqual([issue])
    expect(await readMode("s-issue", { ...lookup, prsOf: async () => prs })).toContain(
      "names no PR",
    )
  })

  test("git in a bare repo a PR ships, whose config names a diff program, is refused, and in the clone it reads", async () => {
    const clone = join(scratch, "review-601")
    const embedded = join(clone, "emb")
    for (const dir of [join(clone, ".git"), join(embedded, "objects"), join(embedded, "refs")])
      mkdirSync(dir, { recursive: true })
    await Bun.write(join(embedded, "HEAD"), "ref: refs/heads/main\n")
    await Bun.write(join(embedded, "config"), "[diff]\n\texternal = ./run.sh\n")
    const machine = {
      ...live(environment),
      author: lookup.author,
      prsOf: async () => [pull("acme-owner/widgets", 501)],
    }
    const judgeHere = (command: string) => check(call(command), as("reviewer"), machine)
    expect(await judgeHere(`git -C ${embedded} diff HEAD~1 HEAD`)).toContain("outside author")
    expect(await judgeHere(`git -C ${clone} diff HEAD~1 HEAD`)).toBeUndefined()
  })

  test("a symlink that leads into a shipped bare repo is followed as git follows it", async () => {
    const base = join(scratch, "review-602")
    const evil = join(base, "evil")
    for (const dir of [join(evil, "objects"), join(evil, "refs"), join(evil, "sub")])
      mkdirSync(dir, { recursive: true })
    await Bun.write(join(evil, "HEAD"), "ref: refs/heads/main\n")
    await Bun.write(join(evil, "config"), "[diff]\n\texternal = ./run.sh\n")
    symlinkSync(join(evil, "sub"), join(base, "link"))
    const machine = {
      ...live(environment),
      author: lookup.author,
      prsOf: async () => [pull("acme-owner/widgets", 501)],
    }
    expect(
      await check(call(`git -C ${base}/link/.. diff HEAD~1 HEAD`), as("reviewer"), machine),
    ).toContain("outside author")
  })

  test("no registry entry, and a roster that does not parse, name no PR", async () => {
    expect(await live(environment).prsOf("s-unknown")).toEqual([])
    await registry("s-broken", "k8v3nd-reviewer")
    await Bun.write(join(scratch, "data", "roster.json"), "{")
    expect(await live(environment).prsOf("s-broken")).toEqual([])
  })

  test("a kept author is read from the data folder, and a recent failure is not asked again", async () => {
    const cache = join(scratch, "data", "hook-outside-pr")
    mkdirSync(cache, { recursive: true })
    const pr = { author: "ext-dev", owner: "acme-owner", ownerType: "User" }
    await Bun.write(join(cache, "acme-owner__widgets__501.json"), JSON.stringify(pr))
    await Bun.write(
      join(cache, "acme-owner__widgets__509.json"),
      JSON.stringify({ failedAt: Date.now() }),
    )
    expect(await live(environment).author("acme-owner/widgets", 501)).toEqual(pr)
    expect(await live(environment).author("acme-owner/widgets", 509)).toBeUndefined()
  })

  test('a script\'s runner is read from its first line, and one it cannot open reads as "", held to the main checkout', async () => {
    const script = join(scratch, "state.ts")
    await Bun.write(script, "#!/usr/bin/env bun\nconsole.log(1)\n")
    expect(live(environment).runner(script)).toBe("bun")
    expect(live(environment).runner(join(scratch, "no-such-script"))).toBe("")
  })
})

describe("runnerOf names the program a shebang line runs", () => {
  test.each([
    ["#!/usr/bin/env bun", "bun"],
    ["#!/usr/bin/env -S bun --smol", "bun"],
    ["#!/usr/bin/env FORCE_COLOR=0 bun", "bun"],
    ["#!/opt/homebrew/bin/bun", "bun"],
    ["#! /usr/bin/env python3", "python3"],
    ["#!/usr/bin/env node", "node"],
    ["#!/bin/sh", "sh"],
    ["#!/usr/bin/env -u NODE_ENV bun", "bun"],
    ["#!/usr/bin/env -C /tmp bun", "bun"],
    ["#!/usr/bin/env -P /usr/local/bin bun", "bun"],
    ["#!/usr/bin/env --unset=NODE_ENV --chdir=/tmp bun", "bun"],
    ["#!/usr/bin/env -i bunx", "bunx"],
    ["#!/usr/bin/env -S bun --no-env-file", "bun"],
    ["#!/usr/bin/env --made-up bun", ""],
    ["#!/usr/bin/env ${RUNNER}", ""],
    ["#!/usr/bin/env FORCE_COLOR=0", ""],
    ["console.log(1)", undefined],
    ["#!", undefined],
    [undefined, undefined],
  ])("%p runs %p", (line, runner) => {
    expect(runnerOf(line)).toBe(runner)
  })
})
