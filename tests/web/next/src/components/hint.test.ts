import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Hint } from "../../../../../web/next/src/components/hint"

const web = join(import.meta.dir, "../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (element: unknown) => string
}

describe("Hint", () => {
  test("keeps its words for a screen reader as the element's description, as the title it replaced did", () => {
    const html = renderToStaticMarkup(
      createElement(Hint, { content: "Opened 2 Oct" }, createElement("time", null, "2d")),
    )
    expect(html).toContain('aria-description="Opened 2 Oct"')
    expect(html).not.toContain("title=")
  })

  test("a description of its own replaces the words a screen reader hears", () => {
    const html = renderToStaticMarkup(
      createElement(
        Hint,
        { content: "System\nMemory 60%", description: "System" },
        createElement("a", null, "60"),
      ),
    )
    expect(html).toContain('aria-description="System"')
    expect(html).not.toMatch(/aria-description="[^"]*Memory/)
  })

  test("with nothing to say describes nothing and shows no tooltip", () => {
    for (const content of ["", null, undefined]) {
      const html = renderToStaticMarkup(
        createElement(Hint, { content }, createElement("span", null, "x")),
      )
      expect(html).toContain(">x</span>")
      expect(html).not.toContain("aria-description")
    }
  })

  test("renders one element type with or without words, so a hover that comes and goes never remounts what holds focus", () => {
    const child = createElement("button", null, "Approve")
    const shape = (content: string) =>
      (Hint({ children: child as never, content }) as { type: unknown }).type
    expect(shape("")).toBe(shape("Wait a second"))
  })
})
