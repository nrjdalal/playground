import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BUILT_IN_ALIASES, CORE_SKILLS, skillsIn } from "../../packages/scripts/src/playground/orgs"
import { UPSTREAM_SKILLS } from "../../packages/scripts/src/vendor-upstream/stage"

const root = join(import.meta.dir, "..", "..")
const scratch = mkdtempSync(join(tmpdir(), "built-in-names-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The skills in the core scope's own folders named after a built-in's alias.
const aliasNamed = (checkout: string) =>
  CORE_SKILLS.flatMap((folder) =>
    [...skillsIn(join(checkout, folder)).keys()].filter(
      (name) => BUILT_IN_ALIASES.includes(name) && !UPSTREAM_SKILLS.includes(name),
    ),
  )

// A skill named after a built-in's alias never runs: Claude Code runs the built-in (a bare review ran /code-review, measured), so no skill of the core scope's own takes one. Upstream's vendored skills keep their names as published.
test("no skill in the core scope's own folders is named after a built-in's alias", () => {
  expect(aliasNamed(root)).toEqual([])
})

test("a skill named review is caught, and the aliases stay A to Z", () => {
  mkdirSync(join(scratch, "skills", "playground", "review"), { recursive: true })
  writeFileSync(join(scratch, "skills", "playground", "review", "SKILL.md"), "# review\n")
  expect(aliasNamed(scratch)).toEqual(["review"])
  expect([...BUILT_IN_ALIASES].sort()).toEqual(BUILT_IN_ALIASES)
})
