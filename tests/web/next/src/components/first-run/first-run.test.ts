import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { FirstRun } from "../../../../../../web/next/src/components/first-run/first-run"

// React and react-query resolve from the web app's own packages, which this directory cannot see.
type ReactNode = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: ReactNode[]) => ReactNode
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: ReactNode) => string
}
const { QueryClient, QueryClientProvider } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as { QueryClient: new () => unknown; QueryClientProvider: unknown }

const render = (gate: "normal" | "setup") =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(FirstRun, { gate }),
    ),
  )

// A signed-out first visit draws the frame while the sign-in and the checks read are in flight; it shows a visible loader, never a blank page that reads as a broken stack.
describe("the first-run frame is a visible loader, not a blank page", () => {
  test("gate normal shows the spinner before any effect runs", () => {
    expect(render("normal")).toContain('data-slot="spinner"')
  })

  test("gate setup shows it too, while the checks are unread", () => {
    expect(render("setup")).toContain('data-slot="spinner"')
  })
})
