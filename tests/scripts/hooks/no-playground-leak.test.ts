import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check, skillNames } from "../../../scripts/hooks/no-playground-leak"
import { OLD } from "../../session-names"
import { storeWith } from "./render-set"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-playground-leak.ts")
const NOT_RUN = "none of its commands ran"
let scratch = ""
// A Claude config folder whose roster names made-up agents, so no real session name is needed.
let config = ""
// The hook's lists: its terms as the repo holds them, and made-up cleared conversations.
let lists = ""
// Checkouts: Acme's (`lw`), one whose unpushed commit names a session (`leaky`), one on a branch named for one (`named`), one on an ordinary probe branch (`infra`), one with a tag whose message names OLD.dispatcher (`tagged`), and OLD.dispatcher's own (`lm`).
const dirs = { infra: "", leaky: "", lm: "", lw: "", named: "", tagged: "" }

function git(dir: string, ...args: string[]): void {
  const proc = Bun.spawnSync(
    ["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { stderr: "pipe" },
  )
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`)
}

async function checkout(name: string, url: string, message: string, branch = "main") {
  const dir = join(scratch, name)
  await mkdir(dir, { recursive: true })
  git(dir, "init", "-q", "-b", branch)
  git(dir, "remote", "add", "origin", url)
  git(dir, "commit", "-q", "--allow-empty", "-m", message)
  await Bun.write(join(dir, "clean.md"), "Fixes the export button.\n")
  await Bun.write(join(dir, "leaky.md"), "Built by worker-envy.\n")
  return dir
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "no-playground-leak-"))
  const lw = "https://github.com/acme-blue/app.git"
  dirs.lw = await checkout("lw", lw, "Fix the export button")
  dirs.leaky = await checkout("leaky", lw, "Fix from worker-envy")
  dirs.named = await checkout(
    "named",
    "git@github.com:acme-blue/app.git",
    "Fix",
    `${OLD.builder}/fix`,
  )
  dirs.infra = await checkout("infra", lw, "Raise the probe timeout", "fix/probe-timeout")
  dirs.tagged = await checkout("tagged", lw, "Fix")
  git(dirs.tagged, "tag", "-a", "v1", "-m", `Shipped by ${OLD.dispatcher}`)
  dirs.lm = await checkout("lm", "https://github.com/acme/archive.git", `${OLD.dispatcher}: init`)
  config = join(scratch, "config")
  await Bun.write(
    join(config, "playground", "roster.json"),
    JSON.stringify({
      agents: [
        { name: "falcon-scout", role: "worker" },
        { name: "quillwright", role: "manager" },
        { name: "planner", role: "manager" },
        { name: "probe-hatch", role: "worker" },
        { name: "acme-blue", role: "worker" },
        { name: 7, role: "worker" },
      ],
    }),
  )
  await Bun.write(join(scratch, "broken", "playground", "roster.json"), "{ not json")
  lists = join(scratch, "lists")
  await mkdir(lists)
  // The repo's terms, plus the stand-in old names a machine's own list holds and a made-up org's own words, as that org's extension adds them.
  const terms = await Bun.file(
    join(root, "extensions", "core", "lists", "playground-terms.json"),
  ).json()
  await Bun.write(
    join(lists, "playground-terms.json"),
    JSON.stringify({
      ...terms,
      aliases: [...terms.aliases, OLD.builder, OLD.ops, OLD.planner],
      everyday: [...terms.everyday, "acme", "acme-blue"],
      names: [...terms.names, OLD.dispatcher],
    }),
  )
  await Bun.write(
    join(lists, "slack-cleared.json"),
    JSON.stringify({
      C0EXAMPLE01: { name: "#playground", signature: "_Sent via Playground_" },
      D0EXAMPLE01: { name: "DM with a teammate" },
      D0EXAMPLE02: { name: "DM with another teammate" },
    }),
  )
  // the config's extensions hold the same lists, and ext.links links an extension to Acme's GitHub org, so its repositories are guarded
  storeWith(
    join(config, "playground"),
    {
      "playground-terms.json": await Bun.file(join(lists, "playground-terms.json")).text(),
      "slack-cleared.json": await Bun.file(join(lists, "slack-cleared.json")).text(),
    },
    { "ext.links": { "made-up-org": ["acme-blue"] } },
  )
})

describe("the guarded orgs", () => {
  test("a repository in an org ext.links does not name is not guarded, and with no extensions none is", async () => {
    const write = (command: string, environment: Record<string, string>) =>
      check(
        JSON.stringify({
          cwd: dirs.lm,
          hook_event_name: "PreToolUse",
          tool_input: { command },
          tool_name: "Bash",
        }),
        environment,
        undefined,
        lists,
      )
    const comment = `gh issue comment 1 -R acme-blue/app --body "from ${OLD.dispatcher}"`
    expect(
      await write(comment, {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
      }),
    ).toContain(`"${OLD.dispatcher}"`)
    expect(
      await write(comment.replace("acme-blue", "acme"), {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
      }),
    ).toBeUndefined()
    expect(
      await write(comment, {
        CLAUDE_CONFIG_DIR: join(scratch, "none"),
        PLAYGROUND_DATA_DIR: join(join(scratch, "none"), "playground"),
      }),
    ).toBeUndefined()
  })
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

const bash = (command: string, cwd = dirs.lw) =>
  check(
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      tool_input: { command },
      tool_name: "Bash",
    }),
    { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") },
    undefined,
    lists,
  )

const mcp = (
  tool_name: string,
  tool_input: unknown,
  environment = { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") },
) =>
  check(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_input, tool_name }),
    environment,
    undefined,
    lists,
  )

const LW = "-R acme-blue/app"

describe(`a Acme write holding a ${OLD.dispatcher} term is refused`, () => {
  test.each([
    [
      "Linear save_issue",
      "mcp__linear-shared__save_issue",
      { team: "AI", title: "Fix by worker-envy" },
    ],
    [
      "Linear save_comment",
      "mcp__linear-shared__save_comment",
      { body: `${OLD.dispatcher} found it`, issueId: "ACME-1" },
    ],
    [
      "Linear on another server",
      "mcp__claude_ai_Linear__save_issue",
      { id: "ACME-1", description: "see roster.json" },
    ],
    [
      "Linear save_document",
      "mcp__linear-shared__save_document",
      { content: `from ${OLD.builder}` },
    ],
    [
      "Linear save_project",
      "mcp__linear-shared__save_project",
      { description: `Planned by ${OLD.planner}` },
    ],
    [
      "Slack chat_post_message",
      "mcp__slack-shared__chat_post_message",
      { channel: "C1", text: `${OLD.ops} says hi` },
    ],
    [
      "Slack chat_update",
      "mcp__slack-shared__chat_update",
      { text: "the live/dashboard branch shows it" },
    ],
    [
      "Slack on another server",
      "mcp__slack-local__chat_post_message",
      { text: "ask probe-greed-feed" },
    ],
    [
      "GitHub create_pull_request",
      "mcp__github-shared__create_pull_request",
      {
        body: "Notes in ~/.playground/asks",
        owner: "acme-blue",
        repo: "app",
        title: "x",
      },
    ],
    [
      "GitHub add_issue_comment",
      "mcp__github-shared__add_issue_comment",
      { body: "reviewer-greed scored it", issue_number: 1, owner: "Acme-Blue", repo: "app" },
    ],
    [
      "GitHub push_files, by its branch",
      "mcp__github-shared__push_files",
      {
        branch: "tester-lust/fix",
        files: [],
        message: "Fix",
        owner: "acme-blue",
        repo: "app",
      },
    ],
    [
      "GitHub pull_request_review_write",
      "mcp__github-shared__pull_request_review_write",
      { body: "playground-factory rule", owner: "acme-blue", repo: "app" },
    ],
    [
      "the backend's provider",
      "mcp__linear-shared__save_comment",
      { body: "Answered on Z.ai", issueId: "ACME-1" },
    ],
    [
      "the backend's model",
      "mcp__linear-shared__save_comment",
      { body: "Ran on GLM-5.3 today", issueId: "ACME-1" },
    ],
  ])("%s", async (_, tool, input) => {
    const reason = await mcp(tool, input)
    expect(reason).toContain("no-playground-leak hook refused")
    expect(reason).toContain("a factory term")
  })

  test.each([
    ["gh pr create", `gh pr create ${LW} --title "Fix export" --body "Made by worker-envy"`],
    [
      "gh pr create, by its head",
      `gh pr create ${LW} --title Fix --body ok --head runner-pride/fix`,
    ],
    [
      "gh pr comment on a URL",
      `gh pr comment https://github.com/acme-blue/app/pull/1 --body "${OLD.ops}"`,
    ],
    ["gh pr comment in the checkout", `gh pr comment 1 --body "the live/dashboard branch"`],
    ["gh pr comment from a file", "gh pr comment 1 --body-file leaky.md"],
    ["gh pr review", `gh pr review 1 --approve -b "${OLD.builder} approves"`],
    ["gh pr edit", `gh pr edit 1 ${LW} --title "worker-sloth: fix"`],
    ["gh pr merge", `gh pr merge 1 ${LW} --squash --subject "Fix (worker-wrath)"`],
    ["gh issue create", `gh issue create ${LW} -t "From ${OLD.dispatcher}" -b x`],
    ["gh issue comment", `gh issue comment 2 ${LW} -b "see .claude/acme/roster.json"`],
    ["gh release create", `gh release create v1 ${LW} --notes "by reviewer-pride"`],
    [
      "gh api comment",
      `gh api repos/acme-blue/app/issues/1/comments -f body="probe-tester-envy-login"`,
    ],
    ["gh api edit", `gh api -X PATCH repos/acme-blue/app/pulls/1 -f title="${OLD.dispatcher} fix"`],
    [
      "gh api in the checkout",
      `gh api repos/{owner}/{repo}/issues/1/comments -f body=${OLD.dispatcher}`,
    ],
    ["gh behind a wrapper", `vault run -- gh pr comment 1 ${LW} --body ${OLD.dispatcher}`],
    ["git commit -m", `git commit -m "Fix from worker-envy"`],
    ["git commit -F", "git commit -F leaky.md"],
    ["git -C commit", `git -C ${"$PWD"} commit -am "${OLD.dispatcher}"`],
    ["git push to a branch named for a session", "git push origin HEAD:worker-greed/fix"],
    ["curl to Slack", `curl -d text="${OLD.builder} here" https://slack.com/api/chat.postMessage`],
    [
      "curl to Linear",
      `curl -d '{"query":"mutation { commentCreate(input: {body: \\"${OLD.dispatcher}\\"}) { success } }"}' https://api.linear.app/graphql`,
    ],
    [
      "curl to a Acme repo",
      `curl -X POST -d '{"body":"worker-lust"}' https://api.github.com/repos/acme-blue/app/issues/1/comments`,
    ],
  ])("%s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-playground-leak hook refused")
    expect(reason).toContain("a factory term")
  })

  test("git push of HEAD carries the branch it names on the remote", async () => {
    expect(await bash("git push -u origin HEAD", dirs.named)).toContain(`"${OLD.builder}"`)
    expect(await bash("git push origin @", dirs.named)).toContain(`"${OLD.builder}"`)
  })

  test("git push --tags carries an annotated tag's message", async () => {
    expect(await bash("git push --tags", dirs.tagged)).toContain(`"${OLD.dispatcher}"`)
    expect(await bash("git push --follow-tags", dirs.tagged)).toContain(`"${OLD.dispatcher}"`)
  })

  test("curl to GitHub's GraphQL endpoint is placed like gh api graphql", async () => {
    const body = String.raw`{"query":"mutation { addComment(input: {subjectId: \"X\", body: \"${OLD.dispatcher}\"}) { clientMutationId } }"}`
    expect(await bash(`curl -X POST -d '${body}' https://api.github.com/graphql`)).toContain(
      "cannot tell whether it writes to a guarded org",
    )
    expect(await bash(`curl -d '${body}' https://api.github.com:443/graphql`)).toContain(
      "cannot tell whether it writes to a guarded org",
    )
  })

  test("curl to a URL with no scheme is placed as curl reads it", async () => {
    expect(await bash(`curl -d text="${OLD.builder}" slack.com/api/chat.postMessage`)).toContain(
      `"${OLD.builder}"`,
    )
    expect(await bash(`curl -d '{"query":"${OLD.dispatcher}"}' api.linear.app/graphql`)).toContain(
      `"${OLD.dispatcher}"`,
    )
  })

  test("git push carries the messages of the commits the remote does not hold", async () => {
    expect(await bash("git push", dirs.leaky)).toContain('"worker-envy"')
    expect(await bash("git push -u origin main", dirs.leaky)).toContain('"worker-envy"')
  })

  test("git commit and git push carry the branch name", async () => {
    expect(await bash(`git commit -m "Fix"`, dirs.named)).toContain(`"${OLD.builder}"`)
    expect(await bash("git push", dirs.named)).toContain(`"${OLD.builder}"`)
  })

  test("gh pr create carries the branch it opens from and the commits it may push", async () => {
    expect(await bash(`gh pr create --title Fix --body ok`, dirs.named)).toContain(
      `"${OLD.builder}"`,
    )
    expect(await bash(`gh pr create --title Fix --body ok`, dirs.leaky)).toContain('"worker-envy"')
  })

  test("the refusal names the term it found, so the session can rephrase", async () => {
    expect(await bash(`gh pr comment 1 --body "Thanks, Worker-Greed"`)).toContain('"Worker-Greed"')
  })
})

describe("the roster's names are terms too, since sessions are renamed", () => {
  const slack = "mcp__slack-shared__chat_post_message"

  test.each(["falcon-scout", "Quillwright"])(
    "a roster agent's name, %s, is refused",
    async (name) => {
      expect(await mcp(slack, { text: `Thanks ${name}` })).toContain(`"${name}"`)
    },
  )

  test("a probe the roster names is refused, whatever follows probe-", async () => {
    expect(await mcp(slack, { text: "ask probe-hatch" })).toContain('"probe-hatch"')
  })

  test("a roster name that is an everyday word, or Acme's own name, passes", async () => {
    expect(await mcp(slack, { text: "The planner shows it" })).toBeUndefined()
    expect(await mcp(slack, { text: "Merged into acme-blue/app" })).toBeUndefined()
  })

  test("with no roster, or one that does not read, the fixed terms still hold", async () => {
    for (const dir of [join(scratch, "none"), join(scratch, "broken")]) {
      const environment = { CLAUDE_CONFIG_DIR: dir, PLAYGROUND_DATA_DIR: join(dir, "playground") }
      expect(await mcp(slack, { text: "Thanks falcon-scout" }, environment)).toBeUndefined()
      expect(await mcp(slack, { text: `from ${OLD.dispatcher}` }, environment)).toContain(
        `"${OLD.dispatcher}"`,
      )
      expect(await mcp(slack, { text: `from ${OLD.builder}` }, environment)).toContain(
        `"${OLD.builder}"`,
      )
    }
  })
})

describe(`${OLD.dispatcher}'s skill names are terms too, read from the checkout's skills/`, () => {
  const save = "mcp__linear-shared__save_issue"

  test("a skill's name on a Linear write is refused", async () => {
    expect(
      await mcp(save, { id: "ACME-1", description: "Checked with playground-factory" }),
    ).toContain('"playground-factory"')
  })

  test("Acme, the company's own name, passes", async () => {
    expect(skillNames()).not.toContain("acme")
    expect(await mcp(save, { id: "ACME-1", description: "Acme export fix" })).toBeUndefined()
  })

  test("the pr skill's name, the word for a pull request, passes", async () => {
    expect(skillNames()).not.toContain("pr")
    expect(
      await mcp(save, { id: "ACME-1", description: "The PR body names the fix" }),
    ).toBeUndefined()
  })

  test("a new skill folder is picked up with no edit", async () => {
    const checkout = join(scratch, "checkout")
    await Bun.write(join(checkout, "skills", "playground", "quillmark", "SKILL.md"), "---\n")
    await mkdir(join(checkout, "skills", "playground", "notes"), { recursive: true })
    // ZeroStarter's skills are everyday words, so they add no term
    await Bun.write(join(checkout, "skills", "zerostarter", "design", "SKILL.md"), "---\n")
    expect(skillNames(checkout)).toEqual(["quillmark"])
    const raw = JSON.stringify({
      tool_input: { text: "via quillmark" },
      tool_name: "mcp__slack-shared__chat_post_message",
    })
    expect(
      await check(
        raw,
        { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") },
        checkout,
        lists,
      ),
    ).toContain('"quillmark"')
  })
})

describe("the same Acme writes without a term pass", () => {
  test.each([
    [
      "a word that holds z.ai's letters but not its dot",
      "mcp__linear-shared__save_comment",
      { body: "The zxai export is fixed", issueId: "ACME-1" },
    ],
    [
      "Linear save_issue",
      "mcp__linear-shared__save_issue",
      { team: "AI", title: "Fix the export button" },
    ],
    [
      "Linear save_comment",
      "mcp__linear-shared__save_comment",
      { body: "Fixed in #12", issueId: "ACME-1" },
    ],
    [
      "Slack chat_post_message",
      "mcp__slack-shared__chat_post_message",
      { channel: "C1", text: "PR is up" },
    ],
    [
      "Slack, a message about the dashboard",
      "mcp__slack-shared__chat_post_message",
      { text: "Left it at the dashboard" },
    ],
    [
      "GitHub create_pull_request",
      "mcp__github-shared__create_pull_request",
      { body: "Fixes the export", owner: "acme-blue", repo: "app", title: "Fix export" },
    ],
  ])("%s", async (_, tool, input) => {
    expect(await mcp(tool, input)).toBeUndefined()
  })

  test.each([
    [
      "gh pr create",
      `gh pr create ${LW} --title "Fix export" --body "Fixes the export" --head fix/export`,
    ],
    ["gh pr comment", `gh pr comment 1 --body "Looks good at the dashboard"`],
    ["gh pr comment from a file", "gh pr comment 1 --body-file clean.md"],
    ["gh pr comment by a number in a variable", `gh pr comment "$PR" ${LW} --body "Fixed"`],
    [
      "gh api comment",
      `gh api repos/acme-blue/app/issues/1/comments -f body="Fixed" -F number="$N"`,
    ],
    ["git commit", `git commit -m "Fix the export button"`],
    ["git commit with a date it cannot read", `git commit -m "Fix" --date "$(date)"`],
    ["git push", "git push origin HEAD:fix/export"],
    ["git push of the current branch", "git push"],
    [
      "curl to Slack",
      `curl -H "Authorization: Bearer $SLACK_TOKEN" -d text="PR is up" https://slack.com/api/chat.postMessage`,
    ],
    [
      "words that only hold a term",
      `gh pr comment 1 --body "spotquillwright envy worker readiness-probe-timeout dashboard"`,
    ],
    ["a probe-based check", `git commit -m "Add a probe-based health check"`],
    ["a probe path", `git commit -m "Set the liveness probe-path to /healthz"`],
    [
      "worker, runner and tester words",
      `gh pr comment 1 --body "worker-pool worker-thread runner-config tester-utils"`,
    ],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("a commit and a push on an ordinary probe branch", async () => {
    expect(await bash(`git commit -m "Raise the timeout"`, dirs.infra)).toBeUndefined()
    expect(await bash("git push -u origin HEAD", dirs.infra)).toBeUndefined()
  })
})

describe("writes elsewhere pass, terms and all", () => {
  test.each([
    [
      "a acme/archive PR comment",
      `gh pr comment 1 -R acme/archive --body "${OLD.dispatcher}: worker-envy is done"`,
    ],
    [
      "a URL on acme/archive",
      `gh pr comment https://github.com/acme/archive/pull/9 -b "${OLD.builder}"`,
    ],
    [
      "gh api on acme/archive",
      `gh api repos/acme/archive/issues/9/comments -f body="${OLD.dispatcher}"`,
    ],
    ["curl to another API", `curl -d text="${OLD.dispatcher}" https://example.com/hook`],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test(`a commit and a push in ${OLD.dispatcher}'s checkout`, async () => {
    expect(await bash(`git commit -m "${OLD.dispatcher}: worker-envy"`, dirs.lm)).toBeUndefined()
    expect(await bash("git push origin HEAD:worker-envy/fix", dirs.lm)).toBeUndefined()
    expect(await bash(`gh pr comment 1 --body "${OLD.ops}"`, dirs.lm)).toBeUndefined()
  })

  test("a commit in a checkout with no remote", async () => {
    const dir = join(scratch, "local")
    await mkdir(dir, { recursive: true })
    git(dir, "init", "-q")
    expect(await bash(`git commit -m "${OLD.dispatcher}"`, dir)).toBeUndefined()
  })

  test.each([
    [
      "the GitHub MCP on acme-owner",
      "mcp__github-shared__add_issue_comment",
      { body: OLD.dispatcher, owner: "acme-owner", repo: OLD.dispatcher },
    ],
    [
      "the GitHub MCP with no owner",
      "mcp__github-shared__create_gist",
      { description: OLD.dispatcher },
    ],
    ["a Linear read", "mcp__linear-shared__list_issues", { query: OLD.dispatcher }],
    ["a Linear get", "mcp__linear-shared__get_issue", { id: OLD.dispatcher }],
    ["a Slack search", "mcp__slack-shared__search_messages", { query: OLD.dispatcher }],
    [
      "a Slack history read",
      "mcp__slack-shared__conversations_history",
      { channel: OLD.dispatcher },
    ],
    ["another server", "mcp__notes__save_note", { text: OLD.dispatcher }],
  ])("%s", async (_, tool, input) => {
    expect(await mcp(tool, input)).toBeUndefined()
  })

  test("reads through gh and curl", async () => {
    expect(
      await bash(
        `gh api repos/acme-blue/app/pulls -q '.[] | select(.title | test("${OLD.dispatcher}"))'`,
      ),
    ).toBeUndefined()
    expect(
      await bash(`gh api graphql -f query='{ search(query: "${OLD.dispatcher}") { issueCount } }'`),
    ).toBeUndefined()
    expect(await bash(`gh pr view 1 ${LW}`)).toBeUndefined()
  })
})

describe("Slack writes to the conversations the owner cleared pass, terms and all", () => {
  const post = "mcp__slack-shared__chat_post_message"
  const API = "https://slack.com/api/chat.postMessage"

  const SIGNED = `${OLD.builder} merged it\n_Sent via Playground_`
  const CLEARED = "C0EXAMPLE01"

  test("#playground passes a signed post and a signed thread reply", async () => {
    expect(await mcp(post, { channel: CLEARED, text: SIGNED })).toBeUndefined()
    expect(
      await mcp(post, { channel: CLEARED, text: `${SIGNED}\n`, thread_ts: "1791529307.301699" }),
    ).toBeUndefined()
    expect(
      await mcp("mcp__slack-shared__chat_update", { channel: CLEARED, text: SIGNED, ts: "1.2" }),
    ).toBeUndefined()
  })

  test.each([
    ["an unsigned post", { channel: CLEARED, text: "Question: does it build?" }],
    ["a post signed mid-text", { channel: CLEARED, text: "_Sent via Playground_\nquillwright" }],
    ["a misspelt signature", { channel: CLEARED, text: "hi\n_sent via Playground_" }],
    ["an unsigned thread reply", { channel: CLEARED, text: "Ack: done", thread_ts: "1.2" }],
    ["a signed post with blocks", { blocks: [], channel: CLEARED, text: SIGNED }],
    ["a post with no text, only blocks", { blocks: [], channel: CLEARED }],
    ["a signed post with attachments", { attachments: [], channel: CLEARED, text: SIGNED }],
    ["a post in markdown_text", { channel: CLEARED, markdown_text: "hi" }],
    ["a text that is not text", { channel: CLEARED, text: 7 }],
    ["a post with no text at all", { channel: CLEARED }],
    ["an edit with no text", { channel: CLEARED, ts: "1.2" }],
  ])("#playground refuses %s", async (_, input) => {
    expect(await mcp(post, input)).toContain("ends with the line _Sent via Playground_")
  })

  // A #playground post's link chips: rich_text sections of text and links, the last line the italic signature.
  const link = (url: string, text?: string) => ({ ...(text ? { text } : {}), type: "link", url })
  const words = (text: string, style?: Record<string, boolean>) => ({
    ...(style ? { style } : {}),
    text,
    type: "text",
  })
  const SIGNATURE = words("\nSent via Playground", { italic: true })
  const chips = (...elements: Record<string, unknown>[]) => [
    { elements: [{ elements, type: "rich_text_section" }], type: "rich_text" },
  ]
  const CHIPS = chips(
    words(`Finding: ${OLD.builder} merged `),
    link("https://github.com/acme/archive/pull/643", "#643"),
    SIGNATURE,
  )

  test.each([
    [
      "chat_post_message",
      "mcp__slack-shared__chat_post_message",
      { channel: CLEARED, text: SIGNED },
    ],
    [
      "chat_update",
      "mcp__slack-shared__chat_update",
      { channel: CLEARED, text: SIGNED, ts: "1.2" },
    ],
    [
      "the connector",
      "mcp__claude_ai_Slack__slack_send_message",
      { channel_id: CLEARED, message: SIGNED },
    ],
  ])("#playground passes link chips through %s", async (_, tool, input) => {
    expect(await mcp(tool, { ...input, blocks: CHIPS })).toBeUndefined()
  })

  test("#playground passes chips as a JSON string, and terms in a link's label and url", async () => {
    expect(
      await mcp(post, { blocks: JSON.stringify(CHIPS), channel: CLEARED, text: SIGNED }),
    ).toBeUndefined()
    const blocks = chips(
      link(`https://example.com/${OLD.builder}`, `${OLD.builder}'s PR`),
      SIGNATURE,
    )
    expect(await mcp(post, { blocks, channel: CLEARED, text: SIGNED })).toBeUndefined()
  })

  test("#playground passes a signature in a section of its own", async () => {
    const blocks = [
      {
        elements: [
          { elements: [link("https://example.com", "PR")], type: "rich_text_section" },
          { elements: [words("Sent via Playground", { italic: true })], type: "rich_text_section" },
        ],
        type: "rich_text",
      },
    ]
    expect(await mcp(post, { blocks, channel: CLEARED, text: SIGNED })).toBeUndefined()
  })

  test.each([
    ["a section block", [{ text: { text: "hi", type: "mrkdwn" }, type: "section" }]],
    [
      "a rich_text list",
      [
        {
          elements: [{ elements: [], style: "bullet", type: "rich_text_list" }],
          type: "rich_text",
        },
      ],
    ],
    ["a user element", chips({ type: "user", user_id: "U0EXAMPLE04" }, SIGNATURE)],
    ["a usergroup element", chips({ type: "usergroup", usergroup_id: "S0" }, SIGNATURE)],
    ["an emoji element", chips({ name: "tada", type: "emoji" }, SIGNATURE)],
    ["a link with no url", chips({ text: "PR", type: "link" }, SIGNATURE)],
    ["no signature as the last line", chips(link("https://example.com"))],
    [
      "a signature that is not italic",
      chips(link("https://example.com"), words("\nSent via Playground")),
    ],
    [
      "a signature split across elements",
      chips(words("\nSent via "), words("Playground", { italic: true })),
    ],
    ["a signature mid-blocks", chips(SIGNATURE, words("\nmore"))],
    [
      "a link with an empty label after the signature",
      chips(SIGNATURE, { text: "", type: "link", url: "https://example.com" }),
    ],
    [
      "a link with a blank label after the signature",
      chips(SIGNATURE, { text: " ", type: "link", url: "https://example.com" }),
    ],
    ["blocks that do not parse", "[{"],
    ["a block with no elements", [{ type: "rich_text" }]],
  ])("#playground refuses blocks with %s", async (_, blocks) => {
    expect(await mcp(post, { blocks, channel: CLEARED, text: SIGNED })).toContain(
      "ends with the line _Sent via Playground_",
    )
  })

  test.each([
    [
      "an unsigned text fallback",
      { blocks: CHIPS, channel: CLEARED, text: `${OLD.builder} merged it` },
    ],
    ["attachments beside them", { attachments: [], blocks: CHIPS, channel: CLEARED, text: SIGNED }],
    [
      "markdown_text beside them",
      { blocks: CHIPS, channel: CLEARED, markdown_text: "hi", text: SIGNED },
    ],
  ])("#playground refuses chips with %s", async (_, input) => {
    expect(await mcp(post, input)).toContain("ends with the line _Sent via Playground_")
  })

  test("blocks anywhere else are judged as before, their link urls and labels read", async () => {
    const blocks = (url: string, text: string) => chips(link(url, text))
    expect(
      await mcp(post, {
        blocks: blocks(`https://example.com/${OLD.builder}`, "PR"),
        channel: "C0MADEUP02",
        text: "PR",
      }),
    ).toContain(`"${OLD.builder}"`)
    expect(
      await mcp(post, {
        blocks: blocks("https://example.com", OLD.builder),
        channel: "C0MADEUP02",
        text: "PR",
      }),
    ).toContain(`"${OLD.builder}"`)
  })

  test.each([
    ["an unsigned post", `curl -d channel=${CLEARED} -d text="Question: hi" ${API}`],
    ["a post naming it in the URL", `curl -d text="hi" "${API}?channel=${CLEARED}"`],
    [
      "a signed post",
      `curl -d '{"channel":"${CLEARED}","text":"hi\\n_Sent via Playground_"}' ${API}`,
    ],
    [
      "a post with its fields in the query alone",
      `curl -X POST "${API}?channel=${CLEARED}&text=hi"`,
    ],
  ])("curl to #playground is refused, even %s", async (_, command) => {
    expect(await bash(command)).toContain("through the Slack MCP chat tools")
  })

  test.each([
    ["a history read", `curl "https://slack.com/api/conversations.history?channel=${CLEARED}"`],
    ["a -G read", `curl -G -d channel=${CLEARED} https://slack.com/api/conversations.replies`],
    ["a --get read", `curl --get -d channel=${CLEARED} https://slack.com/api/conversations.info`],
  ])("curl reading #playground passes: %s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test.each(["D0EXAMPLE01", "D0EXAMPLE02"])("%s, a post and a thread reply", async (channel) => {
    expect(await mcp(post, { channel, text: `${OLD.builder} merged it` })).toBeUndefined()
    expect(
      await mcp(post, { channel, text: OLD.dispatcher, thread_ts: "1791529307.301699" }),
    ).toBeUndefined()
  })

  test.each([
    ["a form post", `curl -d channel=D0EXAMPLE01 -d text="${OLD.builder}" ${API}`],
    [
      "a form hidden in a JSON-looking body",
      `curl -d '{"channel":"D0EXAMPLE01","x":"&channel=C0MADEUP02&text=${OLD.builder}&"}' ${API}`,
    ],
    [
      "a url-encoded text",
      `curl --data-urlencode channel=D0EXAMPLE01 --data-urlencode "text=${OLD.builder}" ${API}`,
    ],
  ])("curl to a cleared DM is judged as before: %s", async (_, command) => {
    expect(await bash(command)).toContain(`"${OLD.builder}"`)
  })

  test.each([
    ["another channel", "C0MADEUP02"],
    ["another DM", "D0MADEUP12"],
    ["a group DM", "G0MADEUP19"],
    ["a channel by name", "#playground"],
  ])("%s is refused as before", async (_, channel) => {
    expect(await mcp(post, { channel, text: OLD.builder })).toContain("hook refused")
    expect(
      await mcp(post, { channel, text: OLD.builder, thread_ts: "1791529307.301699" }),
    ).toContain("hook refused")
    expect(await bash(`curl -d channel=${channel} -d text="${OLD.builder}" ${API}`)).toContain(
      "hook refused",
    )
  })

  test("a write that also names another channel is refused", async () => {
    expect(
      await bash(
        `curl -d channel=D0EXAMPLE01 -d channel=C0MADEUP02 -d text="${OLD.builder}" ${API}`,
      ),
    ).toContain(`"${OLD.builder}"`)
    expect(
      await bash(
        `curl -d channel=D0EXAMPLE01 -d text="${OLD.builder}" "${API}?channel=C0MADEUP02"`,
      ),
    ).toContain(`"${OLD.builder}"`)
  })

  test.each([
    [
      "a webhook, which posts where its URL is bound",
      `curl -d '{"channel":"D0EXAMPLE01","text":"${OLD.builder}"}' https://hooks.slack.com/services/T0/B0/X0`,
    ],
    [
      "files.upload, which posts to channels",
      `curl -d channel=D0EXAMPLE01 -d channels=C0MADEUP02 -d content=${OLD.builder} https://slack.com/api/files.upload`,
    ],
    [
      "files.completeUploadExternal, which posts to channel_id",
      `curl -d channel=D0EXAMPLE01 -d channel_id=C0MADEUP02 -d initial_comment=${OLD.builder} https://slack.com/api/files.completeUploadExternal`,
    ],
    [
      "a chat method naming another destination too",
      `curl -d channel=D0EXAMPLE01 -d channel_id=C0MADEUP02 -d text=${OLD.builder} ${API}`,
    ],
    [
      "a chat method over http",
      `curl -d channel=D0EXAMPLE01 -d text=${OLD.builder} http://slack.com/api/chat.postMessage`,
    ],
  ])("a cleared channel field does not clear %s", async (_, command) => {
    expect(await bash(command)).toContain(`"${OLD.builder}"`)
  })

  test.each([
    ["channel_id", { channel: "D0EXAMPLE01", channel_id: "C0MADEUP02", text: OLD.builder }],
    ["channels", { channel: "D0EXAMPLE01", channels: "C0MADEUP02", text: OLD.builder }],
    [
      "conversation_id",
      { channel: "D0EXAMPLE01", conversation_id: "C0MADEUP02", text: OLD.builder },
    ],
  ])("an MCP write that also names %s is judged as before", async (_, input) => {
    expect(await mcp("mcp__slack-x__chat_post_message", input)).toContain(`"${OLD.builder}"`)
  })

  test.each(["usergroups_create", "usergroups_update"])(
    "an MCP %s naming a cleared channel is judged as before",
    async (tool) => {
      const input = { channel: "D0EXAMPLE01", name: OLD.builder }
      expect(await mcp(`mcp__slack-shared__${tool}`, input)).toContain(`"${OLD.builder}"`)
    },
  )

  test.each(["mcp__claude_ai_Slack__slack_send_message", "mcp__slack-x__slack_send_message"])(
    "the connector's %s passes a signed post to #playground, refuses an unsigned one, and clears no DM",
    async (tool) => {
      expect(await mcp(tool, { channel_id: CLEARED, message: SIGNED })).toBeUndefined()
      expect(
        await mcp(tool, { channel_id: CLEARED, message: SIGNED, thread_ts: "1.2" }),
      ).toBeUndefined()
      expect(await mcp(tool, { channel_id: CLEARED, message: "Question: hi" })).toContain(
        "ends with the line _Sent via Playground_",
      )
      expect(await mcp(tool, { channel_id: CLEARED })).toContain(
        "ends with the line _Sent via Playground_",
      )
      for (const channel_id of ["D0EXAMPLE01", "D0EXAMPLE02", "C0MADEUP02"]) {
        expect(await mcp(tool, { channel_id, message: OLD.builder })).toContain(`"${OLD.builder}"`)
      }
      expect(
        await mcp(tool, { channel: "C0MADEUP02", channel_id: CLEARED, message: SIGNED }),
      ).toContain("hook refused")
    },
  )

  test("a write whose channel it cannot read is refused", async () => {
    expect(await mcp(post, { text: OLD.builder })).toContain(`"${OLD.builder}"`)
    expect(await mcp(post, { channel: ["D0EXAMPLE01"], text: OLD.builder })).toContain(
      `"${OLD.builder}"`,
    )
    expect(await bash(`curl -d channel="$CH" -d text="${OLD.builder}" ${API}`)).toContain(
      `"${OLD.builder}"`,
    )
    expect(await bash(`curl -d text="${OLD.builder}" ${API}`)).toContain(`"${OLD.builder}"`)
  })
})

describe("a Acme write it cannot read is refused", () => {
  test.each([
    ["a body in a variable", `gh pr comment 1 ${LW} --body "$MSG"`],
    ["a body file that does not exist yet", `gh pr comment 1 ${LW} --body-file later.md`],
    ["a commit message in a variable", `git commit -m "$MSG"`],
    ["a pushed branch in a variable", `git push origin "$BRANCH"`],
    [
      "curl to Slack from a missing file",
      "curl -d @missing.json https://slack.com/api/chat.postMessage",
    ],
    ["a Linear body from stdin", "make-body | curl -d @- https://api.linear.app/graphql"],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toContain("cannot read its text")
  })

  test.each([
    ["a --body-file named through a variable", `gh pr comment 1 ${LW} --body-file "$S/comment.md"`],
    [
      "a --body-file a heredoc writes in the same call",
      `cat > /tmp/body.md <<EOF\nShipped $VERSION\nEOF\ngh pr comment 1 ${LW} --body-file /tmp/body.md`,
    ],
  ])(
    "a refusal for text it cannot read names the Write-then-literal-path recipe (%s)",
    async (_, command) => {
      const reason = await bash(command)
      expect(reason).toContain("cannot read its text")
      expect(reason).toContain("write the text to a file with the Write tool first")
      expect(reason).toContain("--body-file /abs/body.md")
      expect(reason).toContain(NOT_RUN)
    },
  )

  test.each([
    [
      "whose input is not an object",
      "mcp__slack-shared__chat_post_message",
      "text",
      "is not an object",
    ],
    [
      "on GitHub whose owner it cannot read",
      "mcp__github-shared__add_issue_comment",
      { body: "x", owner: 7 },
      "owner is not text",
    ],
  ])("an MCP write %s names the input fix, not the Bash recipe", async (_, tool, input, cause) => {
    const reason = await mcp(tool, input)
    expect(reason).toContain(cause)
    expect(reason).toContain("Pass the input as an object whose fields are strings.")
    expect(reason).not.toContain("--body-file")
  })
})

describe("a write it cannot place", () => {
  test("is refused when its text holds a term", async () => {
    expect(await bash(`gh pr comment "$N" -R acme/archive --body ${OLD.dispatcher}`)).toContain(
      "cannot tell whether it writes to a guarded org",
    )
    expect(
      await bash(
        `gh api graphql -f query='mutation { addComment(input: {body: "${OLD.dispatcher}"}) { clientMutationId } }'`,
      ),
    ).toContain("cannot tell whether it writes to a guarded org")
  })

  test.each([
    ["a pull request in a variable", `gh pr comment "$N" -R acme/archive --body ${OLD.dispatcher}`],
    ["a checkout in a variable", `git -C "$WT" commit -m ${OLD.dispatcher}`],
    ["a URL in a variable", `curl -d text=${OLD.dispatcher} "$URL"`],
  ])("names the literal fix and that none of the call ran (%s)", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("cannot tell whether it writes to a guarded org")
    expect(reason).toContain("by its literal value")
    expect(reason).toContain("git -C /abs/checkout")
    expect(reason).toContain(NOT_RUN)
  })

  test.each([
    [
      "a pull request in a variable",
      `gh pr comment "$N" -R acme/archive --body "${OLD.dispatcher} found it"`,
      "the pull request number or URL",
      `gh pr comment 5 -R acme/archive --body "${OLD.dispatcher} found it"`,
    ],
    [
      "a GraphQL node id",
      `gh api graphql -f query='mutation { addComment(input: {body: "${OLD.dispatcher}"}) { clientMutationId } }'`,
      "a REST endpoint naming the repository in place of a GraphQL node id",
      `gh api repos/acme/archive/issues/5/comments -f body=${OLD.dispatcher}`,
    ],
  ])("names the fix that clears %s, and that fix passes", async (_, command, fix, fixed) => {
    expect(await bash(command)).toContain(fix)
    expect(await bash(fixed)).toBeUndefined()
  })

  const lost = (write: string) => `W=${dirs.lw}; cd $W && ${write}`

  test.each([
    ["gh pr create", () => lost(`gh pr create -d -B develop -t t -F "$S/x"`)],
    ["gh pr comment", () => lost(`gh pr comment 5613 -F "$S/x"`)],
    ["gh pr comment on an unreadable number", () => lost(`gh pr comment $N -F "$S/x"`)],
    ["gh pr edit", () => lost("gh pr edit 5613 --body ok")],
    ["gh issue create", () => lost("gh issue create -t t --body ok")],
    ["gh api {owner}", () => lost(`gh api repos/{owner}/{repo}/issues/5/comments -F body=@$S/x`)],
    [
      "gh api {owner} with a readable body",
      () => lost("gh api repos/{owner}/{repo}/issues/5/comments -f body=ok"),
    ],
    ["gh through env -C", () => `env -C "$W" gh pr comment 5613 --body ok`],
  ])(
    "%s with no --repo, from a directory it cannot follow, is refused whatever its text",
    async (_, command) => {
      const reason = await bash(command(), dirs.lm)
      expect(reason).toContain("cannot tell which repository it writes to")
      expect(reason).toContain("--repo <owner>/<name>")
      expect(reason).toContain(NOT_RUN)
    },
  )

  test("the same write behind a literal cd is judged on its body", async () => {
    expect(
      await bash(`cd ${dirs.lw} && gh pr create -d -B develop -t t -F "$S/x"`, dirs.lm),
    ).toContain("cannot read its text")
    expect(await bash(`cd ${dirs.lw} && gh pr comment 5613 --body ok`, dirs.lm)).toBeUndefined()
  })

  test("a write naming --repo behind cd $W is judged on its body", async () => {
    expect(await bash(lost(`gh pr comment 5613 ${LW} -F "$S/x"`), dirs.lm)).toContain(
      "cannot read its text",
    )
    expect(await bash(lost(`gh pr comment 5613 ${LW} --body ok`), dirs.lm)).toBeUndefined()
    expect(
      await bash(lost(`gh pr comment 5613 --repo acme/archive --body ${OLD.dispatcher}`), dirs.lm),
    ).toBeUndefined()
    expect(
      await bash(
        lost(`gh api repos/acme/archive/issues/5/comments -f body=${OLD.dispatcher}`),
        dirs.lm,
      ),
    ).toBeUndefined()
    expect(
      await bash(lost(`gh pr comment https://github.com/acme-blue/app/pull/5 -F "$S/x"`), dirs.lm),
    ).toContain("cannot read its text")
    expect(await bash(lost(`GH_REPO=acme-blue/app gh pr comment 5 -F "$S/x"`), dirs.lm)).toContain(
      "cannot read its text",
    )
  })

  test("passes when its text holds none, readable or not", async () => {
    expect(await bash(`gh pr comment "$N" -R acme/archive --body "Fixed"`)).toBeUndefined()
    expect(await bash(`gh pr comment "$N" -R acme/archive --body "$MSG"`)).toBeUndefined()
  })

  test.each([
    ["-R in a variable", `gh pr comment 1 -R "$REPO" --body "Fixed"`],
    ["-R in a variable with a body it cannot read", `gh pr comment 1 -R "$REPO" -F "$S/x"`],
    ["GH_REPO in a variable", `GH_REPO=$R gh pr comment 5 --body ok`],
    ["a gh api repository in a variable", `gh api repos/$R/issues/5/comments -f body=ok`],
    ["a gh api endpoint in a variable", `gh api "$E" -f body=ok`],
    ["a gh api repository path in a variable", `gh api "repos/$R" -X PATCH -f description=ok`],
  ])("a gh write naming its repository by %s is refused whatever its text", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("names it through a value the hook cannot read")
    expect(reason).toContain("--repo <owner>/<name>")
    expect(reason).toContain(NOT_RUN)
  })

  test("a gh api endpoint whose repository is literal is placed by it", async () => {
    expect(
      await bash(`gh api repos/acme/archive/issues/$N/comments -f body=${OLD.dispatcher}`),
    ).toBeUndefined()
    expect(
      await bash(`gh api repos/acme-blue/app/issues/$N/comments -f body=${OLD.dispatcher}`),
    ).toContain("a factory term")
  })

  test("a gh api endpoint outside any repository, with a variable in it, is judged on its text", async () => {
    expect(await bash("gh api -X PATCH notifications/threads/$ID -f body=ok")).toBeUndefined()
    expect(await bash("gh api -X PUT user/starred/$X")).toBeUndefined()
    expect(
      await bash(`gh api -X PATCH notifications/threads/$ID -f body=${OLD.dispatcher}`),
    ).toContain("cannot tell whether it writes to a guarded org")
  })
})

describe("its input", () => {
  test("refuses input it cannot parse that may carry a term to Acme", async () => {
    expect(
      await check(
        `{ not json: slack ${OLD.dispatcher}`,
        { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") },
        undefined,
        lists,
      ),
    ).toContain("could not parse")
  })

  test("allows input it cannot parse that holds no term", async () => {
    expect(
      await check(
        "{ not json: slack hello",
        { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") },
        undefined,
        lists,
      ),
    ).toBeUndefined()
  })

  test("an error inside the hook refuses only a call that may carry a term", async () => {
    const deep = "$(".repeat(200_000)
    expect(await bash(`gh pr comment 1 --body hi && echo ${deep}`)).toBeUndefined()
    expect(await bash(`gh pr comment 1 --body ${OLD.dispatcher} && echo ${deep}`)).toContain(
      "could not read this call",
    )
  })
})

type Entry = { hooks: { command: string; timeout?: number; type: string }[]; matcher: string }

describe("as Claude Code runs it", () => {
  const entry = async () => {
    const settings = (await Bun.file(join(root, "scripts", "factory-settings.json")).json()) as {
      hooks: { PreToolUse: Entry[] }
    }
    const found = settings.hooks.PreToolUse.find((e) =>
      e.hooks.some((h) => h.command.includes("scripts/hooks/no-playground-leak.ts")),
    )
    if (!found)
      throw new Error("scripts/factory-settings.json registers no no-playground-leak hook")
    return found
  }

  test("the factory settings' matcher takes Bash and the Linear, Slack and GitHub tools", async () => {
    const matcher = new RegExp((await entry()).matcher)
    for (const tool of [
      "Bash",
      "mcp__linear-shared__save_issue",
      "mcp__claude_ai_Linear__save_comment",
      "mcp__slack-shared__chat_post_message",
      "mcp__slack-local__chat_update",
      "mcp__github-shared__create_pull_request",
      "mcp__GitHub__add_issue_comment",
    ]) {
      expect(matcher.test(tool)).toBe(true)
    }
    for (const tool of ["Read", "Write", "Edit", "mcp__notes__save_note"]) {
      expect(matcher.test(tool)).toBe(false)
    }
  })

  const hook = async (command: string, payload: object, env: Record<string, string>) => {
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: scratch,
      env: { ...process.env, PLAYGROUND_ROLE: "worker", ...env },
      stderr: "pipe",
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: "pipe",
    })
    return { code: await proc.exited, stderr: await new Response(proc.stderr).text() }
  }

  const leaky = {
    tool_input: { text: OLD.dispatcher },
    tool_name: "mcp__slack-shared__chat_post_message",
  }

  // CLAUDE_PROJECT_DIR is a folder in no repository, so only PLAYGROUND_REPO can name the checkout
  const away = (home: string, repo: string) => ({
    CLAUDE_PROJECT_DIR: home,
    GIT_CEILING_DIRECTORIES: scratch,
    HOME: home,
    PLAYGROUND_REPO: repo,
  })

  test("its command runs the script from the checkout PLAYGROUND_REPO names, with no skills in HOME, and exits 2 to refuse", async () => {
    const home = join(scratch, "home")
    await mkdir(home, { recursive: true })
    const [{ command }] = (await entry()).hooks
    const refused = await hook(command, leaky, away(home, root))
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain("no-playground-leak hook refused")
    const clean = { ...leaky, tool_input: { text: "PR is up" } }
    expect(await hook(command, clean, away(home, root))).toEqual({ code: 0, stderr: "" })
  })

  test("a hook that finds no checkout lets the call through", async () => {
    const home = join(scratch, "nowhere")
    await mkdir(home, { recursive: true })
    const [{ command }] = (await entry()).hooks
    expect(await hook(command, leaky, away(home, ""))).toEqual({ code: 0, stderr: "" })
  })

  test("the script runs on its own", async () => {
    const proc = Bun.spawn(["bun", script], {
      env: { ...process.env, PLAYGROUND_ROLE: "worker" },
      stderr: "pipe",
      stdin: new Blob([JSON.stringify(leaky)]),
    })
    expect(await proc.exited).toBe(2)
  })
})
