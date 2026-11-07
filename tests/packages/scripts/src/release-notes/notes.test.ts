import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderNotes } from "../../../../../packages/scripts/src/release-notes/notes"
import { check } from "../../../../../scripts/hooks/no-public-leak"
import { storeWith } from "../../../../scripts/hooks/render-set"

const REPO = "acme/widgets"
const URL = `https://github.com/${REPO}`

// Oldest first, as GitHub's compare API lists them; every name and login is made up.
const COMMITS = [
  {
    login: "pat-dev",
    message: "fix(PG-12): the board keeps its order (#101)",
    name: "Pat Example",
    parents: 1,
    sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "pat-dev",
    message: "feat(PG-14): one card takes a list (#103)\n\nBody text.",
    name: "Pat Example",
    parents: 1,
    sha: "b1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "sam-ops",
    message: "docs: name the new step (#104)",
    name: "Sam Example",
    parents: 1,
    sha: "c1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "pat-dev",
    message: "ci(release): 🚀 merge canary into main (#105)",
    name: "Pat Example",
    parents: 1,
    sha: "d1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "pat-dev",
    message: "Merge pull request #106 from acme/canary\n\nci(release): 🚀 merge canary into main",
    name: "Pat Example",
    parents: 2,
    sha: "e1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: null,
    message: "Tidy the readme",
    name: null,
    parents: 1,
    sha: "f1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "renovate[bot]",
    message: "fix(deps): bump a thing (#107)",
    name: "renovate[bot]",
    parents: 1,
    sha: "a2b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "sam-ops",
    message: "feat!: drop the old route (#108)",
    name: "Sam Example",
    parents: 1,
    sha: "b2b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "sam-ops",
    message: "fix: a fix with no pull request",
    name: "Sam Example",
    parents: 1,
    sha: "c2b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
]

describe("renderNotes (PG-1213)", () => {
  const notes = renderNotes({ commits: COMMITS, from: "v0.0.1", repo: REPO, to: "v0.0.2" })

  test("renders ZeroStarter's shape: the compare link, emoji sections in changelogen's order, then each contributor's login alone", () => {
    expect(notes).toBe(
      [
        `[compare changes](${URL}/compare/v0.0.1...v0.0.2)`,
        "",
        "### 🚀 Enhancements",
        "",
        `- **PG-14:** One card takes a list ([#103](${URL}/pull/103))`,
        `- ⚠️  Drop the old route ([#108](${URL}/pull/108))`,
        "",
        "### 🩹 Fixes",
        "",
        `- **PG-12:** The board keeps its order ([#101](${URL}/pull/101))`,
        `- **deps:** Bump a thing ([#107](${URL}/pull/107))`,
        `- A fix with no pull request ([c2b2c3d](${URL}/commit/c2b2c3d4e5f60718293a4b5c6d7e8f9012345678))`,
        "",
        "### 📖 Documentation",
        "",
        `- Name the new step ([#104](${URL}/pull/104))`,
        "",
        "### 📌 Other changes",
        "",
        `- Tidy the readme ([f1b2c3d](${URL}/commit/f1b2c3d4e5f60718293a4b5c6d7e8f9012345678))`,
        "",
        "#### ⚠️ Breaking Changes",
        "",
        `- ⚠️  Drop the old route ([#108](${URL}/pull/108))`,
        "",
        "### ❤️ Contributors",
        "",
        "- @pat-dev",
        "- @sam-ops",
        "",
      ].join("\n"),
    )
  })

  test("hides ci commits, as ZeroStarter's changelog.config.json does, and drops merge commits", () => {
    expect(notes).not.toContain("merge canary into main")
    expect(notes).not.toContain("Merge pull request")
  })

  test("a commit outside the Conventional Commits types lands in the catch-all section", () => {
    const wip = renderNotes({
      commits: [
        {
          login: "pat-dev",
          message: "wip: half a thing (#9)",
          name: "Pat Example",
          parents: 1,
          sha: "9".repeat(40),
        },
      ],
      from: "v1",
      repo: REPO,
      to: "v2",
    })
    expect(wip).toContain(`### 📌 Other changes\n\n- Wip: half a thing ([#9](${URL}/pull/9))`)
  })

  test("lists no contributors section when every author is a bot or has no login", () => {
    const bots = renderNotes({
      commits: [
        {
          login: "renovate[bot]",
          message: "chore: bump (#1)",
          name: "renovate[bot]",
          parents: 1,
          sha: "1".repeat(40),
        },
      ],
      from: "v1",
      repo: REPO,
      to: "v2",
    })
    expect(bots).not.toContain("Contributors")
    expect(bots).toBe(
      `[compare changes](${URL}/compare/v1...v2)\n\n### 🏡 Chore\n\n- Bump ([#1](${URL}/pull/1))\n`,
    )
  })

  // one made-up feat commit with the given body, rendered alone
  const withBody = (body: string) =>
    renderNotes({
      commits: [
        {
          login: "pat-dev",
          message: `feat: a made-up change (#20)\n\n${body}`,
          name: "Pat Example",
          parents: 1,
          sha: "2".repeat(40),
        },
      ],
      from: "v1",
      repo: REPO,
      to: "v2",
    })

  test.each([
    ["BREAKING CHANGE: the old route is gone"],
    ["Some context first.\n\nBREAKING-CHANGE: the old route is gone"],
  ])("a footer line that begins with the breaking token marks the commit breaking: %p", (body) => {
    const notes = withBody(body)
    expect(notes).toContain(`- ⚠️  A made-up change ([#20](${URL}/pull/20))`)
    expect(notes).toContain("#### ⚠️ Breaking Changes")
  })

  test.each([
    ["  breaking (! or BREAKING CHANGE:) → ⚠️ prefix, and #### ⚠️ Breaking Changes"],
    ["The notes name a BREAKING CHANGE: footer as breaking."],
    ["breaking change: written in lower case, which the token is not"],
  ])(
    "the phrase anywhere but at a line's start, or not in upper case, marks nothing: %p",
    (body) => {
      const notes = withBody(body)
      expect(notes).toContain(`- A made-up change ([#20](${URL}/pull/20))`)
      expect(notes).not.toContain("Breaking Changes")
    },
  )

  // one made-up fix commit with the given subject, rendered alone, its one Fixes line
  const fixLine = (subject: string) =>
    renderNotes({
      commits: [
        {
          login: "pat-dev",
          message: `fix(PG-30): ${subject} (#30)`,
          name: "Pat Example",
          parents: 1,
          sha: "3".repeat(40),
        },
      ],
      from: "v1",
      repo: REPO,
      to: "v2",
    })
      .split("\n")
      .find((l) => l.startsWith("- **PG-30:**"))

  test.each([
    "ops-made-up-start starts a worker for each open ticket",
    "no-made-up-delete reads a heredoc as its script",
    "bun run ask builds a stale dist before it runs",
    "gh pr view reads the head once",
    "rm --restore brings a worktree back",
    "--all prints every changed line",
    "spawn.sh refuses a second start",
    "hooks:differential says when it cuts lines",
    "madeUpReader keeps its cache",
    "`made-up` keeps its quotes",
  ])(
    "a first word that is a command, a flag, a file or a code-like name keeps its case: %p",
    (subject) => {
      expect(fixLine(subject)).toBe(`- **PG-30:** ${subject} ([#30](${URL}/pull/30))`)
    },
  )

  test.each([
    ["the board keeps its order", "The board keeps its order"],
    ["a received row reads as a sent one does", "A received row reads as a sent one does"],
    ["the --made-up refusal names its route", "The --made-up refusal names its route"],
    ["an --all run prints every line", "An --all run prints every line"],
  ])(
    "a plain first word gets its capital, an article before a flag included: %p",
    (subject, shown) => {
      expect(fixLine(subject)).toBe(`- **PG-30:** ${shown} ([#30](${URL}/pull/30))`)
    },
  )

  // three made-up commits: one author twice with a name, one with none
  const named = (owner?: string[]) =>
    renderNotes({
      commits: [
        {
          login: "pat-dev",
          message: "fix: one (#1)",
          name: "Pat Example",
          parents: 1,
          sha: "4".repeat(40),
        },
        {
          login: "pat-dev",
          message: "fix: two (#2)",
          name: "Pat Example",
          parents: 1,
          sha: "5".repeat(40),
        },
        {
          login: "sam-ops",
          message: "fix: three (#3)",
          name: null,
          parents: 1,
          sha: "6".repeat(40),
        },
      ],
      from: "v1",
      owner,
      repo: REPO,
      to: "v2",
    })
  const contributors = (notes: string) => notes.split("### ❤️ Contributors\n\n")[1]

  test("a contributor reads as the login alone when no owner names are set", () => {
    expect(contributors(named())).toBe("- @pat-dev\n- @sam-ops\n")
  })

  test("the owner's line carries the author name's words owner.names lists, every other line the login alone", () => {
    expect(contributors(named(["pat", "pat-dev"]))).toBe("- Pat @pat-dev\n- @sam-ops\n")
  })

  test("an owner whose author name holds no owner.names word reads as the login alone", () => {
    expect(contributors(named(["pat-dev"]))).toBe("- @pat-dev\n- @sam-ops\n")
  })

  test("the public repo's leak guard passes the owner's line in a ship's notes file, and refuses the same text as an issue's body", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "notes-leak-"))
    const data = storeWith(
      join(scratch, "data"),
      {
        "no-public-leak.json": JSON.stringify({
          companies: ["Vantorix"],
          handles: ["pat-dev"],
          linearKeys: ["VX"],
          names: ["Pat"],
          slackIds: ["C0FAKE1234"],
        }),
      },
      {
        "factory.archiveRepo": "acme/archive",
        "factory.publicRepo": REPO,
        "owner.names": ["pat", "pat-dev"],
      },
    )
    const file = join(scratch, "notes.md")
    await Bun.write(file, named(["pat", "pat-dev"]))
    const write = (command: string) =>
      check(
        JSON.stringify({
          cwd: scratch,
          hook_event_name: "PreToolUse",
          tool_input: { command },
          tool_name: "Bash",
        }),
        { CLAUDE_CONFIG_DIR: scratch, PLAYGROUND_DATA_DIR: data },
      )
    expect(await write(`gh release create v2 --repo ${REPO} --notes-file ${file}`)).toBeUndefined()
    expect(await write(`gh issue create --repo ${REPO} --title x --body-file ${file}`)).toContain(
      "no-public-leak",
    )
  })
})
