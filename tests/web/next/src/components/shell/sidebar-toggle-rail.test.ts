import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const web = join(import.meta.dir, "../../../../../../web/next/src")

// A bare SidebarRail under Hint loses its toggle to the tooltip trigger's onClick, so every sidebar draws its rail through SidebarToggleRail, which passes the toggle to the rail itself.
describe("SidebarToggleRail", () => {
  test("is the one place a sidebar rail is drawn", async () => {
    const drawn: string[] = []
    for await (const path of new Bun.Glob("**/*.tsx").scan(web)) {
      if (path.startsWith("components/ui/")) continue
      if (/<SidebarRail\b/.test(await Bun.file(join(web, path)).text())) drawn.push(path)
    }
    expect(drawn).toEqual(["components/shell/sidebar-toggle-rail.tsx"])
  })

  test("passes the toggle to the rail itself", async () => {
    const rail = await Bun.file(join(web, "components/shell/sidebar-toggle-rail.tsx")).text()
    expect(rail).toContain("<SidebarRail onClick={toggleSidebar} />")
  })
})
