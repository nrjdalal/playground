import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  AttachmentChips,
  chipsFromEntry,
  chipsFromRefs,
} from "../../../../../../web/next/src/components/dashboard/attachments"

// React resolves from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const PNG = "3ec1fab9-9dd4-4327-8bac-642ce1981bf9.png"
const PDF = "ca570612-108f-4e64-bcb9-e86800347741.pdf"

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(AttachmentChips, props))

describe("chipsFromEntry", () => {
  test("a transcript's files are chips by id: an image shows itself from the API, anything else its kind", () => {
    const chips = chipsFromEntry([
      { id: PNG, kind: "image" },
      { id: PDF, kind: "pdf" },
    ])
    expect(chips.map((c) => [c.id, c.kind, c.name, c.size])).toEqual([
      [PNG, "image", null, null],
      [PDF, "pdf", null, null],
    ])
    expect(chips[0]?.preview).toEndWith(`/api/v1/attachments/${PNG}`)
    expect(chips[1]?.preview).toBeNull()
  })

  test("an id the API would not give is left out, so no URL is built from it", () => {
    const chips = chipsFromEntry([
      { id: "../../v1/user", kind: "image" },
      { id: PNG, kind: "image" },
    ])
    expect(chips.map((c) => c.id)).toEqual([PNG])
  })
})

describe("AttachmentChips", () => {
  test("a stream's chips open each file in a new tab, an image as its thumbnail and a PDF by its kind", () => {
    const html = render({
      items: chipsFromEntry([
        { id: PNG, kind: "image" },
        { id: PDF, kind: "pdf" },
      ]),
    })
    expect(html).toContain(`src="${chipsFromEntry([{ id: PNG, kind: "image" }])[0]?.preview}"`)
    expect(html).toContain(`href="${chipsFromEntry([{ id: PNG, kind: "image" }])[0]?.preview}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('aria-label="Open Image 1 of 2"')
    expect(html).toContain('aria-label="Open PDF 2 of 2"')
    expect(html).toContain(">PDF<")
    expect(html).toContain(">Document<")
    expect(html).toContain(">PNG<")
    expect(html).not.toContain("Remove")
  })

  // a reviewer: the link covers the chip, so a muted focus fill on it hid the file
  test("a chip's open link takes no fill on focus, and the chip's border lights instead", () => {
    const html = render({ items: chipsFromEntry([{ id: PNG, kind: "image" }]) })
    expect(html).toContain("focus-visible:bg-transparent")
    expect(html).toContain("has-[:focus-visible]:border-ring")
  })

  test("a pending message's chips name each file and its size", () => {
    const html = render({
      items: chipsFromRefs([
        { id: PDF, kind: "pdf", name: "spec.pdf", previewUrl: null, size: 300_000 },
      ]),
    })
    expect(html).toContain(">spec.pdf<")
    expect(html).toContain("PDF · 293 KB")
  })

  test("the composer's chips say which are still uploading, open nothing yet, and each can be removed", () => {
    const html = render({
      items: [
        {
          id: null,
          key: "k1",
          kind: null,
          name: "notes.md",
          preview: null,
          size: 120,
          uploading: true,
        },
      ],
      onRemove: () => {},
    })
    expect(html).toContain("Uploading")
    expect(html).toContain('aria-label="Remove notes.md"')
    expect(html).not.toContain("href=")
  })

  test("no files, no row", () => {
    expect(render({ items: [] })).toBe("")
  })
})
