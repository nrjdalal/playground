import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// factory.ts and owner.ts register the two keys, by relative path, since @/ here is web/next/src
import "../../../../../packages/settings/src/factory"
import "../../../../../packages/settings/src/owner"
import {
  extensionsDir,
  loginPath,
  readPolicySync,
} from "../../../../../packages/settings/src/rendered"
import { readSetting, setSetting } from "../../../../../packages/settings/src/settings-folder"
import {
  namesOf,
  PRIVACY_KEYS,
  privacyFormSchema,
  privacyValues,
  privacyWrite,
  privacyWrites,
} from "../../../../../web/next/src/lib/privacy"

const scratch = mkdtempSync(join(tmpdir(), "privacy-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ME = "made-up-me"
const WHO = { actor: "made-up-user-id", author: "owner", inboxRef: null, reason: "test" }

// A data folder whose extensions have your login, as Set up settings leaves it.
const setUp = (name: string) => {
  const data = join(scratch, name)
  mkdirSync(dirname(loginPath(data)), { recursive: true })
  writeFileSync(loginPath(data), `${ME}\n`)
  return data
}

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
    const data = setUp("data")
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
        { ...WHO, reason: write.json.reason },
      )
      expect(saved.ok).toBe(true)
      expect(readSetting(data, field.key)?.value).toEqual(field.value)
    }
  })

  test("a Save writes each field that holds a value and each you cleared, and an empty form writes nothing", () => {
    const saved = { archive: "made-up/vault", names: "sam" }
    expect(privacyWrites(saved, saved).map((field) => field.key)).toEqual([
      PRIVACY_KEYS.archive,
      PRIVACY_KEYS.names,
    ])
    expect(privacyWrites(saved, { archive: "", names: "sam" })).toEqual([
      { key: PRIVACY_KEYS.archive, value: "" },
      { key: PRIVACY_KEYS.names, value: ["sam"] },
    ])
    expect(privacyWrites({ archive: "", names: "" }, { archive: "", names: "" })).toEqual([])
  })

  test("a Save with nothing changed rebuilds a policy.json that does not parse, as the guards' refusal says", () => {
    const data = setUp("broken")
    const saved = { archive: "made-up/vault", names: "sam" }
    for (const field of privacyValues(saved))
      expect(setSetting(data, { key: field.key, scope: ME, value: field.value }, WHO).ok).toBe(true)
    writeFileSync(join(extensionsDir(data), "policy.json"), "{ not json")
    const broken = readPolicySync(data)
    expect("refusal" in broken ? broken.refusal : "").toContain(
      "Privacy on the Dashboard's Settings page",
    )
    for (const field of privacyWrites(saved, saved))
      expect(setSetting(data, { key: field.key, scope: ME, value: field.value }, WHO).ok).toBe(true)
    expect(readPolicySync(data)).toEqual({
      settings: {
        schemaVersion: 1,
        values: { "factory.archiveRepo": "made-up/vault", "owner.names": ["sam"] },
      },
    })
  })
})
