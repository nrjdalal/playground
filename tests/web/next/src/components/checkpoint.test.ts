import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Checkpoint } from "../../../../../web/next/src/components/checkpoint"

const web = join(import.meta.dir, "../../../../../web/next")
const { RiInboxLine } = (await import(Bun.resolveSync("@remixicon/react", web))) as {
  RiInboxLine: unknown
}
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (element: unknown) => string
}

// AI Elements' Checkpoint is the Dashboard's one marker line with an action, one shape for every place that uses it.
describe("Checkpoint", () => {
  const html = renderToStaticMarkup(createElement(Checkpoint, null, "Done (2)"))
  const tag = (slot: string) =>
    new RegExp(`<[a-z]+ [^>]*data-slot="${slot}"[^>]*>`).exec(html)?.[0] ?? ""

  test("is the stock Marker, centred and as tall as its buttons at every width", () => {
    expect(tag("marker")).toContain("h-7")
    expect(tag("marker")).toContain("justify-center")
    expect(html.slice(html.indexOf('data-slot="marker-content"'))).toContain("Done (2)")
  })

  test("leads with its small icon, hidden from screen readers, when given one", () => {
    const withIcon = renderToStaticMarkup(createElement(Checkpoint, { icon: RiInboxLine }, "x"))
    const icon = /<span [^>]*data-slot="marker-icon"[^>]*>/.exec(withIcon)?.[0] ?? ""
    expect(icon).toContain('aria-hidden="true"')
    expect(withIcon.indexOf("marker-icon")).toBeLessThan(withIcon.indexOf("marker-content"))
    expect(html).not.toContain('data-slot="marker-icon"')
  })

  // The reading bar splits its content to both edges, which only the content's own box can do
  test("lays out its content by the className given, keeping its own look", () => {
    const split = renderToStaticMarkup(
      createElement(Checkpoint, { className: "w-full justify-between" }, "x"),
    )
    const content = /<[a-z]+ [^>]*data-slot="marker-content"[^>]*>/.exec(split)?.[0] ?? ""
    expect(content).toContain("w-full justify-between")
    expect(content).toContain("inline-flex items-center gap-2")
    expect(tag("marker-content")).not.toContain("justify-between")
  })

  // checkpoints throughout the apps, with no separator line of their own
  test("draws no rule beside its content", () => {
    expect(tag("marker")).toContain('data-variant="default"')
    expect(html).not.toContain('data-variant="separator"')
  })
})
