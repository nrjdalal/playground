import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const read = (path: string) =>
  Bun.file(join(import.meta.dir, "../../../../../../web/next/src", path)).text()

// the owner: "also clicking on Playground logo should switch it to vibeground", Vibeground being the Preview row
describe("the sidebar's brand", () => {
  test("on the dashboard it opens the Inbox's Preview row, and on the console it only links home", async () => {
    expect(await read("components/shell/brand-link.tsx")).toMatch(
      /opensPreview \? previewClick\(event, href, window\.location\)/,
    )
    expect(await read("components/shell/sidebar-shell.tsx")).toContain(
      "opensPreview={opensPreview}",
    )
    expect(await read("app/(protected)/layout.tsx")).toMatch(/\sopensPreview\s/)
    expect(await read("app/(console)/console/layout.tsx")).not.toContain("opensPreview")
  })

  test("the aside turns to the Inbox, again after a move resets its tab, and the Inbox opens the row, now or once it mounts", async () => {
    const aside = await read("components/dashboard/dashboard-aside.tsx")
    expect(aside).toContain("window.addEventListener(OPEN_PREVIEW, open)")
    expect(aside).toMatch(/if \(!takeMove\(at\)\) return\s+setTab\("inbox"\)/)
    expect(aside).toMatch(/const at = `\$\{pathname\}\$\{search \? `\?\$\{search\}` : ""\}`/)
    expect(aside).toMatch(/setSide\("inbox"\)\s+\}, \[at\]\)/)
    const inbox = await read("components/dashboard/inbox.tsx")
    expect(inbox).toMatch(/if \(takePreview\(\)\)\s+setShelvesOpen\(/)
  })
})
