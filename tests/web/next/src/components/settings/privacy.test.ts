import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Privacy } from "../../../../../../web/next/src/components/settings/privacy"
import { ACCOUNTS_QUERY_KEY } from "../../../../../../web/next/src/lib/accounts"
import { PRIVACY_KEYS, privacyQueryKey } from "../../../../../../web/next/src/lib/privacy"

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
  QueryClient: new () => { setQueryData: (key: readonly unknown[], data: unknown) => void }
  QueryClientProvider: unknown
}

const render = (settings?: { archive: unknown; names: unknown }, login = true) => {
  const client = new QueryClient()
  client.setQueryData(ACCOUNTS_QUERY_KEY, {
    accounts: [],
    login,
    scope: login ? "made-up-me" : null,
  })
  if (settings) {
    client.setQueryData(privacyQueryKey(PRIVACY_KEYS.archive), settings.archive)
    client.setQueryData(privacyQueryKey(PRIVACY_KEYS.names), settings.names)
  }
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Privacy)),
  )
}

describe("Settings > Privacy", () => {
  test("shows each setting's saved value in its field, with Save", () => {
    const html = render({ archive: "made-up/vault", names: ["sam", "samdev"] })
    expect(html).toContain(">Privacy<")
    expect(html).toContain(">Names you go by<")
    expect(html).toContain('value="sam, samdev"')
    expect(html).toContain(">Private archive repository<")
    expect(html).toContain('value="made-up/vault"')
    expect(html).toContain(">Save<")
    expect(html).not.toContain("terminal")
  })

  test("unset settings show empty fields under their placeholders", () => {
    const html = render({ archive: "", names: [] })
    expect(html).toContain('placeholder="owner/name"')
    expect(html).toContain('placeholder="yourname, yourhandle"')
    expect(html).toContain('value=""')
  })

  test("before the extensions login, shows Set up settings and no fields", () => {
    const html = render(undefined, false)
    expect(html).toContain(">Set up settings<")
    expect(html).not.toContain(">Names you go by<")
  })

  test("while the reads are pending, it holds an empty busy slot", () => {
    const html = render()
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain(">Save<")
  })
})
