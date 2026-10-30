import { expect, test } from "bun:test"

import { accountKey, accountsOf, checkSetting } from "../../../../packages/settings/src"

test("usage.accounts takes each account's end, lead, marks, billing day and week reset", () => {
  const rows = [
    { email: "first@example.test", renews: 17 },
    { email: "second@example.test", ends: "2026-11-07T18:30:00+00:00", endsFirst: true },
    {
      email: "third@example.test",
      ends: null,
      nearLimit: true,
      weekReset: { hour: 15.5, weekday: 1 },
    },
  ]
  expect(checkSetting("usage.accounts", rows)).toMatchObject({ ok: true, value: rows })
})

test("usage.accounts refuses an account listed twice, a field it does not know and a bad reset", () => {
  const one = { email: "first@example.test" }
  expect(checkSetting("usage.accounts", [one, one]).ok).toBe(false)
  expect(checkSetting("usage.accounts", [{ ...one, plan: "x" }]).ok).toBe(false)
  expect(checkSetting("usage.accounts", [{ ...one, weekReset: { hour: 24, weekday: 0 } }]).ok).toBe(
    false,
  )
})

test("usage.switchAccount is an address or empty, and models.probe a model name", () => {
  expect(checkSetting("usage.switchAccount", "").ok).toBe(true)
  expect(checkSetting("usage.switchAccount", "first@example.test").ok).toBe(true)
  expect(checkSetting("usage.switchAccount", "first").ok).toBe(false)
  expect(checkSetting("models.probe", "").ok).toBe(false)
})

test("usage.accounts takes any number of Claude and GLM rows, a Claude row by its email and a GLM row by its label", () => {
  const rows = [
    { email: "first@example.test" },
    { email: "second@example.test", label: "work", provider: "claude" },
    { label: "zai", provider: "glm" },
    { label: "zai-2", provider: "glm" },
  ]
  expect(checkSetting("usage.accounts", rows)).toMatchObject({ ok: true, value: rows })
  expect(accountKey(rows[0]!)).toBe("first@example.test")
  expect(accountKey(rows[2]!)).toBe("zai")
  expect(accountsOf(rows, "claude").map(accountKey)).toEqual([
    "first@example.test",
    "second@example.test",
  ])
  expect(accountsOf(rows, "glm").map(accountKey)).toEqual(["zai", "zai-2"])
})

test("usage.accounts refuses a GLM row with no label, an email or a Claude field, a label twice and an unknown provider", () => {
  const glm = { label: "zai", provider: "glm" }
  expect(checkSetting("usage.accounts", [{ provider: "glm" }]).ok).toBe(false)
  expect(checkSetting("usage.accounts", [{ ...glm, email: "first@example.test" }]).ok).toBe(false)
  expect(checkSetting("usage.accounts", [{ ...glm, nearLimit: true }]).ok).toBe(false)
  expect(checkSetting("usage.accounts", [glm, glm]).ok).toBe(false)
  expect(checkSetting("usage.accounts", [{ label: "Has Space", provider: "glm" }]).ok).toBe(false)
  expect(
    checkSetting("usage.accounts", [{ email: "first@example.test", provider: "openai" }]).ok,
  ).toBe(false)
})
