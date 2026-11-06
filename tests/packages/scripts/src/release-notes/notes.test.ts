import { describe, expect, test } from "bun:test"

import { renderNotes } from "../../../../../packages/scripts/src/release-notes/notes"

const REPO = "acme/widgets"
const URL = `https://github.com/${REPO}`

// Oldest first, as GitHub's compare API lists them; every name and login is made up.
const COMMITS = [
  {
    login: "pat-dev",
    message: "fix(PG-12): the board keeps its order (#101)",
    parents: 1,
    sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "pat-dev",
    message: "feat(PG-14): one card takes a list (#103)\n\nBody text.",
    parents: 1,
    sha: "b1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "sam-ops",
    message: "docs: name the new step (#104)",
    parents: 1,
    sha: "c1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "pat-dev",
    message: "ci(release): 🚀 merge canary into main (#105)",
    parents: 1,
    sha: "d1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "pat-dev",
    message: "Merge pull request #106 from acme/canary\n\nci(release): 🚀 merge canary into main",
    parents: 2,
    sha: "e1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: null,
    message: "Tidy the readme",
    parents: 1,
    sha: "f1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "renovate[bot]",
    message: "fix(deps): bump a thing (#107)",
    parents: 1,
    sha: "a2b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "sam-ops",
    message: "feat!: drop the old route (#108)",
    parents: 1,
    sha: "b2b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    login: "sam-ops",
    message: "fix: a fix with no pull request",
    parents: 1,
    sha: "c2b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
]

describe("renderNotes (PG-1213)", () => {
  const notes = renderNotes({ commits: COMMITS, from: "v0.0.1", repo: REPO, to: "v0.0.2" })

  test("renders ZeroStarter's shape: the compare link, emoji sections in changelogen's order, then the contributors' logins", () => {
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
        { login: "pat-dev", message: "wip: half a thing (#9)", parents: 1, sha: "9".repeat(40) },
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
        { login: "renovate[bot]", message: "chore: bump (#1)", parents: 1, sha: "1".repeat(40) },
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
})
