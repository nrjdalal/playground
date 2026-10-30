import { expect, test } from "bun:test"

import {
  lineDiff,
  revisionLines,
  revisionSha,
  secretIn,
  stableJson,
} from "../../../../packages/settings/src"

test("stableJson sorts every object's keys, so the same rows are the same bytes", () => {
  expect(stableJson({ b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } })).toBe(
    stableJson({ a: { c: [{ e: 2, f: 1 }], d: 2 }, b: 1 }),
  )
  expect(stableJson({ b: 1, a: 2 }).startsWith('{\n  "a"')).toBe(true)
})

test("a revision's sha256 follows its content alone", () => {
  const content = { body: "one", files: null, meta: { tags: ["a"] }, value: null }
  expect(revisionSha(content)).toMatch(/^[0-9a-f]{64}$/)
  expect(revisionSha({ ...content })).toBe(revisionSha(content))
  expect(revisionSha({ ...content, body: "two" })).not.toBe(revisionSha(content))
})

test("lineDiff marks removed and added lines with two lines of context, and a gap with @@", () => {
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
  const b = ["1", "2", "3", "4", "five", "6", "7", "8", "9"]
  expect(lineDiff(a, b)).toEqual(["@@", "  3", "  4", "- 5", "+ five", "  6", "  7", "@@"])
  expect(lineDiff(a, a)).toEqual([])
  expect(lineDiff([], ["x"])).toEqual(["+ x"])
})

test("a revision's lines are its body, then each other part as stable JSON under its heading", () => {
  expect(revisionLines({ body: "a\nb", files: null, meta: null, value: ["x"] })).toEqual([
    "a",
    "b",
    "[value]",
    "[",
    '  "x"',
    "]",
  ])
})

test("secretIn finds a secret anywhere in a value, a key included, and names its kind", () => {
  expect(secretIn({ list: ["ok", { note: `xoxb-${"1".repeat(12)}` }] })).toBe("a Slack token")
  expect(secretIn({ [`pgcli_${"a".repeat(64)}`]: 1 })).toBe("a Playground CLI token")
  expect(secretIn("postgres://u:pw@127.0.0.1:5432/db")).toBe("a URL with a password")
  expect(
    secretIn({ names: ["GH_TOKEN", "op://vault/item"], url: "https://example.com" }),
  ).toBeUndefined()
})
