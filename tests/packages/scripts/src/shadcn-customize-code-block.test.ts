import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "../../../..")

// A transcript's fenced code is highlighted by shadcn's own code-block highlighter, which a sync now keeps verbatim from the registry.
describe("shadcn-customize", () => {
  test("keeps code-block's highlighter from the registry", async () => {
    for (const file of [
      "web/next/src/hooks/use-highlighted-code.ts",
      "web/next/src/lib/highlighter.tsx",
    ])
      expect(await Bun.file(join(root, file)).exists()).toBe(true)
  })

  test("CodeBlock itself needs no highlighter: it renders its text as it is", async () => {
    const source = await Bun.file(join(root, "web/next/src/components/ui/code-block.tsx")).text()
    expect(source).not.toContain("shiki")
    expect(source).not.toMatch(/from "@\/(lib\/highlighter|hooks\/use-highlighted-code)"/)
  })
})
