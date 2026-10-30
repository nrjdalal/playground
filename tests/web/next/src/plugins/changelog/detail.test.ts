import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { ChangelogEntry } from "../../../../../../api/hono/src/plugins/changelog/types"
import { Detail } from "../../../../../../web/next/src/plugins/changelog/detail"

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

const entry = (detail: string | null): ChangelogEntry => ({
  id: "00000000-0000-4000-8000-000000000009",
  actor: "fixture",
  at: "2026-10-07T10:00:00.000Z",
  createdAt: "2026-10-07T10:00:00.000Z",
  detail,
  images: [],
  kind: "feature",
  link: "https://github.com/example/factory/pull/212",
  sourceKey: "fixture:212",
  text: "The sidebar counts the changes you have not read yet.",
})

const render = (detail: string | null) =>
  renderToStaticMarkup(createElement(Detail, { entry: entry(detail) }))

describe("the Changelog aside", () => {
  test("renders a detail's Markdown: its lead, its list and its link", () => {
    const html = render(
      [
        "The Changelog square now counts what you have not read.",
        "",
        "- Opening the Changelog marks them **read**.",
        "- See [the notes](https://example.com/notes/212).",
      ].join("\n"),
    )
    expect(html).toContain("The Changelog square now counts what you have not read.")
    expect(html).toMatch(/<ul[^>]*>[\s\S]*<li[^>]*>[\s\S]*Opening the Changelog marks them/)
    expect(html).toMatch(/<li[^>]*>[\s\S]*<li[^>]*>/)
    expect(html).toMatch(/data-streamdown="strong"[^>]*>read</)
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/example\.com\/notes\/212"[^>]*rel="noopener noreferrer"[^>]*>the notes<\/a>/,
    )
  })

  test("loads no image a detail names from elsewhere", () => {
    const html = render("- Before: ![a shot](https://evil.example/leak.png)")
    expect(html).not.toContain('evil.example/leak.png"')
    expect(html).not.toMatch(/<img[^>]*src="https:\/\/evil/)
  })

  test("links each #n in the line and the detail to its issue", () => {
    const html = renderToStaticMarkup(
      createElement(Detail, {
        entry: {
          ...entry("The merge train ships, for #177."),
          text: "Batches merge, as #177 asked.",
        },
      }),
    )
    expect(html).toMatch(
      /<h2[^>]*>Batches merge, as <a href="https:\/\/github\.com\/example\/factory\/issues\/177"[^>]*rel="noopener noreferrer"[^>]*>#177<\/a> asked\.<\/h2>/,
    )
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/github\.com\/example\/factory\/issues\/177"[^>]*>#177<\/a>\./,
    )
  })

  test("shows the line alone with no detail", () => {
    const html = render(null)
    expect(html).toContain("The sidebar counts the changes you have not read yet.")
    expect(html).not.toContain("<ul")
  })
})
