import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const rule = () =>
  Bun.file(join(import.meta.dir, "../../../../extensions/core/rules/release.md")).text()

describe("the release rule (PG-213)", () => {
  test("its glance line has Ops send every lead the skills playground update names, for each live checker's reload", async () => {
    const text = await rule()
    expect(text.split("\n")[0]).toEndWith(
      "and sends each lead the skills `playground update` names as changed, for the lead to have each of its live checkers load them again.",
    )
    expect(text).toContain("each changed skill's name has reached every lead")
  })
})
