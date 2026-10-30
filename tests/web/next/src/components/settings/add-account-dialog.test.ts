import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { CODE_WAIT_MS } from "../../../../../../api/hono/src/lib/accounts/claude-setup"
import {
  ScrollingFields,
  SignInStatus,
} from "../../../../../../web/next/src/components/settings/add-account-dialog"
import { CODE_SUBMIT_MS, codeFailure } from "../../../../../../web/next/src/lib/accounts"

type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const status = (props: { checking?: boolean; refused?: string | null; starting?: boolean }) =>
  renderToStaticMarkup(
    createElement(SignInStatus, {
      checking: false,
      onAgain: () => {},
      refused: null,
      starting: false,
      ...props,
    }),
  )

const GONE =
  "This sign-in has ended, most likely because Playground restarted: start again for a new one"
const REFUSED =
  "Claude did not accept that code. It may be incomplete, expired, already used or from an earlier sign-in: start again for a new code"

describe("Add account's Claude sign-in", () => {
  test("while the code is checked, says so in words and offers nothing to click", () => {
    const html = status({ checking: true })
    expect(html).toContain("Checking the code with Claude…")
    expect(html).not.toContain("Start again")
  })

  test("while a sign-in starts, says so in words", () => {
    expect(status({ starting: true })).toContain("Starting the sign-in…")
  })

  test("a code that gave a token leaves no line, since the dialog closes on it", () => {
    expect(status({})).toBe("")
  })

  test.each([
    ["the page's own bound ran out", codeFailure(null, true), "Claude did not answer in time"],
    [
      "the API ended a sign-in it no longer holds",
      codeFailure({ code: "NOT_FOUND", message: GONE }, false),
      "most likely because Playground restarted",
    ],
    [
      "the API could not be reached",
      codeFailure({ code: "NETWORK_ERROR", message: "Network request failed" }, false),
      "Playground could not be reached",
    ],
    [
      "Claude refused the code",
      codeFailure({ code: "VALIDATION_ERROR", message: REFUSED }, false),
      "Claude did not accept that code",
    ],
  ])("when %s, says what happened and offers Start again", (_, refused, words) => {
    const html = status({ refused })
    expect(html).toContain(words)
    expect(html).toContain(">Start again<")
    expect(html).not.toContain("Checking the code")
  })

  test("in a short window the fields scroll while the sign-in's words stay outside them, in view", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollingFields, {
        children: createElement("i", null, "fields"),
        status: createElement(SignInStatus, {
          checking: true,
          onAgain: undefined,
          refused: null,
          starting: false,
        }),
      }),
    )
    const scrolling = html.match(/<div[^>]*overflow-y-auto[^>]*><i>fields<\/i><\/div>/)
    expect(scrolling).not.toBeNull()
    expect(html.indexOf("Checking the code with Claude…")).toBeGreaterThan(
      html.indexOf(scrolling![0]) + scrolling![0].length - 1,
    )
  })

  test("the page waits on a code a little longer than the API does", () => {
    expect(CODE_SUBMIT_MS).toBeGreaterThan(CODE_WAIT_MS)
    expect(CODE_SUBMIT_MS - CODE_WAIT_MS).toBeLessThanOrEqual(15_000)
  })
})
