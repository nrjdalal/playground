import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { TranscriptMessage } from "../../../../../web/next/src/components/transcript-message"
import { tipsOf } from "../tooltips"

// React resolves from the web app's own packages, which this directory cannot see; the two calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

type Props = Parameters<typeof TranscriptMessage>[0]

const AT = new Date(2026, 9, 6, 19, 37, 4)

const render = (props: Partial<Props>) =>
  renderToStaticMarkup(
    createElement(TranscriptMessage, {
      at: AT.toISOString(),
      now: new Date(2026, 9, 6, 21, 0),
      text: "Fixture reply",
      variant: "muted",
      who: "@Playground",
      ...props,
    } satisfies Props),
  ).replaceAll("&amp;", "&")

describe("TranscriptMessage", () => {
  // a session's words run full width, its name leading the message, @Playground then the content.
  test("an agent's message starts with its name as a mention, on the content's line, with no header above", () => {
    const html = render({})
    expect(html).not.toContain('data-slot="message-header"')
    expect(html).toMatch(/@Playground<\/span>.*Fixture reply/)
  })

  // the tag is part of the message, not a column the message sits to the right of
  test("the name is part of the message: it opens the first line and the words wrap under it, not beside it", () => {
    const html = render({})
    expect(html).toMatch(/<span data-float="true" class="[^"]*\bfloat-left\b[^"]*">@Playground/)
    expect(html).not.toMatch(/data-slot="message-content" class="[^"]*\bflex-row\b/)
  })

  // A turn can open with an image or a tool request rather than text.
  test("a turn that opens with a tool row, a thinking row or an image puts the name on its own line, never floating", () => {
    const html = render({ opensWithText: false, text: "" })
    expect(html).toMatch(/<span class="[^"]*\bblock\b[^"]*">@Playground/)
    expect(html).not.toMatch(/float-left[^"]*">@Playground/)
  })

  test("words that open with an image put the name on its own line too", () => {
    const html = render({ text: "![sketch](/api/v1/attachments/x.png) the sidebar" })
    expect(html).not.toMatch(/float-left[^"]*">@Playground/)
  })

  test("the stored time shows on hover at 12px muted, the whole moment in its tooltip", () => {
    for (const variant of ["default", "muted"] as const) {
      const html = render({ variant })
      expect(html).toMatch(new RegExp(`<time dateTime="${AT.toISOString()}"`))
      expect(html).not.toMatch(/<time[^>]*title=/)
      expect(tipsOf(html).some((tip) => tip.includes(":37:04"))).toBe(true)
      expect(html).toMatch(
        /<time[^>]*class="[^"]*\btext-xs\b[^"]*\btext-muted-foreground\b|<time[^>]*class="[^"]*\btext-muted-foreground\b[^"]*\btext-xs\b/,
      )
      expect(html).toMatch(
        /<time[^>]*class="[^"]*\bopacity-0\b[^"]*group-hover\/message:opacity-100/,
      )
    }
  })

  test("a pending message with no stored time has no time", () => {
    expect(render({ at: null })).not.toContain("<time")
  })

  // a message that opens with its thread's marker shows a chip that opens the thread, not the raw marker
  test("a leading [thread:<id>] marker reads as a chip linking to its thread, in his bubble and in an agent's words", () => {
    for (const variant of ["default", "muted"] as const) {
      const html = render({ text: "[thread:k7mq] Renamed: it reads Threads now.", variant })
      expect(html).toMatch(/<a [^>]*href="\/dashboard\/threads\/k7mq"[^>]*>.*k7mq<\/a>/)
      expect(html).not.toContain("[thread:k7mq]")
      expect(html).toContain("Renamed: it reads Threads now.")
    }
  })

  test("a marker past the start stays words, with no chip", () => {
    const html = render({ text: "Done, see [thread:k7mq] for it." })
    expect(html).not.toContain("/dashboard/threads/")
    expect(html).toContain("[thread:k7mq]")
  })

  test("a message of files alone has no bubble", () => {
    expect(render({ text: "  ", variant: "default" })).not.toContain('data-slot="bubble"')
  })

  test("his message of files alone keeps its time on the right", () => {
    expect(render({ text: "  ", variant: "default" })).toMatch(
      /<div class="[^"]*\bjustify-end\b[^"]*"><time /,
    )
  })

  test("an agent's words and a peer's read as full-width text, with no bubble", () => {
    for (const variant of ["muted", "tinted"] as const) {
      const html = render({ variant })
      expect(html).toContain('data-variant="ghost"')
      expect(html).toContain("w-full")
      expect(html).not.toMatch(/data-variant="(muted|tinted|default|agent)"/)
    }
  })

  // The owner's bubble is the stock muted one, as a session's own words were before they went full width.
  test("his message is the stock muted bubble, in the component's own grey, with no name shown", () => {
    // a caller that still names the agent (as the stream once did) gets no tint either
    const html = render({ ...({ agent: "dispatcher" } as object), variant: "default", who: "You" })
    expect(html).toContain('data-variant="muted"')
    expect(html).toContain("*:data-[slot=bubble-content]:bg-muted")
    expect(html).not.toContain("bg-primary")
    expect(html).not.toContain("--agent-hue")
    expect(html).not.toContain("oklch(")
    expect(html).not.toMatch(/@You/)
    expect(html).toMatch(/<span class="sr-only">You<\/span>/)
  })

  // Chat text sits on the 16, 14, 12, 10 ladder, and body text is 14.
  test("its words, its code and an agent's name are 14, its time 12", () => {
    for (const variant of ["default", "muted"] as const) {
      const html = render({ text: "see `inline`\n```\nblock\n```", variant })
      if (variant === "muted")
        expect(html).toMatch(/<span data-float="true" class="[^"]*\btext-sm\b[^"]*">@Playground/)
      expect(html).not.toContain("text-2xs")
      expect(html).toMatch(/data-slot="bubble-content" class="[^"]*\btext-sm\b/)
      expect(html).not.toMatch(/\]\]:text-xs/)
      expect(html).toMatch(/<code class="[^"]*\btext-sm\b[^"]*" data-streamdown="inline-code"/)
      expect(html).toMatch(/data-slot="code-block" [^>]*class="[^"]*\btext-sm\b/)
    }
  })

  // A change to one gap leaves the others as they were: the status line sits 2px under what is above it; a file card keeps its 10px under the owner's bubble (2px gap + 4px margin + the group's 4px padding).
  test("his status footer is snug while his file card keeps its gap under the bubble", () => {
    const html = render({ variant: "default" })
    expect(html).toMatch(/data-slot="message-content" class="[^"]*\bgap-0\.5\b/)
    expect(html).toContain("[&&gt;[data-slot=attachment-group]]:mt-1")
  })
})
