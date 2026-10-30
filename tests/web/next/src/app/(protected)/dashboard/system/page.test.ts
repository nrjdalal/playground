import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const web = join(import.meta.dir, "../../../../../../../../web/next/src")
const read = (path: string) => Bun.file(join(web, path)).text()

// The live dashboard runs canary's latest head (always canary's latest, never a one-off hash, branch or worktree), so the System page names no build under its title.
describe("the System page", () => {
  test("shows no running build line", async () => {
    const page = await read("app/(protected)/dashboard/system/page.tsx")
    const home = await read("components/dashboard/system-home.tsx")
    expect(page).not.toMatch(/running=/)
    expect(home).not.toMatch(/\brunning\??:/)
  })
})
