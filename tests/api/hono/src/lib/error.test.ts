import { expect, test } from "bun:test"
import { join } from "node:path"

import { ERROR_CODES } from "../../../../../api/hono/src/lib/error"

const ROOT = join(import.meta.dir, "../../../../..")

// The codes a sessions read's failure took in #1440, and the two they replaced, which a stored Inbox item may still carry for one ship.
const CODES = ["SESSIONS_FAILED", "SESSIONS_UNAVAILABLE"]
const OLD_CODES = ["CMUX_FAILED", "CMUX_UNAVAILABLE"]
// The one read of a stored item's delivery, whose alias reads an old code as its new one (ADR 0015).
const ALIAS = "api/hono/src/lib/dashboard/inbox.ts"
const DOCS = [
  ".agents/dashboard/asks.md",
  ".agents/dashboard/herdr.md",
  ".agents/dashboard/messages.md",
]

test("a sessions read that fails, or finds no herdr, has a sessions-named code, in the list's A to Z", () => {
  const codes: readonly string[] = ERROR_CODES
  for (const code of CODES) expect(codes).toContain(code)
  for (const code of OLD_CODES) expect(codes).not.toContain(code)
  expect([...codes]).toEqual([...codes].sort())
})

test("no non-test line names an old code but the alias (#1440)", () => {
  const hits = Bun.spawnSync(
    ["git", "-C", ROOT, "grep", "-n", "-E", OLD_CODES.join("|"), "--", ".", ":!tests"],
    { stdout: "pipe" },
  )
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
  const alias = new RegExp(`^${ALIAS}:\\d+:.*"SESSIONS_`)
  expect(hits.filter((hit) => !alias.test(hit))).toEqual([])
  expect(hits).toHaveLength(OLD_CODES.length)
})

test("the dashboard docs name the sessions-named code", async () => {
  for (const doc of DOCS) {
    expect(await Bun.file(join(ROOT, doc)).text(), doc).toContain("`SESSIONS_FAILED`")
  }
})
