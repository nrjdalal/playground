import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { GroupCount } from "../../../../../../web/next/src/components/shell/group-count"

type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

describe("GroupCount", () => {
  test("a group's count is one number at the label's right, as ZeroSDK's countCell, in the sidebar's own sans with tabular digits", () => {
    const html = renderToStaticMarkup(createElement(GroupCount, { count: 14 }))
    const outer =
      html.match(/^<span data-slot="group-count" class="([^"]*)">14<\/span>$/)?.[1] ?? ""
    expect(outer.split(" ")).toEqual(["ml-auto", "flex", "w-4", "justify-center", "tabular-nums"])
  })
})
