import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readerExit } from "../../../../../packages/scripts/src/playground/rendered"
import { storeWith } from "../../../../scripts/hooks/render-set"

const scratch = mkdtempSync(join(tmpdir(), "rendered-cli-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const exit = async (file: string | undefined, data: string) => {
  const out: string[] = []
  const err: string[] = []
  const code = await readerExit(
    file,
    { PLAYGROUND_DATA_DIR: data },
    (l) => out.push(l),
    (l) => err.push(l),
  )
  return { code, err: err.join("\n"), out: out.join("\n") }
}

test("exit 0 prints the checked file's path, 3 means no store, 2 a set it cannot trust", async () => {
  const data = storeWith(join(scratch, "data"), { "release-owners.json": "[]" })
  const ok = await exit("hooks/release-owners.json", data)
  expect(ok.code).toBe(0)
  expect(ok.out).toEndWith("extensions/hooks/release-owners.json")
  expect(await exit("hooks/release-owners.json", join(scratch, "none"))).toEqual({
    code: 3,
    err: "",
    out: "",
  })
  const refused = await exit("hooks/slack-cleared.json", data)
  expect(refused.code).toBe(2)
  expect(refused.err).toContain("holds no hooks/slack-cleared.json")
})
