import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { check, live, type Lookup, readMode } from "../../../scripts/hooks/no-outside-pr-code"

// A made-up machine: every repo, login, session and folder here is invented, and only the live lookup's rows touch a scratch folder.
// HOME is this machine's own, since the shell reader expands a ~ by it
const HOME = homedir()
const MAIN = "/m/pg"
const TREES = `${MAIN}/.claude/worktrees`
const OUTSIDE = `${TREES}/review-501`
const INSTALLED = `${TREES}/review-505`
const SKILLS = `${HOME}/.playground/orgs/home/abc123/skills`
const STATE = `${SKILLS}/code-review-loop/scripts/state.py`
const CORE_STATE = `${MAIN}/extensions/core/skills/code-review-loop/scripts/state.py`
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

const lookup: Lookup = {
  author: async (repo, pr) => PRS[`${repo}#${pr}`],
  holds: (folder, entry) => folder === (entry === "node_modules" ? INSTALLED : OUTSIDE),
  main: MAIN,
  prsOf: async (sessionId) => SESSIONS[String(sessionId)] ?? [],
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
    ["the review skill's state.py", call(`python3 ${STATE} pr 501`)],
    ["the review skill's state.py by its path", call(`${STATE} pr 501`)],
    ["a read through run-slot", call(`${SLOT} m4k7pq-reviewer -- git -C ${OUTSIDE} diff`)],
    [
      "a read through run-slot by ~",
      call(`~/.playground/ops/run-slot.sh m4k7pq-reviewer -- cat x`),
    ],
    ["a file piped into jq", call(`cat ${OUTSIDE}/package.json | jq .scripts`)],
    ["grep over the clone", call(`grep -rn foo ${OUTSIDE}/src`)],
    ["a variable of the line's own", call(`S=${OUTSIDE}; cat $S/x`)],
    ["the clock", call("date -u +%FT%TZ")],
    ["the review skill's state.py from the main checkout", call(`python3 ${CORE_STATE} pr 501`)],
    ["that state.py by its path", call(`${CORE_STATE} wait acme-owner/widgets 501 abc`)],
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
    ["a PR the hook cannot read", "s-unread", "outside author"],
    ["no PR on its row", "s-none", "roster.ts assign"],
    ["only an issue on its row", "s-issue", "roster.ts assign"],
  ])("a checker with %s is in read mode", async (_, session, words) => {
    expect(await judge(call("bun test", OUTSIDE, session))).toContain(words)
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
    expect(await readMode("s-issue", { ...lookup, prsOf: async () => prs })).toBe("none")
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
})
