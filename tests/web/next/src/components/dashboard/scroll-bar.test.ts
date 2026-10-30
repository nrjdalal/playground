import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const read = (path: string) =>
  Bun.file(join(import.meta.dir, "../../../../../../web/next/src/components", path)).text()

describe("the chat's Checkpoint bar", () => {
  test("the count of messages on their way holds still as it ticks", async () => {
    expect(await read("dashboard/scroll-bar.tsx")).toMatch(
      /<span className="[^"]*\bfont-mono\b[^"]*\btabular-nums\b[^"]*">\s*\{queued\}/,
    )
  })

  test("the composer no longer counts them, since the bar does", async () => {
    expect(await read("dashboard/composer.tsx")).not.toContain("on their way")
  })

  // the shared Checkpoint holds the one height and the missing line
  test("it is the shared Checkpoint, its parts spread to both edges", async () => {
    const bar = await read("dashboard/scroll-bar.tsx")
    expect(bar).toContain('import { Checkpoint } from "@/components/checkpoint"')
    expect(bar).toContain('<Checkpoint className="w-full justify-between">')
    expect(bar).not.toContain("@/components/ui/marker")
  })

  // its spacing matches the stream's
  test("Scroll to end leads the arrows, so its empty slot opens no gap before the toggle", async () => {
    const bar = await read("dashboard/scroll-bar.tsx")
    expect(bar.indexOf('label="Scroll to end"')).toBeLessThan(
      bar.indexOf('label="Previous message of yours"'),
    )
  })

  test("the toggle is the stock outline Toggle, never a solid primary pill", async () => {
    expect(await read("dashboard/scroll-bar.tsx")).not.toContain("bg-primary")
  })

  test("the bar stands 8px clear of the composer's top border", async () => {
    expect(await read("dashboard/scroll-bar.tsx")).toContain(
      '<div data-slot="chat-checkpoint" className="@container shrink-0 pb-2">',
    )
  })

  test("its icons are Remix: no lucide icon", async () => {
    expect(await read("dashboard/scroll-bar.tsx")).not.toContain("lucide")
  })
})
