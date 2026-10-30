import { describe, expect, test } from "bun:test"

import { differs, rendered } from "../../../../../packages/scripts/src/docs-wrap/proof"

describe("docs:wrap's proof", () => {
  test("refuses a change of words or of rendered text", () => {
    expect(differs("One. Two.", "One.\nTwo.", false)).toBeUndefined()
    expect(differs("One. Two.", "One.\nThree.", false)).toBe("its characters changed")
    expect(differs("One. - Two.", "One.\n- Two.", false)).toBe("its rendered text changed")
  })

  test("reads MDX's components, so a rewrap inside one passes", () => {
    const tree = JSON.parse(rendered("<Note>\nOne. Two.\n</Note>\n", true))
    expect(tree.children[0].type).toBe("mdxJsxFlowElement")
    expect(
      differs("<Note>\nOne. Two.\n</Note>\n", "<Note>\nOne.\nTwo.\n</Note>\n", true),
    ).toBeUndefined()
  })

  test("refuses a rewrap inside an MDX attribute's value", () => {
    expect(differs('<Note title="One. Two." />\n', '<Note title="One.\nTwo." />\n', true)).toBe(
      "its rendered text changed",
    )
  })
})
