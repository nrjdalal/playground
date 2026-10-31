import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const rule = () =>
  Bun.file(join(import.meta.dir, "../../../../extensions/core/rules/release.md")).text()

describe("the release rule (PG-213)", () => {
  test("has Ops pass playground update's changed skills to every lead, for each live checker's reload", async () => {
    const text = await rule()
    expect(text).toContain(
      "When `playground update` prints `skills changed:`, Ops sends each lead those names",
    )
    expect(text).toContain("has each of its live checkers load them again")
    expect(text).toContain("each changed skill's name has reached every lead")
  })
})
