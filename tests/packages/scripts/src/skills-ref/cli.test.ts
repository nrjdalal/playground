import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { specOnly } from "../../../../../packages/scripts/src/skills-ref/cli"

const SCRIPT = join(import.meta.dir, "../../../../../packages/scripts/src/skills-ref/cli.ts")
const ROOT = mkdtempSync(join(tmpdir(), "skills-ref-test-"))
afterAll(() => rmSync(ROOT, { force: true, recursive: true }))

const SKILL = [
  "---",
  "name: tidy",
  "description: Tidy a folder.",
  "disable-model-invocation: true",
  "hooks:",
  "  Stop:",
  "    - command: echo done",
  "license: Complete terms in NOTICE",
  "source: upstream",
  "---",
  "",
  "# Tidy",
  "",
].join("\n")

describe("the skills-ref step's copy", () => {
  test("drops each Claude Code key with the lines nested under it, and keeps every other key", () => {
    expect(specOnly(SKILL)).toBe(
      [
        "---",
        "name: tidy",
        "description: Tidy a folder.",
        "license: Complete terms in NOTICE",
        "source: upstream",
        "---",
        "",
        "# Tidy",
        "",
      ].join("\n"),
    )
  })

  test("drops the upstream keys only in the zerostarter bucket, so a core or org skill holding one still fails", () => {
    expect(specOnly(SKILL, "skills/zerostarter/tidy/SKILL.md")).not.toContain("source:")
    expect(specOnly(SKILL, "skills/playground/tidy/SKILL.md")).toContain("source: upstream")
    expect(specOnly(SKILL, "extensions/core/skills/tidy/SKILL.md")).toContain("source: upstream")
    expect(specOnly(SKILL, "extensions/acme/skills/tidy/SKILL.md")).toContain("source: upstream")
  })

  test("leaves a file with no frontmatter as it is", () => {
    expect(specOnly("# Tidy\n")).toBe("# Tidy\n")
  })
})

// a fake uv on PATH passes every copy and leaves a marked file once it meets makeScratch's marker in the copies' folder
test("the copies' folder is a marked scratch folder, gone once the run ends (#545)", () => {
  const bin = join(ROOT, "bin")
  const tmp = join(ROOT, "tmp")
  mkdirSync(bin)
  mkdirSync(tmp)
  writeFileSync(
    join(bin, "uv"),
    `#!/bin/sh\nfor f in "$TMPDIR"/skills-ref-*/.safe-delete-scratch; do [ -f "$f" ] && : > "${ROOT}/marked"; done\nexit 0\n`,
  )
  chmodSync(join(bin, "uv"), 0o755)
  const run = Bun.spawnSync([process.execPath, SCRIPT], {
    env: { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: tmp },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(run.stdout.toString()).toContain("skills pass skills-ref validate")
  expect(run.exitCode).toBe(0)
  expect(existsSync(join(ROOT, "marked"))).toBe(true)
  expect(readdirSync(tmp)).toEqual([])
})
