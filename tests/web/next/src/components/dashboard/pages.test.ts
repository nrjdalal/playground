import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import fixture from "../../../../../../api/hono/src/fixtures/dashboard.json"
import type { Preview } from "../../../../../../api/hono/src/lib/apps/previews"
import {
  groupVersions,
  PageList,
  versionKey,
} from "../../../../../../web/next/src/components/dashboard/pages"

const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (element: unknown) => string
}

// The fixture's one kept page, as GET /api/v1/apps/previews?session= lists it.
const [{ file, ...page }] = fixture.files["playground/previews/pages.jsonl"]
const preview: Preview = {
  caption: page.title,
  kind: "html",
  modifiedAt: page.at,
  name: file,
  page,
  size: 512,
  topic: "sidebar",
}

describe("the Pages tab", () => {
  const now = Date.parse(page.at) + 20 * 60_000
  const html = renderToStaticMarkup(
    createElement(PageList, { apiUrl: "https://api.test", now, pages: [preview] }),
  )

  test("lists the fixture's page with its title, its maker, whom it was made for and when", () => {
    expect(html).toContain("Fixture: sidebar spacing, two options side by side")
    expect(html).toContain("By Envy for Planner")
    expect(html).toContain(`dateTime="${page.at}"`)
    expect(html).toContain("20 min. ago")
  })

  test("opens the page in a new tab through the Previews route", () => {
    expect(html).toContain('href="https://api.test/api/v1/apps/previews/sidebar-mock.html"')
    expect(html).toContain('target="_blank"')
  })
})

describe("one row a page, its older versions in a dropdown", () => {
  const version = (name: string, at: string): Preview => ({
    ...preview,
    modifiedAt: at,
    name,
    page: { ...page, at, title: "Plat 2668 report" },
  })
  const pages = [
    version("dune-2668-3.html", "2026-10-26T10:00:00.000Z"),
    version("dune-2668-8.html", "2026-10-26T12:00:00.000Z"),
    version("dune-2668.html", "2026-10-26T09:00:00.000Z"),
    preview,
  ]

  test("a version key drops the extension and a trailing one- or two-digit -N, and keeps a longer number", () => {
    expect(versionKey("dune-2668-8.html")).toBe("dune-2668")
    expect(versionKey("dune-2668-12.html")).toBe("dune-2668")
    expect(versionKey("dune-2668.html")).toBe("dune-2668")
    expect(versionKey("dune-2668-123.html")).toBe("dune-2668-123")
    expect(versionKey("sidebar-mock.html")).toBe("sidebar-mock")
  })

  test("each page's versions group newest first, and the groups go newest first", () => {
    expect(groupVersions(pages).map((group) => group.map((p) => p.name))).toEqual([
      ["dune-2668-8.html", "dune-2668-3.html", "dune-2668.html"],
      ["sidebar-mock.html"],
    ])
  })

  test("a row keeps its hover, its link's focus ring and its time's tooltip over the link's overlay", () => {
    const html = renderToStaticMarkup(
      createElement(PageList, { apiUrl: "https://api.test", now: Date.now(), pages: [preview] }),
    )
    expect(html).toContain("hover:bg-muted")
    expect(html).toContain("has-[a:focus-visible]:ring-[3px]")
    expect(html).toMatch(/<span class="relative z-10"><time/)
  })

  test("a page with versions is one row that opens its newest, with an N versions dropdown; one with none reads as before", () => {
    const html = renderToStaticMarkup(
      createElement(PageList, { apiUrl: "https://api.test", now: Date.now(), pages }),
    )
    expect(html.match(/data-slot="item"/g)).toHaveLength(2)
    expect(html).toContain('href="https://api.test/api/v1/apps/previews/dune-2668-8.html"')
    expect(html).not.toContain('href="https://api.test/api/v1/apps/previews/dune-2668-3.html"')
    expect(html).toContain("3 versions")
    expect(html.match(/versions<svg/g) ?? []).toHaveLength(1)
  })
})
