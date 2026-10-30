import { describe, expect, test } from "bun:test"

import {
  chainLinkName,
  firstLine,
  formatCost,
  formatCount,
  kindLabel,
  sessionLabel,
  sessionsMenuLinks,
  sessionsNamed,
  startLabel,
  statusLabel,
} from "../../../../../web/next/src/lib/sessions"
import { fullTime } from "../../../../../web/next/src/lib/time"

const blank = {
  agentType: null,
  aiTitle: null,
  cwd: null,
  description: null,
  id: "0123456789abcdef",
  name: null,
}

describe("sessionLabel", () => {
  test("a named session reads as its name, each word capitalised", () => {
    expect(sessionLabel({ ...blank, name: "worker-gluttony" })).toBe("Gluttony")
  })

  test("else the title Claude Code gave it, else what a subagent was sent to do, else its type", () => {
    expect(sessionLabel({ ...blank, aiTitle: "Start review bot" })).toBe("Start review bot")
    expect(sessionLabel({ ...blank, agentType: "Explore", description: "Find the hub" })).toBe(
      "Find the hub",
    )
    expect(sessionLabel({ ...blank, agentType: "Explore" })).toBe("Explore")
  })

  test("else the folder it ran in, read as an agent's label", () => {
    expect(sessionLabel({ ...blank, cwd: "/Users/me/acme-main-app" })).toBe("SessionAcmeMainApp")
  })

  test("else its id's first eight characters", () => {
    expect(sessionLabel(blank)).toBe("Session 01234567")
  })
})

describe("formatting", () => {
  test("a cost reads in dollars, a sub-cent one as under a cent, and none as a dash", () => {
    expect(formatCost(4.8213)).toBe("$4.82")
    expect(formatCost(0.004)).toBe("<$0.01")
    expect(formatCost(null)).toBe("-")
  })

  test("a count reads compact", () => {
    expect(formatCount(375_600)).toBe("375.6K")
    expect(formatCount(42)).toBe("42")
  })

  test("a kind reads capitalised, and an unknown one as Unknown", () => {
    expect(kindLabel("headless")).toBe("Headless")
    expect(kindLabel(null)).toBe("Unknown")
  })

  test("a tool step's first line is its summary, the input it ran with following", () => {
    expect(firstLine('Run the tests\n{"command":"bun run test"}')).toBe("Run the tests")
  })
})

describe("statusLabel", () => {
  test("says whether a session runs in the dashboard's words, and a dash for a subagent the registry cannot see", () => {
    expect(statusLabel({ live: true, status: "busy" })).toBe("Working")
    expect(statusLabel({ live: true, status: "idle" })).toBe("Idle")
    expect(statusLabel({ live: true, status: "shell" })).toBe("Live")
    expect(statusLabel({ live: false, status: null })).toBe("Ended")
    expect(statusLabel({ live: null, status: null })).toBe("-")
  })
})

describe("sessionsMenuLinks", () => {
  test("the user menu links Sessions for the owner rung, and for no one below it", () => {
    expect(sessionsMenuLinks(true)).toEqual([{ href: "/dashboard/sessions", label: "Sessions" }])
    expect(sessionsMenuLinks(false)).toEqual([])
  })
})

describe("chains", () => {
  test("only a /clear or a handover note reads as carrying on; anything else is a fresh start", () => {
    expect(startLabel({ kind: "clear", note: null })).toBe("Continues after /clear")
    expect(startLabel({ kind: "handover", note: "builder-2026-10-12.md" })).toBe(
      "Continues from builder-2026-10-12.md",
    )
    expect(startLabel({ kind: "fresh", note: null })).toBe("Fresh start")
  })

  test("a chain link's name carries the relation and the start that tells its row apart", () => {
    const at = "2026-10-12T09:30:00Z"
    expect(chainLinkName("before", at)).toBe(`Before · ${fullTime(at)}`)
    expect(chainLinkName("after", at)).toBe(`After · ${fullTime(at)}`)
    expect(chainLinkName("alongside", at)).toBe(`Ran alongside · ${fullTime(at)}`)
    expect(chainLinkName("before", null)).toBe("Before")
  })

  test("every session of a name is one link to the Sessions list, the name kept whole", () => {
    expect(sessionsNamed("worker-brave-otter")).toBe(
      "/dashboard/sessions?session=worker-brave-otter",
    )
    expect(sessionsNamed("a b&c")).toBe("/dashboard/sessions?session=a%20b%26c")
  })
})
