import { describe, expect, test } from "bun:test"

import { attachmentDisposition, fileNameOf } from "../../../../../api/hono/src/lib/download"

describe("fileNameOf (#783)", () => {
  test("a title becomes a name a file can hold: each character a file name cannot hold a space, spaces run together, no dot or space at either end", () => {
    expect(fileNameOf("Weekly plan, updated draft", "html")).toBe("Weekly plan, updated draft.html")
    expect(fileNameOf(' Plan: a/b\\c *?"<>| \u0007 ', "pdf")).toBe("Plan a b c.pdf")
    expect(fileNameOf("..hidden..", "png")).toBe("hidden.png")
    expect(fileNameOf("Café, 100% ✓", "md")).toBe("Café, 100% ✓.md")
  })

  test("a title with nothing left is download, and a long one is cut to 120 characters before its extension", () => {
    expect(fileNameOf("/:*?", "png")).toBe("download.png")
    expect(fileNameOf("", "pdf")).toBe("download.pdf")
    expect(fileNameOf("a".repeat(300), "html")).toBe(`${"a".repeat(120)}.html`)
  })
})

describe("attachmentDisposition (#783)", () => {
  test("saves under the name, whole in filename* and as ASCII in filename", () => {
    expect(attachmentDisposition("Café 100% (draft).pdf")).toBe(
      "attachment; filename=\"Caf_ 100_ (draft).pdf\"; filename*=UTF-8''Caf%C3%A9%20100%25%20%28draft%29.pdf",
    )
  })
})
