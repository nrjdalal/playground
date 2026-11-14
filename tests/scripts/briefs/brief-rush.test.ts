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

  test("the owner step narrows to an org ticket and an outward send (#1350)", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).toContain(
      "A slice sends only these to him, via the dispatcher: a new org ticket, and an outward send",
    )
    expect(text).not.toContain(
      "shipping canary to main, new Linear tickets, irreversible deletes, and budget",
    )
  })
})

// issue 2030: the merge-tree line runs as written, pr:merge runs from the PR's own worktree, and logs stay inside the scratch folder
describe("brief-rush.md's merge and scratch lines run as written", () => {
  test("the before-each-round merge-tree check takes two commits", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    const line = text.split("\n").find((l) => l.startsWith("- Before each review round,")) ?? ""
    expect(line).toContain("`git merge-tree --write-tree <head> HEAD`")
    expect(line).toContain("exits 0 on a clean pair and 1 on a conflict")
    expect(text).not.toContain("--write-tree origin/canary <head> HEAD")
  })

  test("pr:merge runs from the PR's own worktree, never a checkout of origin/canary", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).not.toContain("from a checkout of current origin/canary")
    expect(text).toContain("run from your PR's own worktree")
  })

  test("every log goes inside the session's own scratch folder", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    const line = text.split("\n").find((l) => l.startsWith("Plan: ")) ?? ""
    expect(line).toContain("Write every log inside that folder")
    expect(line).toContain("`scratch/<session>-x.log`")
  })
})
