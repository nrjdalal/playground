import { describe, expect, test } from "bun:test"
import { join, relative } from "node:path"

// No skeletons: loading holds space with real content, an empty slot or plain text; the shadcn primitives stay in components/ui/, which shadcn:update owns.
const src = join(import.meta.dir, "../../../../web/next/src")

const SKELETON_IMPORT = /from\s+["']@\/components\/ui\/skeleton["']/
const PULSING_BOX =
  /className=(["'`{])[^\n]*\bbg-muted\b[^\n]*\banimate-pulse\b|className=(["'`{])[^\n]*\banimate-pulse\b[^\n]*\bbg-muted\b/

// Pure: the files that draw a skeleton: an import of the primitive, or a muted box that pulses.
export const skeletonFiles = (files: { path: string; text: string }[]): string[] =>
  files
    .filter(({ path }) => !path.startsWith("components/ui/"))
    .filter(({ text }) => SKELETON_IMPORT.test(text) || PULSING_BOX.test(text))
    .map(({ path }) => path)

describe("no skeletons on the Dashboard", () => {
  test("names a file that imports the skeleton primitive or pulses a muted box", () => {
    expect(
      skeletonFiles([
        { path: "a.tsx", text: 'import { Skeleton } from "@/components/ui/skeleton"' },
        { path: "b.tsx", text: '<span className="bg-muted size-8 motion-safe:animate-pulse" />' },
        { path: "c.tsx", text: '<span className="motion-safe:animate-pulse text-success" />' },
        { path: "components/ui/sidebar.tsx", text: 'from "@/components/ui/skeleton"' },
      ]),
    ).toEqual(["a.tsx", "b.tsx"])
  })

  test("no file outside components/ui/ draws one", async () => {
    const files: { path: string; text: string }[] = []
    for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan(src)) {
      files.push({
        path: relative(src, join(src, path)),
        text: await Bun.file(join(src, path)).text(),
      })
    }
    expect(files.length).toBeGreaterThan(50)
    expect(skeletonFiles(files)).toEqual([])
  })
})
