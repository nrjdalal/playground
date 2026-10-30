import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { UPSTREAM_SKILLS } from "../../packages/scripts/src/vendor-upstream/stage"

const ROOT = join(import.meta.dir, "../..")
const BUCKET = join(ROOT, "skills/playground")
const CORE = join(ROOT, "extensions/core")

// Every file under scripts/ops, where an ops job types a skill's /<name> as its headless prompt.
const OPS = join(ROOT, "scripts/ops")
const opsText = readdirSync(OPS, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
  .join("\n")

// A skill is promoted (GLOSSARY's Promoted) unless it is an internal worker, which gets its docs page alone: one with user-invocable: false, or a forked one an ops job types as `/<name>`, which keeps the default user-invocable (.agents/invocation.md, #2390).
const promoted = (name: string, bucket = BUCKET): boolean => {
  const skill = readFileSync(join(bucket, name, "SKILL.md"), "utf8")
  if (/^user-invocable:\s*false$/m.test(skill)) return false
  const typed = new RegExp(`["']/${name}["']`).test(opsText)
  return !(/^context:\s*fork$/m.test(skill) && typed)
}

const names = readdirSync(BUCKET)
  .filter((name) => existsSync(join(BUCKET, name, "SKILL.md")))
  .sort()

const bucketReadme = readFileSync(join(BUCKET, "README.md"), "utf8")
const topLevel = readFileSync(join(ROOT, "README.md"), "utf8")
const hasDocsPage = (name: string): boolean =>
  existsSync(join(ROOT, "docs", "playground", `${name}.md`))

describe("the playground skill registry", () => {
  test("a promoted skill has an entry in both READMEs and a docs page; an internal worker a docs page alone", () => {
    const missing: string[] = []
    for (const name of names) {
      if (promoted(name)) {
        if (!bucketReadme.includes(`](./${name}/SKILL.md)`))
          missing.push(`${name}: no entry in skills/playground/README.md`)
        if (!topLevel.includes(`](./skills/playground/${name}/SKILL.md)`))
          missing.push(`${name}: no entry in README.md's Skills section`)
      }
      if (!hasDocsPage(name)) missing.push(`${name}: no docs page at docs/playground/${name}.md`)
    }
    expect(missing, missing.join("; ")).toEqual([])
  })

  test("core's own skills, its upstream skills aside, are registered the same way, in core's README", () => {
    const skills = join(CORE, "skills")
    const coreReadme = readFileSync(join(CORE, "README.md"), "utf8")
    const missing: string[] = []
    for (const name of readdirSync(skills)
      .filter((n) => !UPSTREAM_SKILLS.includes(n))
      .sort()) {
      if (promoted(name, skills)) {
        if (!coreReadme.includes(`](./skills/${name}/SKILL.md)`))
          missing.push(`${name}: no entry in extensions/core/README.md`)
        if (!topLevel.includes(`](./extensions/core/skills/${name}/SKILL.md)`))
          missing.push(`${name}: no entry in README.md's Skills section`)
      }
      if (!hasDocsPage(name)) missing.push(`${name}: no docs page at docs/playground/${name}.md`)
    }
    expect(missing, missing.join("; ")).toEqual([])
  })
})

// link-skills.sh links each skill under its folder's name, so a folder whose frontmatter names another would read under two names, as an alias of a renamed skill would (#2535).
describe("each linked skill's name", () => {
  test("is its folder's name, and no two skill folders share one", () => {
    const skills = [BUCKET, join(CORE, "skills")]
      .flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.name === "SKILL.md")
      .map((entry) => ({
        folder: entry.parentPath.split("/").pop()!,
        name: /^name:\s*(\S+)$/m.exec(
          readFileSync(join(entry.parentPath, entry.name), "utf8"),
        )?.[1],
      }))
    expect(skills.filter((skill) => skill.name !== skill.folder)).toEqual([])
    expect(new Set(skills.map((skill) => skill.folder)).size).toBe(skills.length)
  })
})
