import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readSessionNames } from "../../../../packages/settings/src"

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
