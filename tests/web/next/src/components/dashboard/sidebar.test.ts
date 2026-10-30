import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// The menus need the dashboard's providers to render, so their wiring is read from the source.
const web = join(import.meta.dir, "../../../../../../web/next/src")
const read = (path: string) => Bun.file(join(web, path)).text()
const layout = await read("app/(protected)/layout.tsx")
const menu = await read("components/dashboard/owner-menu.tsx")

describe("the Dashboard's user menu, in the aside toolbar (#i959)", () => {
  test("the layout hands it who is signed in, wrapping the page in its provider", () => {
    expect(layout).toMatch(
      /<OwnerMenuProvider canAccessConsole=\{reachesConsole\(session\.user\)\} machine=\{machine\}>/,
    )
  })

  test("its square opens the shared items upward, centred on the square, with the update and the area's links", () => {
    expect(menu).toContain('side="top" align="center"')
    expect(menu).toMatch(
      /<UserMenuItems\s+area=\{value\.canAccessConsole \? "dashboard" : undefined\}\s+links=\{links\}\s+logOut=\{false\}\s+update=\{update\}/,
    )
    expect(menu).toContain("getInitials(value.machine)")
  })

  test("holds no Log out, since the first-run pane signs this Mac's owner straight back in, while the Console's menu keeps it", async () => {
    const items = await read("components/shell/sidebar-user-menu.tsx")
    expect(items).toContain("logOut = true")
    expect(items).toMatch(/\{logOut && \(\s*<DropdownMenuItem/)
  })
})
