import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { AppManager } from "../../../../../../web/next/src/components/apps/app-manager"

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

// stands in for a Remix icon, which this directory cannot resolve either
const Icon = () => createElement("svg")

const app = (id: string, title: string) => ({
  description: `${title} shows things.`,
  href: `/dashboard/apps/${id}`,
  icon: Icon,
  id,
  segment: id,
  title,
})
const APPS = [app("changelog", "Changelog"), app("plan", "Plan"), app("usage", "Usage")]

const render = (prefs: { hidden: string[]; order: string[] }) =>
  renderToStaticMarkup(createElement(AppManager, { apps: APPS, onChange: () => {}, prefs }))

const titles = (html: string) =>
  [...html.matchAll(/data-slot="item-title"[^>]*>([^<]*)</g)].map((m) => m[1])
const switches = (html: string) => [...html.matchAll(/<[^>]*role="switch"[^>]*>/g)].map((m) => m[0])

// #i787: "A new aside tab, Apps, is the app manager: it lists every app, with show/hide and drag to reorder, kept in this browser's localStorage."
describe("the Apps manager", () => {
  test("lists every app in your order, hidden ones included", () => {
    const html = render({ hidden: ["plan"], order: ["usage"] })
    expect(titles(html)).toEqual(["Usage", "Changelog", "Plan"])
  })

  test("gives each app a show switch, off for a hidden one, named for its app", () => {
    const html = render({ hidden: ["plan"], order: [] })
    const each = switches(html)
    expect(each).toHaveLength(3)
    expect(each[0]).toContain('aria-label="Show Changelog"')
    expect(each[0]).toContain('aria-checked="true"')
    expect(each[1]).toContain('aria-checked="false"')
  })

  test("lets each row be dragged, by the pointer or the keyboard", () => {
    const html = render({ hidden: [], order: [] })
    expect(html.match(/aria-roledescription="sortable"/g)).toHaveLength(3)
  })
})
