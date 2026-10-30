import { expect, test } from "bun:test"

import { summarize } from "../../../../scripts/ops/dashboard/alert-summary"

test("an alert object reads kind name since", () => {
  expect(summarize({ kind: "wait", name: "92jbmh-worker", since: "2026-10-23T22:00:00Z" })).toBe(
    "wait 92jbmh-worker since 2026-10-23T22:00:00Z",
  )
})

test("a list of alerts joins with a semicolon and a space", () => {
  expect(
    summarize([
      { kind: "wait", name: "worker-a", since: "2026-10-23T22:00:00Z" },
      { kind: "docker", name: "playground-db", since: "2026-10-23T22:05:00Z" },
    ]),
  ).toBe(
    "wait worker-a since 2026-10-23T22:00:00Z; docker playground-db since 2026-10-23T22:05:00Z",
  )
})

test("a missing or null key reads None, as python's get printed", () => {
  expect(summarize({ kind: "feed" })).toBe("feed None since None")
  expect(summarize({ kind: "wait", name: null, since: null })).toBe("wait None since None")
})
