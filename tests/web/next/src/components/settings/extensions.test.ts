import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Extensions } from "../../../../../../web/next/src/components/settings/extensions"
import { EXTENSIONS_QUERY_KEY } from "../../../../../../web/next/src/lib/extensions"

type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}
const { QueryClient, QueryClientProvider } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as {
  QueryClient: new () => {
    getQueryCache: () => {
      build: (
        client: unknown,
        options: { queryKey: readonly unknown[] },
      ) => { setState: (state: object) => void }
    }
    setQueryData: (key: readonly unknown[], data: unknown) => void
    setQueryDefaults: (key: readonly unknown[], options: object) => void
  }
  QueryClientProvider: unknown
}

describe("Settings > Extensions", () => {
  test("before the extensions login, shows Set up settings and names no terminal command", () => {
    const client = new QueryClient()
    client.setQueryData(EXTENSIONS_QUERY_KEY, null)
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Extensions)),
    )
    expect(html).toContain(">Set up settings<")
    expect(html).not.toContain("playground ext init")
    expect(html).not.toContain("in a terminal")
    expect(html).not.toMatch(/login/i)
  })

  test("a read that fails says so, never that the settings are not set up", () => {
    const client = new QueryClient()
    // a failed read is read again on mount; the render is the one the page holds once that fails too
    client.setQueryDefaults(EXTENSIONS_QUERY_KEY, { retryOnMount: false })
    client
      .getQueryCache()
      .build(client, { queryKey: EXTENSIONS_QUERY_KEY })
      .setState({ data: undefined, error: new Error("The API did not answer"), status: "error" })
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Extensions)),
    )
    expect(html).toContain("The API did not answer")
    expect(html).not.toContain("set up yet")
    expect(html).not.toContain(">Set up settings<")
  })
})
