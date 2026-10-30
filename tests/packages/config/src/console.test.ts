import { expect, test } from "bun:test"

import { storedAs } from "../../../../packages/config/src/console"

test("a dashboard action is also looked up under its old desk name, which rows written before the rename hold", () => {
  expect(storedAs("dashboard.message")).toEqual(["dashboard.message", "desk.message"])
  expect(storedAs("role.change")).toEqual(["role.change"])
})
