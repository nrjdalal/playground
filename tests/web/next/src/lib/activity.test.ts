import { expect, test } from "bun:test"

import { actionLabel } from "../../../../../web/next/src/lib/activity"

test("a row written before the rename reads with its new action's label, and an unknown code as itself", () => {
  expect(actionLabel("desk.answer")).toBe("Answered prompt")
  expect(actionLabel("desk.unknown")).toBe("desk.unknown")
})
