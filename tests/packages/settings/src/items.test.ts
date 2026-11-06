import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { setSetting, type Who } from "../../../../packages/settings/src"
import { judgeItem, putItem, showItem } from "../../../../packages/settings/src/items"

process.env.PLAYGROUND_LOGIN = "made-up-me"
const ME = "made-up-me"

const scratch = mkdtempSync(join(tmpdir(), "items-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const OWNER: Who = { actor: "cli", author: "owner", inboxRef: null, reason: "seeded" }
const WORKER: Who = { ...OWNER, author: "made-up-worker", reason: "a new version" }
const REVIEWER: Who = { ...OWNER, author: "made-up-reviewer", reason: "judged" }
const ref = { key: "relay", kind: "script" as const, scope: ME }
const files = (version: string) => ({
  attachments: [],
  body: null,
  files: { "cli.ts": `console.log("${version}")` },
  value: null,
})

const revOf = (outcome: ReturnType<typeof putItem>) => {
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.rev
}
const shown = (rev: string) => {
  const item = showItem(scratch, ref, rev)
  return item && { files: item.content.files, state: item.state }
}

test("show --rev prints the revision's own files and state, a proposal beside an accepted copy included", () => {
  setSetting(scratch, { key: "clock.ownerZone", scope: ME, value: "Europe/Lisbon" }, OWNER)
  const v1 = revOf(putItem(scratch, ref, files("v1"), OWNER, true))
  const v2 = revOf(putItem(scratch, ref, files("v2"), WORKER, false))
  expect(shown(v1)).toEqual({ files: files("v1").files, state: "accepted" })
  expect(shown(v2)).toEqual({ files: files("v2").files, state: "proposed" })

  const scored = revOf(judgeItem(scratch, ref, v2, { kind: "score", score: 3 }, REVIEWER))
  expect(shown(scored)).toEqual({ files: files("v2").files, state: "proposed" })
  const rejected = revOf(judgeItem(scratch, ref, v2, { kind: "reject" }, REVIEWER))
  expect(shown(rejected)).toEqual({ files: files("v2").files, state: "rejected" })

  const v3 = revOf(putItem(scratch, ref, files("v3"), WORKER, false))
  expect(shown(v3)).toEqual({ files: files("v3").files, state: "proposed" })
  const accepted = revOf(judgeItem(scratch, ref, v3, { kind: "score", score: 5 }, REVIEWER))
  expect(shown(accepted)).toEqual({ files: files("v3").files, state: "accepted" })

  expect(shown(v2.slice(0, 12))).toEqual({ files: files("v2").files, state: "proposed" })
  expect(showItem(scratch, { ...ref, key: "other" }, v2)).toBeNull()
})
