import { describe, expect, test } from "bun:test"

import { readOnly } from "../../../scripts/hooks/read-only"

const bash = (command: string) =>
  JSON.stringify({ cwd: "/", tool_input: { command }, tool_name: "Bash" })
const mcp = (tool: string) => JSON.stringify({ cwd: "/", tool_input: {}, tool_name: tool })

describe("a call that only reads", () => {
  test.each([
    "git log --oneline -5",
    "git -C /tmp status --short",
    "git remote -v",
    "git config --get remote.origin.url",
    "git branch --show-current",
    "git fetch origin canary",
    "git worktree list",
    "gh issue list -R acme/app",
    "gh pr view 1 -R acme/app --json state",
    "gh api repos/acme/app/issues",
    "gh api -X GET repos/acme/app/pulls -f per_page=100",
    "gh search issues foo",
    "cat .git/worktrees/a/HEAD",
    "grep gitdir .git",
    "git log --format=%B -n 1 | head -3",
    "echo $(git rev-parse HEAD)",
    "cd /tmp && git diff HEAD~1 | wc -l",
  ])("%s reads", (command) => {
    expect(readOnly(bash(command))).toBe(true)
  })

  test("a GitHub MCP read", () => {
    expect(readOnly(mcp("mcp__github-shared__list_issues"))).toBe(true)
  })
})

describe("a call that may write", () => {
  test.each([
    "gh issue create -R acme/app -t x -b y",
    "gh api -X DELETE repos/acme/app",
    "gh api repos/acme/app/issues -f title=y",
    "git push origin main",
    "git branch -D x",
    "git config user.name x",
    "git -c core.pager=less log",
    "GIT_PAGER=less git log",
    "echo 'git push' | sh",
    "git log; git push",
    "curl https://example.com",
    "python3 -c 'print(1)'",
  ])("%s does not read only", (command) => {
    expect(readOnly(bash(command))).toBe(false)
  })

  test("a GitHub MCP write, and a call that does not parse", () => {
    expect(readOnly(mcp("mcp__github-shared__add_issue_comment"))).toBe(false)
    expect(readOnly("not json")).toBe(false)
  })
})
