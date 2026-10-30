import { describe, expect, mock, test } from "bun:test"
import { join } from "node:path"

import {
  SidebarUserMenu,
  userIdentity,
} from "../../../../../../web/next/src/components/shell/sidebar-user-menu"
import { SidebarProvider } from "../../../../../../web/next/src/components/ui/sidebar"
import { SYSTEM_QUERY_KEY } from "../../../../../../web/next/src/lib/system"

type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement, Fragment } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
  Fragment: unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

type User = Parameters<typeof SidebarUserMenu>[0]["user"]
const agent = { email: "agent@local.host", image: null, name: "LocalAgent" } as User

const render = (line: string | null) => {
  const { leading, primary, secondary } = userIdentity("Studio Mac", line)
  return renderToStaticMarkup(createElement(Fragment, null, leading, primary, secondary))
}

describe("userIdentity", () => {
  test("names this Mac with its initials over the account line", () => {
    const html = render("merritt@example.com")
    expect(html).toContain("Studio Mac")
    expect(html).toContain(">SM<")
    expect(html).toContain("merritt@example.com")
    expect(html).not.toContain("aria-busy")
  })

  test("while the account is read, the line holds its height as plain text: no placeholder box, no pulse", () => {
    const html = render(null)
    expect(html).toContain("Studio Mac")
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain("animate-pulse")
    expect(html).not.toContain("skeleton")
  })
})

// bun keeps a module mock for every test file after this one, so the real hooks stay and only the router is replaced
const navigation = (await import(Bun.resolveSync("next/navigation", web))) as Record<
  string,
  unknown
>
mock.module(Bun.resolveSync("next/navigation", web), () => ({
  ...navigation,
  useRouter: () => ({ push() {} }),
}))
const { QueryClient, QueryClientProvider } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as {
  QueryClient: new () => {
    getQueryCache: () => {
      build: (
        client: unknown,
        options: { queryKey: readonly unknown[] },
      ) => { setState: (state: Record<string, unknown>) => void }
    }
    setQueryData: (key: readonly unknown[], data: unknown) => void
  }
  QueryClientProvider: unknown
}

// The whole menu as the server and the first client render draw it: no effect runs, so a read with no data in the cache is still pending.
const menu = (props: { account?: boolean }, report?: { account: unknown }) => {
  const client = new QueryClient()
  if (report) client.setQueryData(SYSTEM_QUERY_KEY, report)
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        SidebarProvider,
        null,
        createElement(SidebarUserMenu, { ...props, machine: "Studio Mac", user: agent }),
      ),
    ),
  )
}

describe("SidebarUserMenu", () => {
  test("names this Mac at first paint, before any read, and never the sign-in user on the owner rung", () => {
    const html = menu({ account: true })
    expect(html).toContain("Studio Mac")
    expect(html).not.toContain("LocalAgent")
    expect(html).not.toContain("agent@local.host")
    expect(html).toContain('aria-busy="true"')
  })

  test("an owner's menu gives the account's email once the read lands, and No Claude account when none is linked", () => {
    const merritt = menu(
      { account: true },
      { account: { email: "merritt@example.com", name: "Merritt Rivera" } },
    )
    expect(merritt).toContain("merritt@example.com")
    expect(merritt).not.toContain("aria-busy")
    expect(menu({ account: true }, { account: null })).toContain("No Claude account")
  })

  test("once a read has failed, a refetch keeps its line rather than going blank again", () => {
    const client = new QueryClient()
    client.getQueryCache().build(client, { queryKey: SYSTEM_QUERY_KEY }).setState({
      errorUpdateCount: 1,
      fetchStatus: "fetching",
      status: "pending",
    })
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          SidebarProvider,
          null,
          createElement(SidebarUserMenu, { account: true, machine: "Studio Mac", user: agent }),
        ),
      ),
    )
    expect(html).toContain("No Claude account")
    expect(html).not.toContain("aria-busy")
  })

  test("below the owner rung the line is the sign-in user's email and waits on nothing", () => {
    const html = menu({})
    expect(html).toContain("Studio Mac")
    expect(html).toContain("agent@local.host")
    expect(html).not.toContain("aria-busy")
  })
})

// The menu's items render only once it opens, so its first item is read from the source.
const source = await Bun.file(join(web, "src/components/shell/sidebar-user-menu.tsx")).text()

describe("the menu's items", () => {
  // the menu square shows update available, since the system readings moved to the header and usage to the dispatchers
  test("Update now leads the menu only while an update is available", () => {
    const update =
      /\{update && \([\s\S]*?<DropdownMenuItem[\s\S]*?Update now[\s\S]*?<\/DropdownMenuItem>/.exec(
        source,
      )?.[0]
    expect(update).toContain("onClick={update.onUpdate}")
  })

  test("Settings is the first item after it and Home is gone", () => {
    const items = [...source.matchAll(/<DropdownMenuItem[\s\S]*?<\/DropdownMenuItem>/g)].map(
      (m) => m[0],
    )
    expect(items[0]).toContain("Update now")
    expect(items[1]).toContain('href="/dashboard/settings"')
    expect(items[1]).toContain("Settings")
    expect(source).not.toContain("RiHome4Line")
    expect(source).not.toMatch(/href="\/"/)
  })
})

describe("the menu's Documentation item", () => {
  test("opens /docs with the book icon, after the area's own links (Sessions)", () => {
    const docs = source.indexOf('href="/docs"')
    expect(docs).toBeGreaterThan(source.indexOf("links.map("))
    expect(source.slice(docs - 200, docs + 200)).toContain("RiBookOpenLine")
    expect(source.slice(docs, source.indexOf("</DropdownMenuItem>", docs))).toContain(
      "Documentation",
    )
  })
})
