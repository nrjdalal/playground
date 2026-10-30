import { describe, expect, test } from "bun:test"

import {
  Browser,
  CLS_ALLOWED,
  CLS_LIMIT,
  CLS_NO_ROSTER_ROUTES,
  CLS_ROUTES,
  clsResult,
} from "../../../../../packages/scripts/src/verify/checks"
import {
  describeNode,
  NO_ROSTER_SCRIPT,
  OBSERVER_SCRIPT,
  SECOND_DOWN_SCRIPT,
  type Shift,
  withoutRoster,
  withoutSecond,
} from "../../../../../packages/scripts/src/verify/cls-observer"

const rect = (y: number) => ({ height: 20, width: 200, x: 0, y })

const shift = (value: number, hadRecentInput = false): Shift => ({
  hadRecentInput,
  sources: [
    { area: "sidebar", element: 'div[sidebar-group] "Runners"', from: rect(540), to: rect(506) },
  ],
  value,
})

// The shape of a DOM node describeNode reads, enough to place it without a browser.
const element = (
  tagName: string,
  attributes: Record<string, string>,
  textContent: string,
  sidebar: boolean,
) => ({
  closest: (selector: string) => (sidebar && selector.includes("sidebar") ? {} : null),
  getAttribute: (name: string) => attributes[name] ?? null,
  nodeType: 1,
  tagName: tagName.toUpperCase(),
  textContent,
})

// Playground's chat on canary as verify cls found it: its content grows in place as its steps arrive.
const chatGrew: Shift = {
  hadRecentInput: false,
  sources: [
    {
      area: "page",
      element: 'div[message-scroller-content] "You1:40 PMFixture: run the dashboard"',
      from: { height: 172, width: 1104, x: 467, y: 96 },
      to: { height: 716, width: 1104, x: 467, y: 96 },
    },
  ],
  value: 0.0113,
}

// The sidebar on canary with no dispatcher live, as ops-checks found it: Playground's placeholder row drops out.
const sidebarJumped: Shift = {
  hadRecentInput: false,
  sources: [
    {
      area: "sidebar",
      element: 'div[sidebar-content] "Apps1ManagersLead: workers@Builder · Wo"',
      from: { height: 774, width: 255, x: 0, y: 96 },
      to: { height: 814, width: 255, x: 0, y: 56 },
    },
  ],
  value: 0.0027,
}

describe("clsResult", () => {
  test("passes a load with no shift", () => {
    const result = clsResult("/dashboard", "cold", [])
    expect(result.ok).toBe(true)
    expect(result.check).toBe("cls /dashboard cold")
  })

  test("fails a load that shifted, naming the element, its area and how far it moved", () => {
    const result = clsResult("/dashboard/system", "warm", [shift(0.02), shift(0.01)])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("0.0300")
    expect(result.detail).toContain('sidebar div[sidebar-group] "Runners" y 540 -> 506')
  })

  test("names a height change too, since a part that grows in place moves its own content", () => {
    expect(clsResult("/dashboard/system", "cold", [chatGrew]).detail).toContain(
      "y 96 -> 96, height 172 -> 716",
    )
  })

  test("fails the chat's shift on every route, since PG-148 fixed it and dropped its allowance", () => {
    for (const route of ["/dashboard", "/dashboard/system"]) {
      expect(clsResult(route, "warm", [chatGrew]).ok).toBe(false)
    }
  })

  test("the sidebar's jump with no dispatcher live is excused no longer, since PG-158 keeps Playground's row", () => {
    for (const route of ["/dashboard", "/dashboard/system"]) {
      for (const dispatcherLive of [false, true]) {
        expect(clsResult(route, "cold", [sidebarJumped], { dispatcherLive }).ok).toBe(false)
      }
    }
  })

  test("holds no allowance, since every shift it excused is fixed (PG-148, PG-158)", () => {
    expect(CLS_ALLOWED).toEqual([])
  })

  // The list is empty, so the next known bug's entry is tried here: excused only for its element and route, while its condition holds, and saying so.
  test("an allowance excuses only its own element, route and condition, and says it did", () => {
    CLS_ALLOWED.push({
      element: "div[sidebar-content]",
      routes: ["/dashboard"],
      when: (state) => !state.dispatcherLive,
      why: "a test entry (PG-0)",
    })
    try {
      const noDispatcher = { dispatcherLive: false }
      const result = clsResult("/dashboard", "cold", [sidebarJumped], noDispatcher)
      expect(result.ok).toBe(true)
      expect(result.detail).toContain("0.0027 more excused as a known bug")
      expect(clsResult("/dashboard", "cold", [sidebarJumped], { dispatcherLive: true }).ok).toBe(
        false,
      )
      expect(clsResult("/dashboard/system", "cold", [sidebarJumped], noDispatcher).ok).toBe(false)
      const both: Shift = {
        ...sidebarJumped,
        sources: [...sidebarJumped.sources, ...shift(0).sources],
      }
      const mixed = clsResult("/dashboard", "cold", [both], noDispatcher)
      expect(mixed.ok).toBe(false)
      expect(mixed.detail).toContain('sidebar div[sidebar-group] "Runners"')
      const prefix: Shift = {
        ...sidebarJumped,
        sources: [{ ...sidebarJumped.sources[0]!, element: "div[sidebar-content-extra]" }],
      }
      expect(clsResult("/dashboard", "cold", [prefix], noDispatcher).ok).toBe(false)
    } finally {
      CLS_ALLOWED.pop()
    }
  })

  test("ignores a shift that follows input, since the person caused it", () => {
    expect(clsResult("/dashboard", "warm", [shift(0.2, true)]).ok).toBe(true)
  })

  test("allows rounding up to the limit, and no more", () => {
    expect(clsResult("/dashboard", "cold", [shift(CLS_LIMIT)]).ok).toBe(true)
    expect(clsResult("/dashboard", "cold", [shift(CLS_LIMIT * 2)]).ok).toBe(false)
  })

  test("names a shift whose element has gone rather than hiding it", () => {
    const result = clsResult("/dashboard", "cold", [
      { hadRecentInput: false, sources: [], value: 0.05 },
    ])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("an element since removed")
  })
})

describe("describeNode", () => {
  test("places an element by itself", () => {
    const node = element("div", { "data-slot": "sidebar-group" }, "  Runners\n  5 ", true)
    expect(describeNode(node as unknown as Node)).toEqual({
      area: "sidebar",
      element: 'div[sidebar-group] "Runners 5"',
    })
  })

  // A text node has no closest, so placing it by itself would throw and hide a real shift (a tester's finding).
  test("places a text node by its parent element", () => {
    const parent = element("span", {}, "Next up", false)
    const text = { nodeType: 3, parentElement: parent, textContent: "Next up" }
    expect(describeNode(text as unknown as Node)).toEqual({
      area: "page",
      element: 'span "Next up"',
    })
  })

  test("gives nothing for a node with no element to place it by", () => {
    expect(describeNode({ nodeType: 3, parentElement: null } as unknown as Node)).toBeNull()
    expect(describeNode(null)).toBeNull()
  })
})

describe("OBSERVER_SCRIPT", () => {
  test("is a script a page can run, self-contained", () => {
    expect(() => new Function(OBSERVER_SCRIPT)).not.toThrow()
    expect(OBSERVER_SCRIPT).toContain('"layout-shift"')
    expect(OBSERVER_SCRIPT).toContain("buffered")
  })

  test("records each buffered shift on the page, a text node's placed by its parent", () => {
    const page: { __verifyShifts?: Shift[] } = {}
    let options: unknown
    let report: (list: { getEntries: () => unknown[] }) => void = () => undefined
    class Observer {
      constructor(callback: typeof report) {
        report = callback
      }
      observe(given: unknown) {
        options = given
      }
    }
    new Function("window", "PerformanceObserver", OBSERVER_SCRIPT)(page, Observer)
    expect(options).toEqual({ buffered: true, type: "layout-shift" })
    const parent = element("h2", {}, "Next up", false)
    const box = (y: number) => ({ height: 20.4, width: 100, x: 0, y })
    report({
      getEntries: () => [
        {
          hadRecentInput: false,
          sources: [
            {
              currentRect: box(653.2),
              node: { nodeType: 3, parentElement: parent },
              previousRect: box(168),
            },
          ],
          value: 0.09,
        },
      ],
    })
    expect(page.__verifyShifts).toEqual([
      {
        hadRecentInput: false,
        sources: [
          {
            area: "page",
            element: 'h2 "Next up"',
            from: { height: 20, width: 100, x: 0, y: 168 },
            to: { height: 20, width: 100, x: 0, y: 653 },
          },
        ],
        value: 0.09,
      },
    ])
  })
})

// An agents read as the fixture serves it, trimmed to what the System page's roster notes read.
const agentsBody = {
  data: {
    agents: [{ name: "worker-envy" }],
    roster: {
      backlog: ["Fixture: a queued task"],
      path: "/fixture/playground/roster.json",
      problem: null,
      updatedAt: "2026-01-01T12:00:00Z",
    },
  },
}
const noRoster = {
  data: {
    agents: [{ name: "worker-envy" }],
    roster: {
      backlog: [],
      path: "/fixture/playground/roster.json",
      problem: null,
      updatedAt: null,
    },
  },
}

// a tester: with the second dispatcher on the roster but down, a warm load drew 2 placeholder rows, 1 stored row, then 2 live rows
const frame = {
  dispatchers: ["dispatcher", "dispatcher-2"],
  type: "workers",
  workers: [
    { name: "dispatcher", role: "dispatcher" },
    { name: "dispatcher-2", role: "dispatcher" },
    { name: "worker-envy", role: "worker" },
  ],
}

describe("withoutSecond", () => {
  test("drops every dispatcher but the primary from a workers frame, as a stack whose second dispatcher is down sends it", () => {
    expect(JSON.parse(withoutSecond(JSON.stringify(frame)))).toEqual({
      ...frame,
      workers: [
        { name: "dispatcher", role: "dispatcher" },
        { name: "worker-envy", role: "worker" },
      ],
    })
  })

  test("passes any other frame, and text that is not JSON, as it is", () => {
    const entries = JSON.stringify({ type: "entries", workers: frame.workers })
    expect(withoutSecond(entries)).toBe(entries)
    expect(withoutSecond("not json")).toBe("not json")
  })
})

describe("SECOND_DOWN_SCRIPT", () => {
  test("hands the page's message listeners each frame withoutSecond makes, and its other listeners theirs as they come", () => {
    const heard: unknown[] = []
    class Socket {
      listeners: { listener: (event: { data: unknown }) => void; type: string }[] = []
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        this.listeners.push({ listener, type })
      }
      emit(type: string, data: unknown) {
        for (const entry of this.listeners) if (entry.type === type) entry.listener({ data })
      }
    }
    const page = { WebSocket: Socket as unknown as typeof Socket }
    new Function("window", "MessageEvent", SECOND_DOWN_SCRIPT)(
      page,
      class {
        data: unknown
        constructor(_type: string, init: { data: unknown }) {
          this.data = init.data
        }
      },
    )
    const socket = new page.WebSocket()
    socket.addEventListener("message", (event) => heard.push(JSON.parse(String(event.data))))
    socket.addEventListener("open", (event) => heard.push(event.data))
    socket.emit("message", JSON.stringify(frame))
    socket.emit("open", "opened")
    expect(heard).toEqual([{ ...frame, workers: [frame.workers[0], frame.workers[2]] }, "opened"])
  })
})

describe("withoutRoster", () => {
  // A stack with no roster file shows the System page a note above Agents that came late and pushed the table down 44px.
  test("answers an agents read as a stack with no roster file does", () => {
    expect(withoutRoster(agentsBody)).toEqual(noRoster)
  })

  test("passes anything else as it is", () => {
    expect(withoutRoster({ error: { code: "UNAUTHORIZED" } })).toEqual({
      error: { code: "UNAUTHORIZED" },
    })
    expect(withoutRoster(null)).toBeNull()
  })
})

describe("NO_ROSTER_SCRIPT", () => {
  const load = () => {
    const page: { fetch: (input: RequestInfo | URL) => Promise<Response> } = {
      fetch: async (input) =>
        Response.json(String(input).endsWith("/api/v1/agents") ? agentsBody : { data: "kept" }),
    }
    new Function("window", "location", NO_ROSTER_SCRIPT)(page, { href: "http://web.localhost/" })
    return page
  }

  test("serves the page's agents read with no roster, by any form of its URL", async () => {
    const page = load()
    expect(await (await page.fetch("http://api.localhost/api/v1/agents")).json()).toEqual(noRoster)
    expect(await (await page.fetch(new URL("http://api.localhost/api/v1/agents"))).json()).toEqual(
      noRoster,
    )
  })

  test("leaves every other read alone", async () => {
    const page = load()
    expect(await (await page.fetch("http://api.localhost/api/v1/workers")).json()).toEqual({
      data: "kept",
    })
  })
})

describe("CLS_NO_ROSTER_ROUTES", () => {
  test("loads again only routes the default run checks", () => {
    expect(CLS_NO_ROSTER_ROUTES).toEqual(["/dashboard/system"])
    expect(CLS_NO_ROSTER_ROUTES.every((route) => CLS_ROUTES.includes(route))).toBe(true)
  })
})

describe("the cls browser", () => {
  // verify all closes the pages check's browser just before cls starts its own; one session name for both made cls connect to a session still closing (ops-checks found it).
  test("is a session of its own, apart from the run's other checks", () => {
    expect(new Browser([], "cls").session).toBe(`verify-${process.pid}-cls`)
    expect(new Browser().session).toBe(`verify-${process.pid}`)
  })
})
