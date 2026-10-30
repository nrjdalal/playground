import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  ActionSlot,
  CopyMessage,
  FooterAction,
  StatusFooter,
  StatusMark,
} from "../../../../../../web/next/src/components/dashboard/status-mark"

// React resolves from the web app's own packages, which this directory cannot see.
type Node = unknown
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: Node[]) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const render = (mark: "delivered" | "failed" | "sending" | "sent", label: string) =>
  renderToStaticMarkup(createElement(StatusMark, { label, mark }))

// the opening tag of the live region the mark sits in
const slot = (html: string): string => /<span[^>]*role="status"[^>]*>/.exec(html)?.[0] ?? ""
const slotClass = (html: string): string => /class="([^"]*)"/.exec(slot(html))?.[1] ?? ""

const MARKS = [
  ["sending", "Sending…"],
  ["sent", "Sent, waiting for @Playground"],
  ["delivered", "Delivered"],
  ["failed", "Failed: too long"],
] as const

describe("the sent message's state as one mark", () => {
  test("every state sits in the same fixed-width slot, so the footer never shifts as it moves", () => {
    const classes = MARKS.map(([mark, label]) => slotClass(render(mark, label)))
    expect(classes[0]).toContain("w-4")
    expect(classes[0]).toContain("shrink-0")
    expect(new Set(classes).size).toBe(1)
  })

  test("a keyboard reaches every mark, so its words open on focus as well as hover", () => {
    for (const [mark, label] of MARKS) {
      expect(slot(render(mark, label)), mark).toContain('tabindex="0"')
    }
  })

  test("a footer always ends with its mark, whatever comes before it, so the mark never moves", () => {
    const html = renderToStaticMarkup(
      createElement(
        StatusFooter,
        { copy: "Deploy", label: "Delivered", mark: "delivered" },
        createElement("button", { type: "button" }, "Undo"),
      ),
    )
    const footer =
      /<div[^>]*data-slot="message-footer"[^>]*>([\s\S]*)<\/div>$/.exec(html)?.[1] ?? ""
    expect(footer.indexOf(">Undo</button>")).toBeGreaterThan(-1)
    expect(footer.indexOf('role="status"')).toBeGreaterThan(footer.indexOf(">Undo</button>"))
    expect(footer.endsWith("</span>")).toBe(true)
  })

  test("each state carries its words for a screen reader and the text the stream reads, its icon hidden", () => {
    for (const [mark, label] of MARKS) {
      const html = render(mark, label)
      expect(slot(html), mark).not.toBe("")
      expect(html, mark).toContain(`<span class="sr-only">${label}</span>`)
      expect(html, mark).toContain('aria-hidden="true"')
      // no button inside the live region
      expect(html, mark).not.toContain("<button")
    }
  })

  test("a spinner while on its way, turning only where motion is allowed; one tick once typed, two once delivered; red when it failed", () => {
    const icons = Object.fromEntries(MARKS.map(([mark, label]) => [mark, render(mark, label)]))
    expect(icons.sending).toContain("motion-safe:animate-spin")
    for (const mark of ["sent", "delivered", "failed"]) {
      expect(icons[mark], mark).not.toContain("animate-spin")
    }
    expect(icons.failed).toContain("text-destructive")
    for (const mark of ["sending", "sent", "delivered"]) {
      expect(icons[mark], mark).not.toContain("text-destructive")
    }
    const svgs = MARKS.map(
      ([mark, label]) => /<svg[^>]*>[\s\S]*?<\/svg>/.exec(render(mark, label))?.[0],
    )
    expect(new Set(svgs).size).toBe(4)
  })
})

// The footer's other parts render without the dashboard's context, as StatusMark does above.
const { RiCloseLine } = (await import(Bun.resolveSync("@remixicon/react", web))) as {
  RiCloseLine: (props: Record<string, unknown>) => Node
}

const renderAction = (label: string) =>
  renderToStaticMarkup(createElement(FooterAction, { Icon: RiCloseLine, label, onClick: () => {} }))

describe("a footer action's name (Copy, Unsend, Dismiss, Undo, Retry)", () => {
  test("sits whole in the button's aria-label, on the icon button itself", () => {
    const tag = /<button[^>]*>/.exec(renderAction('Unsend "hi there"'))?.[0] ?? ""
    expect(tag).toContain('aria-label="Unsend &quot;hi there&quot;"')
    expect(tag).toContain('type="button"')
  })

  test("is kept in the text the stream reads, its icon hidden from the name", () => {
    const html = renderAction("Dismiss")
    expect(html).toContain('<span class="sr-only">Dismiss</span>')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe("a message's Copy", () => {
  test("offers nothing on a message without words, files alone", () => {
    for (const text of ["", "   \n  "]) {
      expect(renderToStaticMarkup(createElement(CopyMessage, { text }))).toBe("")
    }
  })

  test("names the message in its aria-label and keeps the words in the text the stream reads", () => {
    const html = renderToStaticMarkup(createElement(CopyMessage, { text: "Deploy the api first" }))
    expect(html).toContain('aria-label="Copy &quot;Deploy the api first&quot;"')
    expect(html).toContain('<span class="sr-only">Copy &quot;Deploy the api first&quot;</span>')
  })
})

test("the action slot is one fixed width, empty or full, so Copy and the mark never move", () => {
  const cls = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? ""
  const empty = cls(renderToStaticMarkup(createElement(ActionSlot, null)))
  const full = cls(
    renderToStaticMarkup(
      createElement(ActionSlot, null, createElement("button", { type: "button" })),
    ),
  )
  expect(empty).toContain("w-6")
  expect(empty).toBe(full)
})

test("Undo and Dismiss sit before Copy, other buttons before them, the mark last", () => {
  const html = renderToStaticMarkup(
    createElement(
      StatusFooter,
      {
        action: createElement("button", { type: "button" }, "Undo"),
        copy: "Deploy the api first",
        label: "Delivered",
        mark: "delivered",
      },
      createElement("button", { type: "button" }, "Retry"),
    ),
  )
  const retry = html.indexOf(">Retry</button>")
  const undo = html.indexOf(">Undo</button>")
  const copy = html.indexOf("Copy &quot;Deploy the api first&quot;")
  const mark = html.indexOf('role="status"')
  expect(retry).toBeGreaterThan(-1)
  expect(undo).toBeGreaterThan(retry)
  expect(copy).toBeGreaterThan(undo)
  expect(mark).toBeGreaterThan(copy)
})

test("the action slot holds its place before Copy with no action, so Copy and the mark never move", () => {
  const html = renderToStaticMarkup(
    createElement(StatusFooter, { copy: "Deploy", label: "Delivered", mark: "delivered" }),
  )
  expect(html.indexOf('class="inline-flex w-6 justify-end"')).toBeGreaterThan(-1)
  expect(html.indexOf("Copy &quot;Deploy&quot;")).toBeGreaterThan(
    html.indexOf('class="inline-flex w-6 justify-end"'),
  )
})
