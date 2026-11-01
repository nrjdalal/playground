import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const read = (path: string) =>
  Bun.file(join(import.meta.dir, "../../../../../../web/next/src/components", path)).text()

const boxClasses = (source: string) => ({
  row: source.match(/<InputGroupAddon\s+align="block-end"\s+className="([^"]*)"/)?.[1],
  text: source.match(/<InputGroupTextarea[\s\S]*?className="([^"]*)"/)?.[1],
})

describe("Yard's composer", () => {
  test("is the session composer's box at its sizes, so the two boxes stay one", async () => {
    const yard = boxClasses(await read("yard/channel-view.tsx"))
    expect(yard.text).toBeString()
    expect(yard.row).toBeString()
    expect(yard).toEqual(boxClasses(await read("dashboard/composer.tsx")))
  })

  // its words live in its own state alone, so a build reload waits while they show (build-reload.ts)
  test("holds a build reload while it holds typed words", async () => {
    const source = await read("yard/channel-view.tsx")
    const composer = source.slice(source.indexOf("function YardComposer"))
    expect(source).toContain('import { HOLDS_RELOAD } from "@/lib/build-reload"')
    expect(composer).toMatch(/<form\s+\{\.\.\.\{ \[HOLDS_RELOAD\]: "" \}\}/)
  })
})
