import { describe, expect, test } from "bun:test"

import {
  pullsSetup,
  rosterSetup,
  SETUP,
  sessionsSetup,
} from "../../../../../web/next/src/lib/setup"

describe("SETUP", () => {
  test("each area says what is missing and how to set it up, in one line", () => {
    const line = (setup: { description: string; title: string }) =>
      `${setup.title}. ${setup.description}`
    expect(line(SETUP.changelog)).toBe(
      "No changes yet. Merges and versions appear here once Playground's changelog sync has read them from GitHub.",
    )
    expect(line(SETUP.unreachable)).toBe(
      "Sessions can't be read. Run playground, which starts herdr, the terminal your sessions run in.",
    )
    expect(line(SETUP.sessions)).toBe(
      "No Claude Code sessions yet. Sessions appear here once Playground starts them, the first from the Dashboard's chat.",
    )
    expect(line(SETUP.plan)).toBe(
      "No plan yet. It appears once bundles/plan.json exists in the Dashboard's data folder (PLAYGROUND_DATA_DIR).",
    )
    expect(line(SETUP.usage)).toBe("No usage yet. Usage appears here as Playground runs sessions.")
    expect(line(SETUP.sessionsLog)).toBe(
      "No sessions recorded yet. Sessions appear here as Playground runs them.",
    )
    expect(line(SETUP.github)).toBe(
      "GitHub can't be read. Pull requests are read through GitHub's gh tool: the Settings page's checks set it up and sign it in.",
    )
  })

  test("holds no line for the removed Linear app (PG-302)", () => {
    expect(Object.keys(SETUP)).not.toContain("linear")
  })
})

// A command shape: a playground verb, bun run, gh auth, brew, open -a or gitleaks git. The app speaks to someone who uses the app alone, so an empty area says what happens or names a button or page.
const COMMAND =
  /(?<![\w./~@-])playground [a-z][a-z-]*\b(?!:)|\bbun run [a-z]|\bgh auth\b|(?<![\w-])brew [a-z]|\bopen -a\b|\bgitleaks git\b/

describe("the empty areas' lines", () => {
  test.each([
    ...Object.entries(SETUP),
    ["pulls with gh signed out", pullsSetup({ reason: "gh is not logged in", setup: true })!],
  ])("%s names no command", (_, setup) => {
    expect(`${setup.title}. ${setup.description}`).not.toMatch(COMMAND)
  })
})

describe("pullsSetup", () => {
  test("keeps the gh setup line, with the reason, only while gh is missing or logged out", () => {
    expect(pullsSetup({ reason: "gh is not logged in", setup: true })).toEqual({
      description:
        "Pull requests are read through GitHub's gh tool: the Settings page's checks set it up and sign it in. The read failed: gh is not logged in.",
      title: "GitHub can't be read",
    })
  })

  test("says GitHub refused the read, in its own words, when gh is set up", () => {
    expect(pullsSetup({ reason: "Resource not accessible by integration", setup: false })).toEqual({
      description: "The read failed: Resource not accessible by integration.",
      title: "GitHub refused the read",
    })
    expect(
      pullsSetup({ reason: "Could not resolve to a Repository with the name 'o/r'.", setup: false })
        ?.description,
    ).toBe("The read failed: Could not resolve to a Repository with the name 'o/r'.")
  })

  test("shows no setup line when every read answered", () => {
    expect(pullsSetup(null)).toBeNull()
  })
})

describe("rosterSetup", () => {
  test("names the roster path the API reads, so the line follows the folder wherever it is", () => {
    expect(rosterSetup("/tmp/dashboard/dispatcher/roster.json")).toEqual({
      description: "Titles and ETAs appear once /tmp/dashboard/dispatcher/roster.json exists.",
      title: "No agent roster yet",
    })
  })
})

describe("sessionsSetup", () => {
  test("says the sessions can't be read while the terminal's read fails", () => {
    expect(sessionsSetup({ code: "CMUX_UNAVAILABLE" })).toBe(SETUP.unreachable)
    expect(sessionsSetup({ code: "CMUX_FAILED" })).toBe(SETUP.unreachable)
    expect(sessionsSetup(null, "the read did not answer in time")).toBe(SETUP.unreachable)
  })

  test("says no session runs yet when the read answered with none, or failed some other way", () => {
    expect(sessionsSetup(null)).toBe(SETUP.sessions)
    expect(sessionsSetup(null, null)).toBe(SETUP.sessions)
    expect(sessionsSetup({ code: "NOT_FOUND" })).toBe(SETUP.sessions)
  })

  test("shows no setup line for a refused source, whose alert already names the reason", () => {
    expect(sessionsSetup({ code: "SOURCE_REFUSED" })).toBeNull()
  })
})
