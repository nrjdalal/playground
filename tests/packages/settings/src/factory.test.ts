import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkSetting,
  factorySettings,
  extensionsDir,
  readPolicy,
  writeRoot,
} from "../../../../packages/settings/src"

const scratch = mkdtempSync(join(tmpdir(), "factory-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const render = (name: string, policy: unknown): string => {
  const files = new Map([["policy.json", JSON.stringify(policy)]])
  writeRoot(extensionsDir(join(scratch, name)), files)
  return join(scratch, name)
}

test("a machine with no store reads each repo key unset, so no default names a repository", async () => {
  const read = await readPolicy(join(scratch, "none"))
  if (!read.settings) throw new Error(read.refusal)
  expect(factorySettings.get(read.settings, "factory.repo")).toBe("")
  expect(factorySettings.get(read.settings, "factory.publicRepo")).toBe("")
  expect(factorySettings.get(read.settings, "factory.archiveRepo")).toBe("")
})

test("a rendered policy.json sets a key, and an org's session reads its org's value over it", async () => {
  const data = render("set", {
    orgs: { acme: { "factory.repo": "acme/factory" } },
    schemaVersion: 1,
    values: { "factory.repo": "owner/factory" },
  })
  const plain = await readPolicy(data)
  const org = await readPolicy(data, "acme")
  if (!plain.settings || !org.settings) throw new Error("refused")
  expect(factorySettings.get(plain.settings, "factory.repo")).toBe("owner/factory")
  expect(factorySettings.get(org.settings, "factory.repo")).toBe("acme/factory")
  expect(factorySettings.get(org.settings, "factory.publicRepo")).toBe("")
})

test("a policy.json that does not parse is a refusal, never the defaults", async () => {
  const data = render("bad", { schemaVersion: 1, values: {} })
  await Bun.write(join(extensionsDir(data), "policy.json"), "{")
  expect((await readPolicy(data)).refusal).toContain("does not parse")
})

test("a repo key takes owner/name, or empty for unset", () => {
  expect(checkSetting("factory.repo", "acme/factory").ok).toBe(true)
  expect(checkSetting("factory.repo", "").ok).toBe(true)
  expect(checkSetting("factory.repo", "factory").ok).toBe(false)
  expect(checkSetting("factory.archiveRepo", "acme/a b").ok).toBe(false)
})
