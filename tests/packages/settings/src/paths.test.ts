import { expect, test } from "bun:test"

import { checkSetting, codeRoot } from "../../../../packages/settings/src"

const unset = { schemaVersion: 1 as const, values: {} }

test("paths.codeRoot unset is the folder that holds the checkout, so no default names a person's folder", () => {
  expect(codeRoot(unset, "/home/someone/code/playground")).toBe("/home/someone/code")
  expect(
    codeRoot({ schemaVersion: 1, values: { "paths.codeRoot": "/srv/src" } }, "/a/playground"),
  ).toBe("/srv/src")
})

test("paths.codeRoot takes an absolute path or empty", () => {
  expect(checkSetting("paths.codeRoot", "/srv/src").ok).toBe(true)
  expect(checkSetting("paths.codeRoot", "").ok).toBe(true)
  expect(checkSetting("paths.codeRoot", "src").ok).toBe(false)
})
