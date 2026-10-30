import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { renamePath, renameText } from "../../../packages/scripts/src/rename/rules"
import { check } from "../../../scripts/hooks/no-playground-leak"
import { OLD } from "../../old-names"

const root = join(import.meta.dir, "..", "..", "..")
// The list's path as the codemod leaves it, so a rename of the file moves this test with it.
const list = join(root, renamePath("extensions/core/lists/playground-terms.json"))
let scratch = ""

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "terms-codemod-"))
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

// Whether the leak guard refuses a Acme comment holding the text, on the repo's own list: a Linear comment, which the guard checks whatever ext.links names.
const refuses = async (text: string) =>
  (await check(
    JSON.stringify({
      cwd: scratch,
      hook_event_name: "PreToolUse",
      tool_input: { body: `see ${text}`, issueId: "CEDAR-1" },
      tool_name: "mcp__linear-shared__save_comment",
    }),
    { CLAUDE_CONFIG_DIR: scratch, PLAYGROUND_DATA_DIR: join(scratch, "data") },
    join(scratch, "no-checkout"),
    dirname(list),
  )) !== undefined

// Plain text the codemod writes, which the list leaves out since everyday writing holds it ("live desk" becomes "live dashboard", an ordinary phrase).
const PLAIN = new Set(["dashboard", "dashboards", "live dashboard", "playground"])

// One old identifier per codemod pattern whose target is a name, not a plain word.
const OLD_TERMS = [
  `.claude/${OLD.dispatcher}`,
  `${OLD.dispatcher.toUpperCase()}_ROLE`,
  `com.${OLD.dispatcher}.ops-awake`,
  `${OLD.dispatcher}-dashboard-db`,
  `${OLD.dispatcher}-factory`,
  `${OLD.dispatcher}.localhost`,
  `no-${OLD.dispatcher}-leak`,
]

// The new identifiers the switch makes that no codemod pattern writes.
const NEW = ["live/dashboard", "playground-backup"]

describe("the leak guard's terms keep up with the codemod", () => {
  test.each(OLD_TERMS)("the codemod's target for %s is a term", async (old) => {
    const target = renameText(old)
    expect(target).not.toBe(old)
    expect(PLAIN.has(target.toLowerCase())).toBe(false)
    expect(await refuses(target)).toBe(true)
  })

  test.each(NEW)("%s is a term", async (name) => {
    expect(await refuses(name)).toBe(true)
  })

  test("every term the codemod rewrites has its new text in the list too, unless that text is plain", async () => {
    const terms = (await Bun.file(list).json()) as Record<string, unknown>
    const written = ["aliases", "names", "paths"].flatMap((key) => terms[key] as string[])
    const moved = written.filter((term) => renameText(term) !== term)
    expect(moved).toContain("live desk")
    for (const term of moved)
      if (!PLAIN.has(renameText(term).toLowerCase())) expect(written).toContain(renameText(term))
  })

  test("the plain words stay out, so everyday text passes", async () => {
    for (const word of PLAIN) expect(await refuses(word)).toBe(false)
  })
})
