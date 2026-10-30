import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "../../..")
const read = (path: string) => Bun.file(join(root, path)).text()

describe("the checker brief templates fill two-underscore slots alone (#1664)", () => {
  for (const name of ["new-reviewer.md", "new-tester.md"])
    test(`${name} fills its slots and leaves no slot to the formatter`, async () => {
      const text = await read(join("scripts/briefs", name))
      expect(text).toContain("SESSIONS.md fill rule (Spawn)")
      expect(text.match(/<(eta|lead|n|sha7|worker)>/g)).toBeNull()
      expect(text.match(/\*\*[A-Z0-9]+\*\*/g)).toBeNull()
      expect(text.replace(/`[^`]*`/g, "")).not.toContain("__")
    })

  test("new-tester.md names the session as a slot", async () => {
    const text = await read(join("scripts/briefs", "new-tester.md"))
    expect(text).toContain("You are `__NAME__`")
  })

  test("new-reviewer.md has the reviewer read its own name and the PR's current head (#1648)", async () => {
    const text = await read(join("scripts/briefs", "new-reviewer.md"))
    expect(text).toContain("first prompt names you")
    expect(text).toContain("`state.py pr`")
    expect(text).not.toContain("__NAME__")
    expect(text).not.toContain("__SHA7__")
    expect(text.match(/__(LEAD|ETA)__/g)).toBeNull()
    expect(text.match(/__WORKER__/g)?.length).toBe(1)
  })
})
