import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { UNSET_REPOS } from "../../../packages/scripts/src/trace-count/kinds"
import { currentDir } from "../../../packages/settings/src/rendered"
import { storeMarker } from "../../../scripts/hooks/lists"
import { check } from "../../../scripts/hooks/no-public-leak"
import { storeWith } from "./render-set"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-public-leak.ts")
// Made-up values, one per list key.
const TERMS = {
  companies: ["Vantorix"],
  handles: ["quillco", "qmarsh"],
  linearKeys: ["VX"],
  names: ["Quilla Marsh"],
  slackIds: ["C0MADE0401"],
}
let scratch = ""
let stored = ""
let stranger = ""

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "no-public-leak-"))
  stored = join(scratch, "stored")
  stranger = join(scratch, "stranger")
  await mkdir(stranger, { recursive: true })
  storeWith(
    stored,
    { "no-public-leak.json": JSON.stringify(TERMS) },
    { "factory.archiveRepo": "acme/archive", "factory.publicRepo": "quillco/playground" },
  )
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

const env = (data: string) => ({ CLAUDE_CONFIG_DIR: scratch, PLAYGROUND_DATA_DIR: data })
const bash = (command: string) =>
  JSON.stringify({
    cwd: scratch,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  })
const run = (raw: string, data = stored) => check(raw, env(data))

const R = "--repo quillco/playground"
// The factory's repository, the first the guard keeps while factory.publicRepo is unset.
const UNSET_R = `--repo ${UNSET_REPOS.public[0]}`

describe("a write to the public repository holding private text is refused", () => {
  test.each([
    ["gh pr create", `gh pr create ${R} --title "Fix export" --body "Asked by Quilla Marsh"`],
    ["gh pr edit", `gh pr edit 1 ${R} --title "Quilla Marsh's fix"`],
    ["gh pr comment", `gh pr comment 1 ${R} --body "Quilla Marsh asked"`],
    ["gh pr review", `gh pr review 1 ${R} --approve -b "Quilla Marsh approves"`],
    ["gh issue create", `gh issue create ${R} -t "From Quilla Marsh" -b x`],
    ["gh issue edit", `gh issue edit 2 ${R} -b "Quilla Marsh"`],
    ["gh issue comment", `gh issue comment 2 ${R} -b "Quilla Marsh"`],
    [
      "gh api POST to a comment",
      `gh api -X POST repos/quillco/playground/issues/1/comments -f body="Quilla Marsh"`,
    ],
    [
      "gh api PATCH to a pull request",
      `gh api -X PATCH repos/quillco/playground/pulls/1 -f title="Quilla Marsh"`,
    ],
  ])("%s", async (_, command) => {
    const reason = await run(bash(command))
    expect(reason).toContain("no-public-leak hook refused")
    expect(reason).toContain("a person's name")
    expect(reason).not.toContain("Quilla")
  })

  test("the GitHub MCP's comment", async () => {
    const reason = await run(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_input: {
          body: "Quilla Marsh asked",
          issue_number: 1,
          owner: "quillco",
          repo: "playground",
        },
        tool_name: "mcp__github-shared__add_issue_comment",
      }),
    )
    expect(reason).toContain("a person's name")
    expect(reason).not.toContain("Quilla")
  })

  test.each([
    ["a handle", "thanks @qmarsh", "qmarsh"],
    ["a company term", "built for Vantorix", "Vantorix"],
    ["a Slack id", "settled in C0MADE0401", "C0MADE0401"],
    ["a Linear key", "fixes VX-42", "VX-42"],
    ["an email address", "mail quilla@example.com", "quilla@example.com"],
    ["an archive link", "see https://github.com/acme/archive/pull/9", "acme/archive"],
  ])("its reason names %s, never the text", async (kind, body, term) => {
    const reason = await run(bash(`gh pr comment 1 ${R} --body "${body}"`))
    expect(reason).toContain(kind)
    expect(reason).not.toContain(term)
  })

  test("a body it cannot read refuses", async () => {
    expect(await run(bash(`gh pr comment 1 ${R} --body "$BODY"`))).toContain(
      "no-public-leak hook refused",
    )
  })
})

describe("what it lets through", () => {
  test.each([
    ["plain words", `gh pr comment 1 ${R} --body "Fixes the export button"`],
    [
      "a link to the repository itself",
      `gh pr comment 1 ${R} --body "see github.com/quillco/playground/pull/3"`,
    ],
    [
      "a write to another repository",
      `gh pr comment 1 --repo acme/app --body "Quilla Marsh asked"`,
    ],
    ["a read", `gh pr view 1 ${R}`],
    ["a git commit", `git commit -m "Quilla Marsh"`],
  ])("%s", async (_, command) => {
    expect(await run(bash(command))).toBeUndefined()
  })

  test("factory.publicRepo, once set, is the repository it guards", async () => {
    const moved = storeWith(
      join(scratch, "moved"),
      { "no-public-leak.json": JSON.stringify(TERMS) },
      {
        "factory.publicRepo": "acme/public",
      },
    )
    const said = `--body "Quilla Marsh asked"`
    expect(await run(bash(`gh pr comment 1 --repo acme/public ${said}`), moved)).toContain(
      "a person's name",
    )
    expect(await run(bash(`gh pr comment 1 ${R} ${said}`), moved)).toBeUndefined()
  })

  test("factory.publicRepo set empty leaves the guard on the repository it guards while unset", async () => {
    const empty = storeWith(
      join(scratch, "empty-public"),
      { "no-public-leak.json": JSON.stringify(TERMS) },
      { "factory.publicRepo": "" },
    )
    expect(
      await run(bash(`gh pr comment 1 ${UNSET_R} --body "Quilla Marsh asked"`), empty),
    ).toContain("a person's name")
  })

  test("while factory.publicRepo is unset it guards Yard's repository too", async () => {
    const empty = storeWith(
      join(scratch, "unset-yard"),
      { "no-public-leak.json": JSON.stringify(TERMS) },
      { "factory.publicRepo": "" },
    )
    expect(
      await run(
        bash(`gh pr comment 1 --repo nrjdalal/playground-yard --body "Quilla Marsh asked"`),
        empty,
      ),
    ).toContain("a person's name")
  })

  test("factory.publicRepo set to a list guards each, and reads past each one's name", async () => {
    const both = storeWith(
      join(scratch, "public-list"),
      { "no-public-leak.json": JSON.stringify(TERMS) },
      { "factory.publicRepo": ["quillco/playground", "quillco/yard"] },
    )
    const said = `--body "Quilla Marsh asked"`
    for (const repo of ["quillco/playground", "quillco/yard"])
      expect(await run(bash(`gh pr comment 1 --repo ${repo} ${said}`), both)).toContain(
        "a person's name",
      )
    expect(
      await run(
        bash(`gh pr comment 1 --repo quillco/yard --body "see github.com/quillco/yard/pull/3"`),
        both,
      ),
    ).toBeUndefined()
  })

  test("a stranger's clone with no store still refuses the built-in kinds, and lets a key through, since keys come from the list alone", async () => {
    expect(
      await run(bash(`gh pr comment 1 ${UNSET_R} --body "mail quilla@example.com"`), stranger),
    ).toContain("an email address")
    expect(
      await run(bash(`gh pr comment 1 ${UNSET_R} --body "closes VX-1"`), stranger),
    ).toBeUndefined()
    expect(
      await run(bash(`gh pr comment 1 ${UNSET_R} --body "Quilla Marsh"`), stranger),
    ).toBeUndefined()
  })
})

describe("it fails closed on its list", () => {
  const write = bash(`gh pr comment 1 ${R} --body "Fixes it"`)
  const data = (name: string) => join(scratch, name)

  test("a store that lacks the list refuses a write, naming the file, the write that seeds it and its shape", async () => {
    const reason = await run(write, storeWith(data("lacks"), {}))
    expect(reason).toContain("no-public-leak hook refused this call:")
    expect(reason).toContain("holds no hooks/no-public-leak.json")
    expect(reason).toContain(
      "tell your lead, and the dispatcher hands the owner ! playground ext put <login> list no-public-leak <file> --reason <why> to type in the dispatcher's terminal window",
    )
    expect(reason).toContain(
      "The list is a JSON object with an array of strings under each of companies, handles, linearKeys, names, slackIds",
    )
    expect(reason).not.toContain("ext import")
  })

  describe("a store that lacks the list", () => {
    const lacks = () => storeWith(data("lacks-reads"), {})
    const mcp = (tool: string, input: Record<string, unknown>) =>
      JSON.stringify({
        cwd: scratch,
        hook_event_name: "PreToolUse",
        tool_input: input,
        tool_name: tool,
      })

    test.each([
      ["git log", bash("git log --oneline -5")],
      ["git remote -v", bash("git remote -v")],
      ["gh issue list", bash(`gh issue list ${R}`)],
      ["gh pr view", bash(`gh pr view 1 ${R}`)],
      ["gh api GET", bash("gh api repos/quillco/playground/issues")],
      ["a read over a .git path", bash("cat .git/worktrees/a/HEAD")],
      ["a grep over a worktree's .git file", bash("grep gitdir .git")],
    ])("lets %s run", async (_, raw) => {
      expect(await run(raw, lacks())).toBeUndefined()
    })

    test.each([
      ["gh issue create", bash(`gh issue create ${R} -t "Fix export" -b "Fixes it"`)],
      ["git push", bash("git push https://github.com/quillco/playground.git main")],
      ["git push to a remote it cannot place", bash("git push origin main")],
      ["gh api DELETE", bash("gh api -X DELETE repos/quillco/playground/issues/1/labels/x")],
      [
        "gh api POST",
        bash(`gh api -X POST repos/quillco/playground/issues/1/comments -f body="Fixes it"`),
      ],
      [
        "the GitHub MCP's read",
        mcp("mcp__github-shared__list_issues", { owner: "quillco", repo: "playground" }),
      ],
      [
        "the GitHub MCP's comment",
        mcp("mcp__github-shared__add_issue_comment", {
          body: "Fixes it",
          issue_number: 1,
          owner: "quillco",
          repo: "playground",
        }),
      ],
      [
        "a Slack MCP post",
        mcp("mcp__slack-shared__chat_post_message", { channel: "C0MADE0404", text: "hi" }),
      ],
    ])("refuses %s", async (_, raw) => {
      expect(await run(raw, lacks())).toContain("holds no hooks/no-public-leak.json")
    })
  })

  test("an empty store folder refuses a write", async () => {
    await mkdir(storeMarker({ PLAYGROUND_DATA_DIR: data("unrendered") }), { recursive: true })
    expect(await run(write, data("unrendered"))).toContain("holds no hooks/no-public-leak.json")
  })

  test.each([
    ["empty", ""],
    ["{}", "{}"],
    ["malformed", "{ names: ["],
  ])("a list that is %s refuses a write", async (name, text) => {
    expect(
      await run(write, storeWith(data(`list-${name}`), { "no-public-leak.json": text })),
    ).toContain("no-public-leak hook refused this call: its list")
  })

  test("a store that lacks policy.json refuses a write", async () => {
    const bad = storeWith(data("policy-bad"), { "no-public-leak.json": JSON.stringify(TERMS) })
    await rm(join(currentDir(bad), "policy.json"))
    const reason = await run(write, bad)
    expect(reason).toContain("no-public-leak hook refused this call:")
    expect(reason).toContain("holds no policy.json")
  })

  test("a broken list leaves a call that writes nowhere alone", async () => {
    const broken = storeWith(data("list-broken"), { "no-public-leak.json": "{}" })
    expect(await run(bash("ls -la"), broken)).toBeUndefined()
  })
})

describe("as Claude Code runs it", () => {
  test("the script exits 2 with the reason on stderr for a factory session", async () => {
    const proc = Bun.spawn(["bun", script], {
      env: { ...process.env, ...env(stored), PLAYGROUND_ROLE: "worker" },
      stderr: "pipe",
      stdin: new Blob([bash(`gh pr comment 1 ${R} --body "closes VX-1"`)]),
    })
    expect(await proc.exited).toBe(2)
    expect(await new Response(proc.stderr).text()).toContain("no-public-leak hook refused")
  })
})
