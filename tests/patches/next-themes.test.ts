import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

// React and next-themes resolve from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Renderable = unknown
const web = join(import.meta.dir, "../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: Renderable[]) => Renderable
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Renderable) => string
}
const { ThemeProvider } = (await import(Bun.resolveSync("next-themes", web))) as {
  ThemeProvider: unknown
}

const render = () =>
  renderToStaticMarkup(
    createElement(ThemeProvider, {
      attribute: "class",
      defaultTheme: "system",
      enableSystem: true,
    }),
  )

const scope = globalThis as { window?: unknown }

afterEach(() => {
  delete scope.window
})

describe("the next-themes patch", () => {
  test("the server still sends the theme script, so the first paint has the theme", () => {
    expect(render()).toContain("<script>")
  })

  test("a render with a window has no script, so React logs no script-tag error", () => {
    scope.window = globalThis
    expect(render()).not.toContain("<script")
  })
})
