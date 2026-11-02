import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ShownText } from "../../../../../../../web/next/src/components/dashboard/viewer/documents"
import PatchView, {
  patchFiles,
} from "../../../../../../../web/next/src/components/dashboard/viewer/patch-view"

// React resolves from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
const web = join(import.meta.dir, "../../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const file = (name: string, from: string, to: string) =>
  `diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-${from}\n+${to}\n`

const PATCH = file("limit.ts", "const limit = 100", "const limit = rows.length")

describe("the patch view", () => {
  test("reads each file a git patch changes", () => {
    expect(patchFiles(PATCH).map((f) => f.name)).toEqual(["limit.ts"])
    expect(patchFiles(PATCH + file("rows.ts", "a", "b")).map((f) => f.name)).toEqual([
      "limit.ts",
      "rows.ts",
    ])
  })

  test("reads no file from text that is no patch", () => {
    for (const text of ["", "- const limit = 100\n+ const limit = rows.length", "plain words"])
      expect(patchFiles(text)).toEqual([])
  })

  test("a broken patch shows the text view in its place", () => {
    const html = renderToStaticMarkup(
      createElement(PatchView, { fallback: "the text view", text: "- a\n+ b" }),
    )
    expect(html).toBe("the text view")
  })

  test("a diff or patch file routes to the patch view, and any other code file shows as text", () => {
    const shown = (name: string) =>
      renderToStaticMarkup(createElement(ShownText, { code: true, name, text: PATCH }))
    for (const name of ["fix.diff", "fix.patch", "FIX.PATCH"]) {
      // the patch view loads on its own, so its first paint is the loading spinner, never the text
      expect(shown(name)).toContain('role="status"')
      expect(shown(name)).not.toContain('data-slot="code-block"')
    }
    expect(shown("limit.ts")).toContain('data-slot="code-block"')
    expect(shown("limit.ts")).not.toContain('role="status"')
  })
})

// A page with no diff open loads none of the package: only the patch view imports it, and the viewer reaches the patch view through a dynamic import alone.
describe("the package stays in its own chunk", () => {
  const src = join(web, "src")
  test("only patch-view.tsx imports @pierre/diffs, and documents.tsx loads it with next/dynamic", async () => {
    const importers: string[] = []
    for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan(src)) {
      const text = await Bun.file(join(src, path)).text()
      if (/from "@pierre\/diffs/.test(text)) importers.push(path)
      if (/(?<!import\()["']@\/components\/dashboard\/viewer\/patch-view["']/.test(text))
        importers.push(`${path} (static)`)
    }
    expect(importers).toEqual(["components/dashboard/viewer/patch-view.tsx"])
    const documents = await Bun.file(join(src, "components/dashboard/viewer/documents.tsx")).text()
    expect(documents).toContain('dynamic(() => import("@/components/dashboard/viewer/patch-view")')
  })
})
