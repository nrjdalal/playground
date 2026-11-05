import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readSessionNames,
  readSessionTemplates,
  sessionTemplates,
} from "../../../../packages/settings/src"

const scratch = mkdtempSync(join(tmpdir(), "session-names-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const DEFAULTS = {
  aliases: {},
  names: { builder: "builder", dispatcher: "dispatcher", ops: "ops", planner: "planner" },
}

test("a fresh machine's extensions, with no policy.json written yet, read the default names", () => {
  const data = join(scratch, "fresh")
  mkdirSync(join(data, "extensions", "made-up-me"), { recursive: true })
  writeFileSync(join(data, "extensions", "login"), "made-up-me\n")
  expect(readSessionNames(data)).toEqual(DEFAULTS)
})

test("a policy.json that is there and does not parse is a refusal, never the defaults", () => {
  const data = join(scratch, "broken")
  mkdirSync(join(data, "extensions"), { recursive: true })
  writeFileSync(join(data, "extensions", "policy.json"), "{")
  expect(() => readSessionNames(data)).toThrow("policy.json does not parse")
})

test("a policy.json's names are the machine's", () => {
  const data = join(scratch, "named")
  mkdirSync(join(data, "extensions"), { recursive: true })
  const names = { builder: "maker", dispatcher: "boss", ops: "keeper", planner: "thinker" }
  writeFileSync(
    join(data, "extensions", "policy.json"),
    JSON.stringify({ values: { "sessions.names": names } }),
  )
  expect(readSessionNames(data)).toEqual({ aliases: {}, names })
})

describe("sessions.templates", () => {
  const defaults = () => readSessionTemplates(mkdtempSync(join(scratch, "templates-")))

  test("the defaults are Assistant, Orchestrator and a second dispatcher on Claude and on GLM, with no email in any", () => {
    expect(defaults().map((t) => t.label)).toEqual([
      "Assistant",
      "Orchestrator",
      "Second dispatcher on Claude",
      "Second dispatcher on GLM",
    ])
    expect(defaults().some((t) => t.account)).toBe(false)
  })

  test.each(["../secrets.md", "briefs/builder.md", "/etc/passwd", "a..md"])(
    "the schema refuses the brief %s, so no path leaves the brief folders",
    (brief) => {
      const orchestrator = defaults().find((t) => t.id === "orchestrator")!
      expect(sessionTemplates.safeParse([{ ...orchestrator, brief }]).success).toBe(false)
    },
  )

  test("the schema refuses an id listed twice, and a GLM template with an account", () => {
    const [assistant, , , glm] = defaults()
    expect(sessionTemplates.safeParse([assistant, assistant]).success).toBe(false)
    expect(sessionTemplates.safeParse([{ ...glm!, account: "someone@example.com" }]).success).toBe(
      false,
    )
  })
})
