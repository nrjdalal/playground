import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const source = await Bun.file(
  join(import.meta.dir, "../../../../../../web/next/src/components/dashboard/preview-pane.tsx"),
).text()

// the Inbox's Preview row, its shape as the owner asked for it in the preview
describe("the Preview pane", () => {
  test('its bar is one accordion row tall, its icons 14px and muted until hovered (the owner: "These icons are bigger in size and bright by default. That shouldn\'t be the case")', () => {
    expect(source).toContain('className="flex h-[34px] items-center gap-1.5"')
    expect(source).toContain(
      'const PANE_BUTTON = "text-muted-foreground hover:text-foreground size-7 [&_svg]:size-3.5!"',
    )
    expect(source.match(/className=\{PANE_BUTTON\}/g)).toHaveLength(3)
  })

  test('its frame runs edge to edge and down to the pane\'s bottom, a top border only (the owner: "Make the browser window full width and without circular corners", "This gap at the bottom ... shouldn\'t exist for the preview")', () => {
    expect(source).toContain('className="-mx-(--pane-x) overflow-hidden border-t bg-black"')
    expect(source).toContain("style={{ height, marginBottom: -bleed }}")
    expect(source).toContain("data-preview-frame")
  })

  test("the open address comes from startAddress, on every open, since a fold unmounts the pane", () => {
    expect(source).toContain(
      "const next = startAddress(localStorage.getItem(URL_KEY), stacks.data ?? [], config.api.url)",
    )
  })

  test("a page from Previews loads with no script and no referrer, and only a loadable address loads", () => {
    expect(source).toContain(
      '{...(page ? { referrerPolicy: "no-referrer" as const, sandbox: "" } : {})}',
    )
    expect(source).toContain("if (!canLoad(next)) return")
  })
})
