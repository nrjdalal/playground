import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  holdsOrder,
  inShownOrder,
  PendingRow,
  parseShown,
  SessionRow,
  shownOf,
  sidebarSource,
} from "../../../../../../web/next/src/components/dashboard/app-sidebar"
import { ROW_BOX } from "../../../../../../web/next/src/components/shell/row-box"
import { SidebarMenu, SidebarProvider } from "../../../../../../web/next/src/components/ui/sidebar"

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

type Worker = Parameters<typeof SessionRow>[0]["worker"]

const inSidebar = (child: Node) =>
  renderToStaticMarkup(
    createElement(SidebarProvider, null, createElement(SidebarMenu, null, child)),
  )

const classesOf = (tag: string) => new Set(/class="([^"]*)"/.exec(tag)?.[1].split(" ") ?? [])

describe("PendingRow", () => {
  const html = inSidebar(createElement(PendingRow))

  test("Playground's slot before anything is read: one empty row of a session row's height, busy, holding no words", () => {
    expect(html.match(/<li[^>]*data-loading="true"/g)?.length).toBe(1)
    expect(html).toContain('aria-busy="true"')
    expect(html.replace(/<[^>]+>/g, "")).toBe("")
  })

  test("reads the session row's one box, the stock 32px, and nothing inside it, so Playground's row lands with no shift, open or on the collapsed rail", () => {
    const box = /<li[^>]*>\s*<div[^>]*>/.exec(html)?.[0] ?? ""
    const classes = classesOf(/<div[^>]*>/.exec(box)?.[0] ?? "")
    for (const c of ROW_BOX.split(" ")) expect(classes.has(c)).toBe(true)
    expect(html).not.toContain("<span")
  })

  // a stored sidebar holds a row for each dispatcher slot /api/health counts, so the second's arriving moves nothing below it
  test("draws one empty busy row for each slot it is asked to hold", () => {
    const two = inSidebar(createElement(PendingRow, { rows: 2 }))
    expect(two.match(/<li[^>]*data-loading="true"/g)?.length).toBe(2)
    expect(two.replace(/<[^>]+>/g, "")).toBe("")
  })

  test("draws no skeleton and nothing that pulses", () => {
    expect(html).not.toContain('data-slot="skeleton"')
    expect(html).not.toContain("animate-pulse")
  })
})

type Ops = Parameters<typeof shownOf>[1]
type Agents = NonNullable<Parameters<typeof shownOf>[2]>

const worker = (name: string, fields: Partial<Worker> = {}): Worker =>
  ({
    feed: [{ request_id: "r" }],
    light: "idle",
    name,
    questions: [{ id: "q" }],
    role: "worker",
    sessionId: `s-${name}`,
    tasks: [{ command: "bun run dev", kind: "process" }],
    ...fields,
  }) as unknown as Worker

const job = { job: "ops-checks", status: "running" } as unknown as Ops[number]

const agent = (name: string, fields: Record<string, unknown> = {}) =>
  ({
    name,
    pr: { number: 102 },
    report: { at: "2026-10-06T12:00:00Z", text: "secret plan" },
    role: "worker",
    sessionId: `s-${name}`,
    task: "Fix the thing in prod",
    ticket: "CEDAR-1",
    ...fields,
  }) as unknown as Agents[number]

describe("the stored sidebar", () => {
  test("shownOf keeps what a row draws and drops each session's Feed, questions and tasks (background commands stay out of storage)", () => {
    const shown = shownOf([worker("worker-greed")], [job])
    expect(shown).toMatchObject({ agents: [], ops: [job], waiting: {} })
    expect(shown.workers[0]).toMatchObject({
      feed: [],
      name: "worker-greed",
      questions: [],
      tasks: [],
    })
  })

  test("shownOf stores each shown session's agent (its pull request and ticket, no free text) and its waiting asks, so a stored row paints the live row's text", () => {
    const shown = shownOf(
      [worker("worker-greed")],
      [job],
      [agent("worker-greed"), agent("worker-gone")],
      { "s-worker-gone": ["ask-2"], "s-worker-greed": ["ask-1"], "s-worker-idle": [] },
    )
    expect(shown.agents).toEqual([
      expect.objectContaining({ pr: { number: 102 }, report: null, task: null, ticket: "CEDAR-1" }),
    ])
    expect(shown.waiting).toEqual({ "s-worker-greed": ["ask-1"] })
  })

  test("shownOf keeps a gone worker's roster agent, so a checker nests under its muted row in the stored paint too", () => {
    const roster = agent("worker-gone", { sessionId: null, state: "down" })
    const shown = shownOf(
      [worker("reviewer-gone-102")],
      [job],
      [agent("reviewer-gone-102"), roster],
    )
    expect(shown.agents).toEqual([
      expect.objectContaining({ name: "reviewer-gone-102" }),
      expect.objectContaining({ name: "worker-gone", report: null, state: "down", task: null }),
    ])
  })

  test("parseShown reads back what shownOf stored, and nothing that is missing, cut short or off its shape", () => {
    const shown = shownOf([worker("worker-greed")], [job], [agent("worker-greed")], {
      "s-worker-greed": ["ask-1"],
    })
    expect(parseShown(JSON.stringify(shown))).toEqual(shown)
    expect(parseShown(null)).toBeNull()
    expect(parseShown(JSON.stringify(shown).slice(0, 20))).toBeNull()
    const empty = { agents: [], ops: [], waiting: {}, waits: {}, workers: [] }
    expect(parseShown(JSON.stringify(empty))).toEqual(empty)
    // a store written before inbox waits reads as waiting on none, and one off their shape is refused
    const { waits: _, ...before } = empty
    expect(parseShown(JSON.stringify(before))).toEqual(empty)
    expect(parseShown(JSON.stringify({ ...empty, waits: { s: { id: 1 } } }))).toBeNull()
    expect(parseShown(JSON.stringify({ ...empty, workers: [{ name: "x" }] }))).toBeNull()
    expect(parseShown(JSON.stringify({ ...empty, ops: [{}] }))).toBeNull()
    expect(parseShown(JSON.stringify({ ...empty, agents: [{}] }))).toBeNull()
    expect(parseShown(JSON.stringify({ ...empty, waiting: { s: [1] } }))).toBeNull()
    // a light or an ops status this version has no icon for (another version wrote it) is not drawn
    const stuck = { ...shown.workers[0], light: "stuck" }
    expect(parseShown(JSON.stringify({ ...shown, workers: [stuck] }))).toBeNull()
    expect(parseShown(JSON.stringify({ ...shown, ops: [{ ...job, status: "paused" }] }))).toBeNull()
    // the first version's store, with no agents or asks, is not drawn
    expect(parseShown(JSON.stringify({ ops: [], workers: [] }))).toBeNull()
    expect(parseShown(JSON.stringify([]))).toBeNull()
  })

  test("inShownOrder keeps the stored order for the rows it held, then the new ones in live order", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => worker(name))
    expect(inShownOrder([c!, a!, d!, b!], [a!, b!, c!]).map((w) => w.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })
})

describe("sidebarSource", () => {
  const base = {
    extrasRead: true,
    feedLost: false,
    held: true,
    mounted: true,
    ops: undefined,
    stored: null,
    workers: null,
  }
  const stored = shownOf([worker("a"), worker("b")], [job])

  test("the server's paint is pending, whatever is stored, so the first client paint only adds rows", () => {
    expect(sidebarSource({ ...base, mounted: false, stored })).toEqual({ kind: "pending" })
    expect(sidebarSource({ ...base, mounted: false, stored: undefined })).toEqual({
      kind: "pending",
    })
  })

  test("with storage: the stored sidebar until the board, the ops jobs, the agents and the inbox are all read", () => {
    expect(sidebarSource({ ...base, stored })).toEqual({ kind: "stored", ...stored })
    expect(sidebarSource({ ...base, stored, workers: [worker("a")] }).kind).toBe("stored")
    expect(sidebarSource({ ...base, ops: [], stored }).kind).toBe("stored")
    const noExtras = { ...base, extrasRead: false, ops: [job], stored, workers: [worker("a")] }
    expect(sidebarSource(noExtras).kind).toBe("stored")
  })

  test("with storage: the live board in the stored order while held, then in its own", () => {
    const live = [worker("b"), worker("c"), worker("a")]
    const held = sidebarSource({ ...base, ops: [job], stored, workers: live })
    expect(held.kind).toBe("live")
    expect("workers" in held && held.workers.map((w) => w.name)).toEqual(["a", "b", "c"])
    const released = sidebarSource({ ...base, held: false, ops: [job], stored, workers: live })
    expect("workers" in released && released.workers.map((w) => w.name)).toEqual(["b", "c", "a"])
  })

  test("with no storage: nothing until all are read, so no placeholder is ever swapped for rows of another count, and no title gains its pull request later", () => {
    expect(sidebarSource(base)).toEqual({ kind: "pending" })
    expect(sidebarSource({ ...base, workers: [worker("a")] })).toEqual({ kind: "pending" })
    expect(
      sidebarSource({ ...base, extrasRead: false, ops: [job], workers: [worker("a")] }),
    ).toEqual({ kind: "pending" })
    const live = sidebarSource({ ...base, ops: [job], workers: [worker("b"), worker("a")] })
    expect(live).toEqual({ kind: "live", ops: [job], workers: [worker("b"), worker("a")] })
  })

  test("a feed lost before any board: lost, even over a stored sidebar, which would claim sessions never read; Runners keeps the ops jobs, read without cmux", () => {
    expect(sidebarSource({ ...base, feedLost: true })).toEqual({ kind: "lost", ops: [] })
    expect(sidebarSource({ ...base, feedLost: true, stored })).toEqual({ kind: "lost", ops: [] })
    expect(sidebarSource({ ...base, feedLost: true, ops: [job], stored })).toEqual({
      kind: "lost",
      ops: [job],
    })
  })

  test("a feed lost after the board was read keeps the live rows", () => {
    expect(
      sidebarSource({ ...base, feedLost: true, ops: [job], workers: [worker("a")] }).kind,
    ).toBe("live")
  })
})

describe("holdsOrder", () => {
  test("a first load holds the stored order until both reads land", () => {
    expect(holdsOrder(null, undefined, true)).toBe(true)
    expect(holdsOrder([worker("a")], undefined, true)).toBe(true)
    expect(holdsOrder(null, [job], true)).toBe(true)
    expect(holdsOrder([worker("a")], [job], false)).toBe(true)
  })

  test("a remount that finds both already read (the narrow-screen sidebar reopening, a breakpoint swap) shows the live order at once, never an old one it would later jump from", () => {
    expect(holdsOrder([worker("a")], [job], true)).toBe(false)
    const live = [worker("b"), worker("a")]
    const stored = shownOf([worker("a"), worker("b")], [job])
    const remount = sidebarSource({
      extrasRead: true,
      feedLost: false,
      held: holdsOrder(live, [job], true),
      mounted: true,
      ops: [job],
      stored,
      workers: live,
    })
    expect("workers" in remount && remount.workers.map((w) => w.name)).toEqual(["b", "a"])
  })
})
