import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { MessageLinks } from "../../../../../../web/next/src/components/yard/message-links"
import { config } from "../../../../../../web/next/src/lib/config"

type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const render = (links?: string[]) =>
  renderToStaticMarkup(createElement(MessageLinks, { links })).replaceAll("&amp;", "&")

describe("a Yard message's links", () => {
  test("another site's opens only on a click, in a new tab with no opener or referrer", () => {
    const html = render(["https://example.test/build/42"])
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/example\.test\/build\/42"[^>]*rel="noopener noreferrer"[^>]*target="_blank"/,
    )
  })

  test("our own opens in this tab", () => {
    const own = new URL("/yard", config.app.url).href
    const html = render([own])
    expect(html).toContain(`href="${own}"`)
    expect(html).not.toContain("_blank")
  })

  test("a link that is not http or https shows as words, never a link", () => {
    const html = render(["javascript:alert(1)", "data:text/html,hi"])
    expect(html).not.toContain("<a ")
    expect(html).toContain("javascript:alert(1)")
  })

  test("a message with none draws nothing", () => {
    expect(render()).toBe("")
    expect(render([])).toBe("")
  })

  test("the channel view and the approve page both show them", async () => {
    for (const file of ["channel-view.tsx", "approve.tsx"]) {
      const source = await Bun.file(join(web, "src/components/yard", file)).text()
      expect(source).toContain("<MessageLinks links={message.links} />")
    }
  })
})
