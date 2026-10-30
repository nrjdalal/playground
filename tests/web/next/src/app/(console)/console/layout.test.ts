import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// The layout needs a session to render, so its wiring is read from the source.
const web = join(import.meta.dir, "../../../../../../../web/next/src")
const consoleLayout = await Bun.file(join(web, "app/(console)/console/layout.tsx")).text()

describe("the console's user menu", () => {
  test("reads the logged-in account on the owner rung alone, as the Dashboard's does", () => {
    expect(consoleLayout).toMatch(
      /<SidebarUserMenu[^>]*account=\{reachesConsole\(session\.user, "owner"\)\}/,
    )
  })

  test("takes the account from the one reader in the menu, never a copy of its own", () => {
    expect(consoleLayout).not.toContain("withAccount")
  })
})
