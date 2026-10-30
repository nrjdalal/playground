export type Rect = { height: number; width: number; x: number; y: number }
export type ShiftSource = { area: "page" | "sidebar"; element: string; from: Rect; to: Rect }
export type Shift = { hadRecentInput: boolean; sources: ShiftSource[]; value: number }

// Where a shift's source sits and what it is. A source can be a text node, which has no closest, so it is placed by its parent element; placing it by itself would throw inside the observer and hide a real shift. Runs in the page, so it refers to nothing outside itself.
export function describeNode(node: Node | null): Pick<ShiftSource, "area" | "element"> | null {
  const element = !node ? null : node.nodeType === 1 ? (node as Element) : node.parentElement
  if (!element) return null
  const area = element.closest('[data-slot="sidebar"], [data-slot="sidebar-inner"]')
    ? "sidebar"
    : "page"
  const slot = element.getAttribute("data-slot") ?? element.getAttribute("data-sidebar")
  const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)
  return {
    area,
    element: `${element.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}${text ? ` "${text}"` : ""}`,
  }
}

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput: boolean
  sources?: { currentRect: DOMRectReadOnly; node: Node | null; previousRect: DOMRectReadOnly }[]
  value: number
}

// Keeps every layout shift since the document began on window.__verifyShifts, buffered so the shifts before it was registered count too. Runs in the page, so it refers to nothing outside itself but the describer it is handed.
function observeShifts(describe: typeof describeNode): void {
  const page = window as unknown as { __verifyShifts?: Shift[] }
  if (page.__verifyShifts) return
  const shifts: Shift[] = []
  page.__verifyShifts = shifts
  const box = ({ height, width, x, y }: DOMRectReadOnly): Rect => ({
    height: Math.round(height),
    width: Math.round(width),
    x: Math.round(x),
    y: Math.round(y),
  })
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      const sources: ShiftSource[] = []
      for (const source of entry.sources ?? []) {
        const placed = describe(source.node)
        if (placed)
          sources.push({ ...placed, from: box(source.previousRect), to: box(source.currentRect) })
      }
      shifts.push({ hadRecentInput: entry.hadRecentInput, sources, value: entry.value })
    }
  }).observe({ buffered: true, type: "layout-shift" })
}

// The init script the browser runs before any of a page's own: both functions as Bun compiled them, so the page runs exactly the code the tests cover.
export const OBSERVER_SCRIPT = `${describeNode.toString()}\n;(${observeShifts.toString()})(describeNode)\n`

// An agents read with its roster part as a stack with no roster file answers it: empty, its file never read. Its agents stay, roster rows included, since only the roster's notes are under test. Anything else passes as it is. Runs in the page, so it refers to nothing outside itself.
export function withoutRoster(body: unknown): unknown {
  const read = body as { data?: { roster?: { path?: unknown } } } | null
  const data = read?.data
  if (!data?.roster) return body
  return {
    ...read,
    data: {
      ...data,
      roster: { backlog: [], path: data.roster.path, problem: null, updatedAt: null },
    },
  }
}

// Answers every agents read the page makes through withoutRoster, so a fixture stack loads as one with no roster would, while verify writes nothing to it.
function serveWithoutRoster(strip: typeof withoutRoster): void {
  const read = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await read(input, init)
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!response.ok || new URL(url, location.href).pathname !== "/api/v1/agents") return response
    return new Response(JSON.stringify(strip(await response.json())), {
      headers: { "content-type": "application/json" },
      status: response.status,
    })
  }) as typeof window.fetch
}

// The init script for a no-roster load, run beside the observer.
export const NO_ROSTER_SCRIPT = `${withoutRoster.toString()}\n;(${serveWithoutRoster.toString()})(withoutRoster)\n`

// A dashboard socket frame as a stack whose second dispatcher is down sends it: a workers frame keeps the primary (the first the API names) and drops every other dispatcher, while /api/health and the agents board still count it, as its roster entry does. Any other frame, or text that is not JSON, passes as it is. Runs in the page, so it refers to nothing outside itself.
export function withoutSecond(data: string): string {
  let frame: { dispatchers?: unknown; type?: unknown; workers?: unknown } | null
  try {
    frame = JSON.parse(data)
  } catch {
    return data
  }
  if (
    frame?.type !== "workers" ||
    !Array.isArray(frame.dispatchers) ||
    !Array.isArray(frame.workers)
  )
    return data
  const primary: unknown = frame.dispatchers[0]
  const workers = (frame.workers as { name?: unknown; role?: unknown }[]).filter(
    (worker) => worker.role !== "dispatcher" || worker.name === primary,
  )
  return JSON.stringify({ ...frame, workers })
}

// Hands every message listener on the page's sockets the frame strip makes, so a fixture stack loads as one whose second dispatcher is down would, while verify writes nothing to it.
function serveWithoutSecond(strip: typeof withoutSecond): void {
  const Native = window.WebSocket
  class Socket extends Native {
    override addEventListener(...args: Parameters<WebSocket["addEventListener"]>): void {
      const [type, listener, options] = args
      if (type !== "message" || typeof listener !== "function")
        return super.addEventListener(...args)
      super.addEventListener(
        "message",
        (event: MessageEvent) => {
          const data = typeof event.data === "string" ? strip(event.data) : event.data
          listener.call(this, new MessageEvent("message", { data }))
        },
        options,
      )
    }
  }
  window.WebSocket = Socket
}

// The init script for a load with the second dispatcher on the roster but down, run beside the observer.
export const SECOND_DOWN_SCRIPT = `${withoutSecond.toString()}\n;(${serveWithoutSecond.toString()})(withoutSecond)\n`
