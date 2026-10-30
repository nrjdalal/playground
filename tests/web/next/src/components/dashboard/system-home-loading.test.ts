import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  ReadingRows,
  statusRows,
} from "../../../../../../web/next/src/components/dashboard/status-table"
import {
  AGENT_ROWS_COOKIE,
  rowsCookie,
  storedRows,
  systemLoading,
} from "../../../../../../web/next/src/components/dashboard/system-loading"

// React resolves from the web app's own packages, which this directory cannot see; the two calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

describe("systemLoading", () => {
  test("stored path: empty rows at the last-known count, and nothing below the table yet", () => {
    expect(
      systemLoading({
        agentsPending: true,
        inboxPending: true,
        failed: false,
        held: true,
        sessionsPending: false,
        stored: 9,
      }),
    ).toEqual({ agents: "reading", below: false })
  })

  test("no-storage path: a spinner, and nothing below the table yet, so nothing can move down", () => {
    expect(
      systemLoading({
        agentsPending: true,
        inboxPending: false,
        failed: false,
        held: true,
        sessionsPending: false,
        stored: null,
      }),
    ).toEqual({ agents: "spinner", below: false })
  })

  test("holds the sections below until the inbox is read too, since Needs you grows with them", () => {
    expect(
      systemLoading({
        agentsPending: false,
        inboxPending: true,
        failed: false,
        held: true,
        sessionsPending: false,
        stored: null,
      }),
    ).toEqual({ agents: "table", below: false })
  })

  test("holds the sections below until the live sessions are read, since Needs you lists their prompts", () => {
    expect(
      systemLoading({
        agentsPending: false,
        inboxPending: false,
        failed: false,
        held: true,
        sessionsPending: true,
        stored: null,
      }),
    ).toEqual({ agents: "table", below: false })
  })

  test("shows the table and everything below once all three are read", () => {
    expect(
      systemLoading({
        agentsPending: false,
        inboxPending: false,
        failed: false,
        held: true,
        sessionsPending: false,
        stored: 4,
      }),
    ).toEqual({ agents: "table", below: true })
  })

  test("shows the sections below once the hold is spent with the inbox or the sessions still out, so a slow read never blanks them under the table for longer", () => {
    expect(
      systemLoading({
        agentsPending: false,
        inboxPending: true,
        failed: false,
        held: false,
        sessionsPending: true,
        stored: null,
      }),
    ).toEqual({ agents: "table", below: true })
  })

  test("keeps the sections below hidden past the hold while the board is out, since Next up and Needs you grow when it lands", () => {
    const base = { inboxPending: false, failed: false, held: false, sessionsPending: false }
    expect(systemLoading({ ...base, agentsPending: true, stored: null })).toEqual({
      agents: "spinner",
      below: false,
    })
    expect(systemLoading({ ...base, agentsPending: true, stored: 11 })).toEqual({
      agents: "reading",
      below: false,
    })
  })

  test("a failed read shows the rest of the page rather than holding it", () => {
    expect(
      systemLoading({
        agentsPending: true,
        inboxPending: true,
        failed: true,
        held: true,
        sessionsPending: true,
        stored: 4,
      }),
    ).toEqual({ agents: "table", below: true })
  })
})

describe("storedRows", () => {
  test("reads a whole count", () => {
    expect(storedRows(() => "11")).toBe(11)
  })

  test("refuses nothing stored, a cut-short or odd value, and zero", () => {
    for (const value of [null, "", "abc", "-2", "3.5", "0", "9999"])
      expect(storedRows(() => value)).toBeNull()
  })

  test("bounds the cookie, which the browser sets, to a whole count from 1 to 50", () => {
    expect(storedRows(() => "50")).toBe(50)
    for (const value of ["51", "1e3", "11; Path=/", "11abc", " 11", "<b>"])
      expect(storedRows(() => value)).toBeNull()
  })

  test("reads no cookie (a first visit) as nothing stored, so the server paints a spinner", () => {
    expect(storedRows(() => undefined)).toBeNull()
  })

  test("round-trips through the cookie the server reads, so a warm load's first paint holds its rows", () => {
    const cookie = rowsCookie(11)
    expect(cookie.startsWith(`${AGENT_ROWS_COOKIE}=11;`)).toBe(true)
    expect(cookie).toContain("Path=/dashboard/system;")
    expect(cookie).toContain("SameSite=Lax")
    const value = cookie.split(";")[0]?.split("=")[1]
    expect(storedRows(() => value)).toBe(11)
    expect(
      systemLoading({
        agentsPending: true,
        inboxPending: true,
        failed: false,
        held: true,
        sessionsPending: true,
        stored: storedRows(() => value),
      }).agents,
    ).toBe("reading")
  })

  test("reads a storage that throws (a private window, blocked site data) as nothing stored", () => {
    expect(
      storedRows(() => {
        throw new Error("SecurityError")
      }),
    ).toBeNull()
  })
})

describe("ReadingRows", () => {
  const html = renderToStaticMarkup(createElement(ReadingRows, { rows: 3 }))
  const rows = [...html.matchAll(/<tr [^>]*data-reading-row[^>]*>/g)].map((m) => m[0])

  test("draws one empty row per stored row, the first reading Reading agents… in plain text", () => {
    expect(rows).toHaveLength(3)
    expect(html.replace(/<[^>]+>/g, "")).toBe("Reading agents…")
    expect(html).not.toContain("animate-pulse")
    expect(html).not.toContain('data-slot="skeleton"')
  })

  test("builds its rows from the table's own primitives at its text size, so a row is the real row's height", () => {
    for (const row of rows) expect(row).toContain('data-slot="table-row"')
    expect(html.match(/data-slot="table-cell"/g)).toHaveLength(3)
    expect(html).toMatch(/data-slot="table"[^>]*class="[^"]*text-xs/)
    expect(html).not.toMatch(/h-\[\d+px\]/)
  })
})

type Agent = Parameters<typeof statusRows>[0][number]

const NOW = Date.parse("2026-10-06T12:00:00.000Z")

const agent = (name: string, fields: Partial<Agent> = {}): Agent => ({
  branch: null,
  branchTicket: null,
  eta: null,
  kind: null,
  lastActivityAt: "2026-10-06T11:59:00.000Z",
  name,
  parked: null,
  pr: null,
  pullProblem: null,
  report: null,
  role: "worker",
  schedule: null,
  sessionId: `s-${name}`,
  state: "working",
  status: null,
  task: null,
  ticket: null,
  title: null,
  worker: null,
  workspace: null,
  ...fields,
})

describe("statusRows", () => {
  const agents = [
    agent("dispatcher", { role: "manager" }),
    agent("worker-greed"),
    agent("scratch", { role: "other", state: "idle" }),
  ]
  const view = {
    activeAt: (a: Agent) => (a.name === "scratch" ? "2026-10-06T06:00:00.000Z" : null),
    dispatchers: new Map<string, string>(),
    isWaiting: () => false,
    now: NOW,
  }

  test("leaves an Other agent idle past three hours behind Show N idle, so the stored count is the rows the table shows", () => {
    const { idle, rows } = statusRows(agents, { ...view, showIdle: false })
    expect(rows.map((row) => row.agent.name)).toEqual(["dispatcher", "worker-greed"])
    expect(idle).toBe(1)
  })

  test("shows it once Show N idle is on", () => {
    expect(statusRows(agents, { ...view, showIdle: true }).rows).toHaveLength(3)
  })

  // the sidebar's rule: a reviewer or tester at work or stuck, by its held light, is a check its worker waits on
  test("a worker's row counts its checker at work or stuck, by the held light, as the sidebar does", () => {
    const team = (state: Agent["state"]) => [
      agent("worker-greed", { state: "idle" }),
      agent("reviewer-greed", { state, worker: "worker-greed" }),
    ]
    const lead = (state: Agent["state"], light?: (a: Agent) => Agent["state"]) =>
      statusRows(team(state), { ...view, light, showIdle: false }).rows[0]
    expect(lead("working")?.checkers).toBe(true)
    expect(lead("needs-you")?.checkers).toBe(true)
    expect(lead("idle")?.checkers).toBe(false)
    // its held light, not the raw state, decides
    expect(lead("idle", (a) => (a.name === "reviewer-greed" ? "working" : a.state))?.checkers).toBe(
      true,
    )
  })

  // the sidebar's nestState: a session the usage limit alone holds reads needs-you, yet waits on the reset, not on you
  test("a usage-paused worker stays below a working one, as its sidebar row does", () => {
    const { rows } = statusRows(
      [agent("worker-envy"), agent("worker-greed", { state: "needs-you" })],
      { ...view, isPaused: (a) => a.name === "worker-greed", showIdle: false },
    )
    expect(rows.map((row) => row.agent.name)).toEqual(["worker-envy", "worker-greed"])
  })

  // the table pins the placement too: the roster row is one of its agents, so the nest finds it
  test("a reviewer nests under a roster worker whose session is gone, and both keep the Subagents group", () => {
    const { rows } = statusRows(
      [
        agent("worker-envy", { sessionId: null, state: "down", status: "parked" }),
        agent("reviewer-envy", { worker: "worker-envy" }),
      ],
      { ...view, showIdle: false },
    )
    expect(rows.map((row) => [row.agent.name, row.group, row.member])).toEqual([
      ["worker-envy", "Subagents", false],
      ["reviewer-envy", "Subagents", true],
    ])
  })

  // 21 ended checkers nested under no worker sat at the table's root, and verify pages failed on each
  test("leaves out a reviewer or tester the roster ended with no live session, but keeps a parked one, a live one and an ended worker", () => {
    const { rows } = statusRows(
      [
        agent("worker-greed"),
        agent("worker-done", { sessionId: null, state: "down", status: "ended" }),
        agent("reviewer-done", { status: "ended", worker: "worker-done" }),
        agent("reviewer-docsflags", { sessionId: null, state: "down", status: "ended" }),
        agent("tester-gone", {
          sessionId: null,
          state: "down",
          status: "ended",
          worker: "worker-gone",
        }),
        agent("reviewer-held", { sessionId: null, state: "down", status: "parked" }),
      ],
      { ...view, showIdle: false },
    )
    expect(rows.map((row) => [row.agent.name, row.member])).toEqual([
      ["worker-greed", false],
      ["worker-done", false],
      ["reviewer-done", true],
      ["reviewer-held", false],
    ])
  })

  test("a live worker whose own reviewer ended shows alone, with no row under it", () => {
    const { rows } = statusRows(
      [
        agent("worker-greed"),
        agent("reviewer-greed", {
          sessionId: null,
          state: "down",
          status: "ended",
          worker: "worker-greed",
        }),
      ],
      { ...view, showIdle: false },
    )
    expect(rows.map((row) => [row.agent.name, row.member, row.checkers])).toEqual([
      ["worker-greed", false, false],
    ])
  })

  test("a checker whose roster worker names a manager nests under it, and takes its group", () => {
    const { rows } = statusRows(
      [
        agent("builder", { role: "manager" }),
        agent("tester-train", { worker: "builder" }),
        agent("worker-greed"),
      ],
      { ...view, showIdle: false },
    )
    expect(rows.map((row) => [row.agent.name, row.group, row.member])).toEqual([
      ["builder", "Orchestrators", false],
      ["tester-train", "Orchestrators", true],
      ["worker-greed", "Subagents", false],
    ])
  })

  // a review: a second dispatcher stopped on a prompt read Stuck here while its sidebar row read Waiting on you
  test("every dispatcher's row is marked as a dispatcher's, the second's included", () => {
    const { rows } = statusRows(
      [
        agent("dispatcher", { role: "manager" }),
        agent("dispatcher-2", { role: "manager" }),
        agent("worker-greed"),
      ],
      {
        ...view,
        dispatchers: new Map([
          ["s-dispatcher", "Opus 5.5 High"],
          ["s-dispatcher-2", "GLM 4.6"],
        ]),
        showIdle: false,
      },
    )
    expect(rows.map((row) => [row.agent.name, row.dispatcher])).toEqual([
      ["dispatcher", true],
      ["dispatcher-2", true],
      ["worker-greed", false],
    ])
  })

  // a review: a dispatcher's cell shows its model, so the search reads the same words, never its kind's title
  test("a live dispatcher's row carries the label its cell shows, its model", () => {
    const { rows } = statusRows(
      [
        agent("dispatcher", { kind: "dispatcher", role: "manager" }),
        agent("dispatcher-2", { kind: "dispatcher", role: "manager" }),
      ],
      {
        ...view,
        dispatchers: new Map([
          ["s-dispatcher", "Opus 5.5 High"],
          ["s-dispatcher-2", "GLM 4.6"],
        ]),
        showIdle: false,
      },
    )
    expect(rows.map((row) => row.label)).toEqual(["Opus 5.5 High", "GLM 4.6"])
  })
})
