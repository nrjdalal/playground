import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const web = join(import.meta.dir, "../../../../../../web/next")
const home = await Bun.file(join(web, "src/components/settings/settings-home.tsx")).text()

describe("the Settings page", () => {
  test("shows nothing of the machine below the owner rung", () => {
    expect(home).toMatch(/allowed \?[\s\S]*<Accounts \/>[\s\S]*: \(\s*<OwnerOnly/)
  })
})
