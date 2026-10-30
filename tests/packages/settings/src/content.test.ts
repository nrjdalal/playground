import { expect, test } from "bun:test"

import { contentProblem, KINDS } from "../../../../packages/settings/src"

const empty = { body: null, files: null, meta: null, value: null }

test("each kind's content holds its own part: a list its value, a skill its files, a script either, any other kind its body", () => {
  expect(contentProblem("list", { ...empty, value: ["a"] })).toBeUndefined()
  expect(contentProblem("list", empty)).toBe("a list holds a value")
  expect(contentProblem("skill", { ...empty, files: { "SKILL.md": "x" } })).toBeUndefined()
  expect(contentProblem("skill", { ...empty, files: {} })).toBe("a skill holds its folder's files")
  expect(contentProblem("script", { ...empty, body: "echo hi" })).toBeUndefined()
  expect(contentProblem("script", { ...empty, files: { "run.py": "print(1)" } })).toBeUndefined()
  expect(contentProblem("script", { ...empty, body: "  ", files: {} })).toBe(
    "a script holds a body or its folder's files",
  )
  for (const kind of KINDS.filter((kind) => !["list", "script", "skill"].includes(kind))) {
    expect(contentProblem(kind, { ...empty, body: "text" })).toBeUndefined()
    expect(contentProblem(kind, { ...empty, body: "  " })).toBe(`a ${kind} holds a body`)
  }
})
