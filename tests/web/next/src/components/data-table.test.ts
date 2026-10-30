import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { DataTable, features } from "../../../../../web/next/src/components/data-table"

// React and TanStack Table resolve from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
const web = join(import.meta.dir, "../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: Node[]) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}
const { useTable } = (await import(Bun.resolveSync("@tanstack/react-table", web))) as {
  useTable: (options: unknown) => unknown
}

// An empty table whose Role facet is set, as a cold load of /dashboard/system?role=Subagents is before the board lands.
function Filtered(props: { empty?: Node; pending?: Node }) {
  const table = useTable({
    columns: [{ accessorKey: "role", header: "Role" }],
    data: [],
    features,
    state: { columnFilters: [{ id: "role", value: ["Subagents"] }] },
  })
  return createElement(DataTable, { "aria-label": "Every agent", table, ...props })
}

describe("DataTable", () => {
  test("its pending rows show while the first read is out, whatever the filters say", () => {
    const html = renderToStaticMarkup(createElement(Filtered, { pending: "Reading agents" }))
    expect(html).toContain("Reading agents")
    expect(html).not.toContain("No results")
  })

  test("a filter that matches nothing says No results over the consumer's empty", () => {
    const html = renderToStaticMarkup(createElement(Filtered, { empty: "No agents yet" }))
    expect(html).toContain("No results")
    expect(html).not.toContain("No agents yet")
  })
})
