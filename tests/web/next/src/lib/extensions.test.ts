import { expect, test } from "bun:test"

import {
  countsLine,
  type ExtensionRow,
  linkWords,
  movedNames,
  whyLines,
} from "../../../../../web/next/src/lib/extensions"

const row = (name: string): ExtensionRow => ({
  counts: {},
  links: [],
  login: false,
  name,
  repo: null,
  syncedAt: null,
})
const ROWS = ["taylor", "acme", "teammate-tests", "core"].map(row)

test("a card's counts read every kind, none included, one in the singular", () => {
  expect(countsLine({ list: 4, rule: 1, skill: 2 })).toBe("2 skills · 1 rule · 4 lists")
  expect(countsLine({})).toBe("0 skills · 0 rules · 0 lists")
})

test("a * link reads everywhere", () => {
  expect([linkWords("*"), linkWords("acme")]).toEqual(["everywhere", "acme"])
})

test("a drag moves one name and leaves core out, since it stays last", () => {
  expect(movedNames(ROWS, "teammate-tests", "taylor")).toEqual(["teammate-tests", "taylor", "acme"])
  expect(movedNames(ROWS, "taylor", "core")).toEqual(["taylor", "acme", "teammate-tests"])
})

test("Why names each extension by its place, and says so when core has none", () => {
  expect(whyLines(ROWS, { from: "taylor", shadowed: ["acme", "teammate-tests"] })).toEqual({
    core: "core has none",
    from: "1 taylor",
    hides: "2 acme · 3 teammate-tests",
  })
  expect(whyLines(ROWS, { from: "acme", shadowed: ["core"] })).toEqual({
    core: null,
    from: "2 acme",
    hides: "4 core",
  })
})
