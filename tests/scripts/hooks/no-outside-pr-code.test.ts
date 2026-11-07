import { describe, expect, test } from "bun:test"

import { check, type Lookup } from "../../../scripts/hooks/no-outside-pr-code"

// A made-up machine: every repo, login and folder here is invented, and nothing touches the disk or GitHub.
const MAIN = "/m/pg"
const TREES = `${MAIN}/.claude/worktrees`
const OUTSIDE = `${TREES}/review-501`
const OUTSIDE_NAMED = `${TREES}/review-widgets-503`
const OWN = `${TREES}/review-502`
const ORG = `${TREES}/review-504`
const UNREAD = `${TREES}/review-509`
const MINE = `${TREES}/PG-77-mine`

const REPOS: Record<string, string> = {
  [ORG]: "acme-org/tools",
  [OUTSIDE]: "acme-owner/widgets",
  [OUTSIDE_NAMED]: "acme-owner/widgets",
  [OWN]: "acme-owner/widgets",
  [UNREAD]: "acme-owner/widgets",
}
const PRS: Record<string, { author: string; owner: string; ownerType: string }> = {
  "acme-org/tools#504": { author: "colleague-dev", owner: "acme-org", ownerType: "Organization" },
  "acme-owner/widgets#501": { author: "ext-dev", owner: "acme-owner", ownerType: "User" },
  "acme-owner/widgets#502": { author: "acme-owner", owner: "acme-owner", ownerType: "User" },
  "acme-owner/widgets#503": { author: "other-ext", owner: "acme-owner", ownerType: "User" },
}

const lookup: Lookup = {
  author: async (repo, pr) => PRS[`${repo}#${pr}`],
  clones: async () => [ORG, OUTSIDE, OUTSIDE_NAMED, OWN, UNREAD],
  repoOf: async (folder) => REPOS[folder],
}

const call = (command: string, cwd: string, tool = "Bash", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ cwd, session_id: "s-1", tool_input: { command }, tool_name: tool, ...extra })

const as = (role: string) => ({ HOME: "/home/made-up", PLAYGROUND_ROLE: role })

const judge = (raw: string, role = "reviewer") => check(raw, as(role), lookup)

describe("no-outside-pr-code refuses a checker running an outside author's PR code", () => {
  test.each([
    ["a test run in the clone", call("bun test", OUTSIDE)],
    [
      "a cd into the clone, then a build",
      call("cd .claude/worktrees/review-501 && bun run build", MAIN),
    ],
    ["bun's --cwd into the clone", call(`bun --cwd ${OUTSIDE} test`, MINE)],
    ["a shell's -c script that enters the clone", call(`bash -c "cd ${OUTSIDE} && make"`, MINE)],
    ["the clone's file piped into an interpreter", call(`cat ${OUTSIDE}/x.ts | bun -`, MINE)],
    ["node on the clone's script", call(`node ${OUTSIDE}/scripts/x.js`, MINE)],
    ["an install, whose scripts the PR holds", call("bun install", OUTSIDE)],
    [
      "a test run through run-slot",
      call(
        "~/.playground/ops/run-slot.sh m4k7pq-reviewer -- bun run test:file tests/x.test.ts",
        OUTSIDE,
      ),
    ],
    ["a copy out of the clone", call(`cp -r ${OUTSIDE} /tmp/x`, MINE)],
    [
      "a find over a folder that holds the clone",
      call(`find ${TREES} -name '*.ts' -exec bun {} \\;`, MINE),
    ],
    ["a test run on the clone by a relative path", call("bun test ../review-501", MINE)],
    ["env's -C into the clone", call(`env -C ${OUTSIDE} bun test`, MINE)],
    ["a cd through a variable the line sets", call(`D=${OUTSIDE}; cd $D && bun test`, MINE)],
    [
      "a cd the hook cannot read, while an outside clone exists",
      call('cd "$X" && bun test', TREES),
    ],
    ["a clone named by its repo", call("bun test", OUTSIDE_NAMED)],
    ["a clone whose PR author cannot be read", call("bun test", UNREAD)],
    ["the Monitor tool", call("bun test --watch", OUTSIDE, "Monitor")],
    [
      "a sub-agent's call",
      call("bun test", OUTSIDE, "Bash", { agent_id: "a-1", agent_type: "general-purpose" }),
    ],
  ])("%s", async (_, raw) => {
    expect(await judge(raw)).toContain("no-outside-pr-code")
  })

  test("a tester's run of the PR's stack", async () => {
    expect(await judge(call("bun run dev", OUTSIDE), "tester")).toContain("no-outside-pr-code")
  })
})

describe("no-outside-pr-code lets reading pass, and every other session and clone", () => {
  test.each([
    ["git diff in the clone", call(`git -C ${OUTSIDE} diff origin/canary...HEAD`, MINE)],
    ["a cat in the clone", call("cat src/x.ts", OUTSIDE)],
    ["a grep over the clone", call("grep -rn needle .", OUTSIDE)],
    ["gh's diff of the PR", call("gh pr diff 501 --repo acme-owner/widgets", MINE)],
    ["a fetch of the PR's head", call(`git -C ${OUTSIDE} fetch origin pull/501/head`, MINE)],
    [
      "a detached checkout of the new head",
      call(`git -C ${OUTSIDE} checkout --detach FETCH_HEAD`, MINE),
    ],
    ["the clone's creation", call(`git worktree add --detach ${OUTSIDE} 0123abc`, MAIN)],
    [
      "the Read tool",
      JSON.stringify({
        cwd: MAIN,
        tool_input: { file_path: `${OUTSIDE}/x.ts` },
        tool_name: "Read",
      }),
    ],
    ["a test run in the owner's own PR's clone", call("bun test", OWN)],
    ["a test run in an org repo's clone", call("bun test", ORG)],
    ["a test run in the checker's own worktree", call("bun run test:file tests/x.test.ts", MINE)],
    [
      "the checker's own tooling from the main checkout",
      call("python3 /skills/code-review-loop/state.py pr 501", MAIN),
    ],
  ])("%s", async (_, raw) => {
    expect(await judge(raw)).toBeUndefined()
  })

  test.each([["worker"], ["lead"], [""]])("a %p session runs the clone's tests", async (role) => {
    expect(await judge(call("bun test", OUTSIDE), role)).toBeUndefined()
  })
})
