import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SidebarProvider } from "../../../../../../web/next/src/components/ui/sidebar"
import { YardRows } from "../../../../../../web/next/src/components/yard/yard-groups"
import type { YardChannel } from "../../../../../../web/next/src/lib/yard"

// React resolves from the web app's own packages, which this directory cannot see; the two calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: Node[]) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const channel = (over: Partial<YardChannel> = {}): YardChannel => ({
  id: "c1",
  joined: true,
  kind: "channel",
  lastMessageAt: null,
  mentions: 0,
  name: "general",
  peer: null,
  postRule: "members",
  topic: null,
  unread: 0,
  ...over,
})

const render = (rows: YardChannel[], shell: "dashboard" | "yard" = "dashboard") =>
  renderToStaticMarkup(
    createElement(SidebarProvider, null, createElement(YardRows, { rows, shell })),
  )

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href)

// a row's words, its icon's markup and its tooltip's attributes left out
const words = (html: string) =>
  [...html.matchAll(/<span[^>]*class="truncate[^"]*"[^>]*>([^<]*)<\/span>/g)].map(
    ([, text]) => text,
  )

describe("Yard's sidebar rows", () => {
  test("a channel row shows its hash once: the # icon, then the bare name", () => {
    const html = render([channel(), channel({ id: "c2", name: "releases" })])
    expect(words(html)).toEqual(["general", "releases"])
    expect(html.match(/<svg/g) ?? []).toHaveLength(2)
  })

  test("a direct message row shows the other member's login", () => {
    const dm = channel({
      id: "d1",
      kind: "dm",
      name: "dm:u1:u2",
      peer: { id: "u2", image: null, login: "octocat", name: "Octo Cat" },
    })
    expect(words(render([dm]))).toEqual(["octocat"])
  })

  // whatever the build, so the owner's hosted dashboard keeps its sessions beside a channel
  test("a row in the dashboard's sidebar opens the channel in the dashboard", () => {
    expect(hrefs(render([channel()], "dashboard"))).toEqual(["/dashboard/yard/c1"])
  })

  test("a row in Yard's own sidebar opens the channel in Yard's shell", () => {
    expect(hrefs(render([channel()], "yard"))).toEqual(["/yard/c/c1"])
  })
})
