import { describe, expect, test } from "bun:test"

import { isLoginCommand } from "../../../../../web/next/src/lib/login-expired"

describe("the composer's /login", () => {
  test("is Claude Code's /login command alone, however it is spaced", () => {
    expect(isLoginCommand("/login")).toBe(true)
    expect(isLoginCommand("  /LOGIN ")).toBe(true)
    expect(isLoginCommand("/login now")).toBe(true)
    expect(isLoginCommand("/loginx")).toBe(false)
    expect(isLoginCommand("run /login for me")).toBe(false)
    expect(isLoginCommand("")).toBe(false)
  })
})
