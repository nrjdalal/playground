import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// factory.ts and owner.ts register the two keys, by relative path, since @/ here is web/next/src
import "../../../../../packages/settings/src/factory"
import "../../../../../packages/settings/src/owner"
import { loginPath } from "../../../../../packages/settings/src/rendered"
import { readSetting, setSetting } from "../../../../../packages/settings/src/settings-folder"
import {
  namesOf,
  PRIVACY_KEYS,
  privacyFormSchema,
  privacyValues,
  privacyWrite,
} from "../../../../../web/next/src/lib/privacy"

const scratch = mkdtempSync(join(tmpdir(), "privacy-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ME = "made-up-me"

describe("Settings > Privacy", () => {
  test("names split at commas and spaces, lowercase, each once", () => {
    expect(namesOf(" Sam, samdev  sam,,")).toEqual(["sam", "samdev"])
    expect(namesOf("")).toEqual([])
  })

  test("the form takes owner/name or empty, and names its setting's schema takes", () => {
    expect(privacyFormSchema.safeParse({ archive: "made-up/vault", names: "sam" }).success).toBe(
      true,
    )
    expect(privacyFormSchema.safeParse({ archive: "", names: "" }).success).toBe(true)
    expect(privacyFormSchema.safeParse({ archive: "vault", names: "" }).success).toBe(false)
    expect(privacyFormSchema.safeParse({ archive: "", names: "sam!" }).success).toBe(false)
  })

  test("saving each field writes its setting at your login's scope, which a session then reads", () => {
    const data = join(scratch, "data")
    mkdirSync(dirname(loginPath(data)), { recursive: true })
    writeFileSync(loginPath(data), `${ME}\n`)
    const fields = privacyValues({ archive: " made-up/vault ", names: "Sam, samdev" })
    expect(fields).toEqual([
      { key: PRIVACY_KEYS.archive, value: "made-up/vault" },
      { key: PRIVACY_KEYS.names, value: ["sam", "samdev"] },
    ])
    for (const field of fields) {
      const write = privacyWrite(field.key, field.value, ME)
      expect(write.param.key).toBe(field.key)
      expect(write.json.scope).toBe(ME)
      const saved = setSetting(
        data,
        { key: write.param.key, scope: write.json.scope, value: write.json.value },
        { actor: "made-up-user-id", author: "owner", inboxRef: null, reason: write.json.reason },
      )
      expect(saved.ok).toBe(true)
      expect(readSetting(data, field.key)?.value).toEqual(field.value)
    }
  })
})
