import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { OlderLog } from "../../../../../../web/next/src/components/sessions/session-view"

const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (element: unknown) => string
}

// the Sessions log's Load older takes the stream's line, one look across the two views of a session's history.
describe("the Sessions log's Load older", () => {
  const line = (more: boolean, loading = false) =>
    renderToStaticMarkup(createElement(OlderLog, { loading, more, onLoad: () => {} }))
  const marker = (html: string) => /<div [^>]*data-slot="marker"[^>]*>/.exec(html)?.[0] ?? ""

  const button = (html: string) => html.split("<button")[1]?.split(">")[0] ?? ""

  test("is a Checkpoint holding Load older, with its icon, while older entries remain", () => {
    const html = line(true)
    expect(marker(html)).toContain('data-variant="default"')
    expect(html).toContain('data-slot="marker-icon"')
    expect(html.slice(html.indexOf('data-slot="marker-content"'))).toContain("Load older</button>")
  })

  // round 1 review: a swap to a span, or a plain disabled button, left keyboard focus on the body
  test("stays one button focusable while disabled, as a page loads and once it reads The start of the session", () => {
    for (const html of [line(true, true), line(false)]) {
      expect(html.split("<button").length).toBe(2)
      expect(button(html)).toContain('aria-disabled="true"')
      expect(button(html)).not.toMatch(/ disabled[ =]/)
    }
    expect(line(false)).toContain("The start of the session</button>")
    expect(marker(line(false))).toBe(marker(line(true)))
  })
})
