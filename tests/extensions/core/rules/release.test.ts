import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const rule = () =>
  Bun.file(join(import.meta.dir, "../../../../extensions/core/rules/release.md")).text()

describe("the release rule (PG-213)", () => {
  test("its glance line has Ops send every lead the folders playground update names, for each live checker to read the new text there", async () => {
    const text = await rule()
    expect(text.split("\n")[0]).toEndWith(
      "and sends each lead the folder `playground update` names for each changed skill, for the lead to have each of its live checkers read the new text there.",
    )
    expect(text).toContain("each changed skill's folder has reached every lead")
  })
})
