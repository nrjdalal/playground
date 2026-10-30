import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Accounts } from "../../../../../../web/next/src/components/settings/accounts"
import { ACCOUNTS_QUERY_KEY } from "../../../../../../web/next/src/lib/accounts"
import { SYSTEM_QUERY_KEY } from "../../../../../../web/next/src/lib/system"

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

const CLAUDE = {
  email: "pat@example.com",
  key: "pat@example.com",
  label: "work",
  provider: "claude",
  stored: true,
}
const GLM = { email: null, key: "zai", label: "zai", provider: "glm", stored: false }

const render = (
  accounts?: unknown[],
  login?: { email: string; name: string | null },
  extensionsLogin = true,
) => {
  const client = new QueryClient()
  if (accounts) client.setQueryData(ACCOUNTS_QUERY_KEY, { accounts, login: extensionsLogin })
  if (login) client.setQueryData(SYSTEM_QUERY_KEY, { account: login })
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Accounts)),
  )
}

describe("Settings > Accounts", () => {
  test("lists each account by its label or email with whether its token is kept, and Logged in on the login", () => {
    const html = render([CLAUDE, GLM], { email: "pat@example.com", name: null })
    expect(html).toContain(">Accounts<")
    expect(html).toContain("Claude · pat@example.com · Token kept · Logged in")
    expect(html).toContain("GLM · No token kept")
    expect(html).toContain('aria-label="Remove work"')
    expect(html).toContain('aria-label="Remove zai"')
    expect(html).toContain(">Add account<")
    expect(html).not.toContain("playground ext init")
  })

  test("with none listed, says how to add one, and keeps Add account", () => {
    const html = render([])
    expect(html).toContain("No accounts yet")
    expect(html).toContain(">Add account<")
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>\s*Add account/)
  })

  test("before the extensions login, shows Set up settings first, names no terminal command, and holds Add account disabled", () => {
    const html = render([], undefined, false)
    expect(html.indexOf(">Set up settings<")).toBeGreaterThan(html.indexOf(">Accounts<"))
    expect(html).toContain("Your settings aren&#x27;t set up yet")
    expect(html).toContain("private GitHub repo of yours")
    expect(html).not.toContain("playground ext init")
    expect(html).not.toContain("No accounts yet")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Add account/)
  })

  test("while the first read is pending, it holds an empty busy slot, never a placeholder box", () => {
    const html = render()
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain("animate-pulse")
    expect(html).not.toContain("No accounts yet")
  })

  test("until the read says the settings are set up, Add account stays disabled", () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>\s*Add account/)
  })

  test("a read that fails says so with the API's words, never that there are no accounts", () => {
    const client = new QueryClient()
    // a failed read is read again on mount; the render is the one the page holds once that fails too
    client.setQueryDefaults(ACCOUNTS_QUERY_KEY, { retryOnMount: false })
    client
      .getQueryCache()
      .build(client, { queryKey: ACCOUNTS_QUERY_KEY })
      .setState({ data: undefined, error: new Error("The API answered 500"), status: "error" })
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Accounts)),
    )
    expect(html).toContain("Accounts could not be read")
    expect(html).toContain("The API answered 500")
    expect(html).not.toContain("No accounts yet")
  })
})
