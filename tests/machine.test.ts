import { expect, test } from "bun:test"

import { NO_ORIGIN, noZsh, rowMode } from "./machine"

test("a row runs with nothing missing, skips with a reason off CI, and fails with one under CI", () => {
  expect(rowMode(undefined, undefined)).toBe("run")
  expect(rowMode(undefined, "true")).toBe("run")
  expect(rowMode("zsh not on PATH", undefined)).toBe("skip")
  expect(rowMode("zsh not on PATH", "true")).toBe("fail")
})

test("zsh is missing from a PATH that holds no zsh, naming that PATH", () => {
  expect(noZsh("/nonexistent")).toContain("zsh not on PATH /nonexistent;")
})

// GitHub CI's checkout has its origin and its Suite shards install zsh, so a reason that fires there is a lost install, red rather than a quiet skip
test("under CI the checkout has its GitHub origin and zsh is on PATH and in /usr/bin:/bin", () => {
  if (!process.env.CI) return
  expect(NO_ORIGIN).toBeUndefined()
  expect(noZsh()).toBeUndefined()
  expect(noZsh("/usr/bin:/bin")).toBeUndefined()
})
