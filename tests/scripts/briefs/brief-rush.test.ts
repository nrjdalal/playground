import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "../../..")
const read = (path: string) => Bun.file(join(root, path)).text()

// The rush brief rides on every worker spawn, so its own header scopes it to the lane it applies to.
describe("brief-rush.md scopes itself to the lanes it binds (#2235)", () => {
  test("the header opens with its scope and names the lanes it binds and skips", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).toMatch(/^Scope: /)
    expect(text).toContain("binds every worker that builds")
    expect(text).toContain("A read-only lane")
  })

  test("the versioned brief keeps the live body's RUN SLOTS opener and worker greeting", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).toContain("RUN SLOTS")
    expect(text).toContain("You are worker-<name>: fill in the name your lead gave you.")
  })
})
