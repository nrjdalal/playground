import { describe, expect, test } from "bun:test"

import { attachmentDisposition } from "../../../../../api/hono/src/lib/download"
import { dispositionName } from "../../../../../web/next/src/lib/download"

describe("dispositionName (#783)", () => {
  test("reads back the name the API gave, filename* first, else filename", () => {
    for (const name of ["Weekly plan, updated draft.html", "Café 100% (draft).pdf", "a'b.png"]) {
      expect(dispositionName(attachmentDisposition(name))).toBe(name)
    }
    expect(dispositionName('attachment; filename="plain.png"')).toBe("plain.png")
    expect(dispositionName(`attachment; filename="plain.png"; filename*=UTF-8''%E0%A4`)).toBe(
      "plain.png",
    )
    expect(dispositionName("attachment")).toBeNull()
    expect(dispositionName(null)).toBeNull()
  })
})
