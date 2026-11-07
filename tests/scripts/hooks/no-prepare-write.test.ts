import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-prepare-write"

let config = ""
let env: Record<string, string> = {}

// Two sessions in Claude Code's registry, its session id its name: a prepare-only worker, and the same kind of worker once its claim cleared the mode.
beforeAll(async () => {
  config = await mkdtemp(join(tmpdir(), "no-prepare-write-"))
  for (const [k, name] of ["worker-made-up-1", "worker-made-up-2", "worker-made-up-3"].entries())
    await Bun.write(
      join(config, "sessions", `${k}.json`),
      JSON.stringify({ name, pid: k, sessionId: name }),
    )
  await Bun.write(
    join(config, "playground", "roster.json"),
    JSON.stringify({
      agents: [
        { kind: "worker", mode: "prepare", name: "worker-made-up-1", ticket: "MADE-1" },
        { kind: "worker", name: "worker-made-up-2", ticket: "MADE-2" },
      ],
    }),
  )
  env = { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") }
})

afterAll(async () => {
  await rm(config, { force: true, recursive: true })
})

const bash = (command: string, session = "worker-made-up-1") =>
  JSON.stringify({ cwd: config, session_id: session, tool_input: { command }, tool_name: "Bash" })
const tool = (name: string, session = "worker-made-up-1") =>
  JSON.stringify({ session_id: session, tool_input: {}, tool_name: name })

describe("no-prepare-write", () => {
  test.each([
    "mcp__linear-shared__save_issue",
    "mcp__linear-shared__save_comment",
    "mcp__linear__create_attachment",
    "mcp__slack-shared__chat_post_message",
    "mcp__slack-shared__chat_update",
    "mcp__slack-shared__reactions_add",
    "mcp__slack-shared__conversations_join",
    "mcp__github-shared__create_pull_request",
    "mcp__github-shared__push_files",
    "mcp__github-shared__create_branch",
    "mcp__github-shared__create_or_update_file",
    "mcp__github-shared__merge_pull_request",
    "mcp__github-shared__add_issue_comment",
    "mcp__github-shared__issue_write",
  ])("refuses a prepare-only worker the write tool %s", async (name) => {
    expect(await check(tool(name), env)).toStartWith("no-prepare-write hook refused the ")
  })

  test.each([
    "gh pr create --draft --title made-up --body-file /made-up/body.md",
    "cd /made-up && gh -R made-up/app pr create --fill",
    "env GH_TOKEN=x gh pr create --fill",
    "gh api -X POST repos/made-up/app/pulls -f title=made-up -f head=b -f base=main",
    "gh api repos/made-up/app/pulls -f title=made-up",
    "git push -u origin made-up",
    "git -C /made-up/app push --force-with-lease",
    "cd /made-up/app && git push another-remote HEAD",
    "timeout 60 git push",
    "git send-pack origin HEAD",
    "gh pr comment 1 --body made-up",
    "gh pr ready 1",
    "gh pr merge 1 --squash",
    "gh issue create --title made-up --body made-up",
    "gh issue comment 1 --body made-up",
    "gh api repos/made-up/app/issues/1/comments -f body=made-up",
    "gh api -X PATCH repos/made-up/app/issues/1 -f state=closed",
    "gh api graphql -f query='mutation { createPullRequest(input: {}) { clientMutationId } }'",
    'gh api graphql -f query="$(cat /made-up/q.graphql)"',
  ])("refuses a prepare-only worker the GitHub write or push %s", async (command) => {
    expect(await check(bash(command), env)).toContain("this session is a prepare-only worker")
  })

  test.each([
    "mcp__linear-shared__get_issue",
    "mcp__linear-shared__list_comments",
    "mcp__linear-shared__search_documentation",
    "mcp__slack-shared__conversations_history",
    "mcp__slack-shared__conversations_replies",
    "mcp__slack-shared__search_messages",
    "mcp__github-shared__pull_request_read",
    "mcp__github-shared__issue_read",
    "mcp__github-shared__get_file_contents",
    "mcp__github-shared__list_pull_requests",
    "mcp__github-shared__search_code",
  ])("lets a prepare-only worker read with %s", async (name) => {
    expect(await check(tool(name), env)).toBeUndefined()
  })

  test.each([
    "gh pr view 1 --json state",
    "gh pr list",
    "gh api repos/made-up/app/pulls",
    "gh pr diff 1",
    "gh pr checks 1",
    "gh pr status",
    "gh issue view 1",
    "gh issue list --state open",
    "gh api graphql -f query='query { viewer { login } }'",
    "gh run view 1 --log-failed",
    "git commit -m made-up",
    "git -C /made-up/app status",
    "git log --oneline -1",
    "echo gh pr create",
    "echo git push",
  ])("lets a prepare-only worker run %s", async (command) => {
    expect(await check(bash(command), env)).toBeUndefined()
  })

  test("lets the same calls run once the claim cleared the mode, and for a session the roster or the registry does not hold", async () => {
    for (const session of ["worker-made-up-2", "worker-made-up-3", "not-in-the-registry"]) {
      expect(await check(tool("mcp__linear-shared__save_issue", session), env)).toBeUndefined()
      expect(await check(bash("gh pr create --fill", session), env)).toBeUndefined()
      expect(await check(bash("git push -u origin made-up", session), env)).toBeUndefined()
    }
  })

  test("reads a graphql query from the file a $(cat) names: a mutation there is refused, a query runs", async () => {
    await Bun.write(join(config, "q.graphql"), "query { viewer { login } }")
    await Bun.write(
      join(config, "m.graphql"),
      "mutation { addComment(input: {}) { clientMutationId } }",
    )
    const graphql = (file: string) => bash(`gh api graphql -f query="$(cat ${join(config, file)})"`)
    expect(await check(graphql("q.graphql"), env)).toBeUndefined()
    expect(await check(graphql("m.graphql"), env)).toContain(
      "this session is a prepare-only worker",
    )
  })

  test("fails open on input it cannot read", async () => {
    expect(await check("not json", env)).toBeUndefined()
    expect(
      await check(tool("mcp__linear-shared__save_issue"), {
        ...env,
        PLAYGROUND_DATA_DIR: join(config, "missing"),
      }),
    ).toBeUndefined()
  })
})
