import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { FileIcon } from "../../../../../../../web/next/src/components/dashboard/viewer/file-icons"

// React resolves from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
const web = join(import.meta.dir, "../../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const icon = (name: string) => renderToStaticMarkup(createElement(FileIcon, { name }))

describe("a file tile's icon", () => {
  test("follows the file's extension", () => {
    expect(icon("notes.md")).not.toBe(icon("main.ts"))
  })

  test("draws the plain file for an extension it does not know, an inherited key's name included", () => {
    const plain = icon("data.unknown")
    for (const name of ["notes.constructor", "x.__proto__", "a.toString", "Makefile"]) {
      expect(icon(name)).toBe(plain)
    }
  })
})
