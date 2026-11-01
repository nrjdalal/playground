import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkSetting } from "@packages/settings"

import { isPublicList, LIST_KEYS, publicListPath } from "./kinds"

// Runs trace-count in CI, where no data folder holds its private inputs: each comes from a repository secret, is written into a scratch data folder, and is never printed.
const SECRETS = ["FACTORY_ARCHIVE_REPO", "NO_PUBLIC_LEAK_LIST", "OWNER_NAMES"] as const

function refuse(why: string): never {
  console.error(`trace-count ci: ${why}`)
  process.exit(2)
}

const { FACTORY_ARCHIVE_REPO, NO_PUBLIC_LEAK_LIST, OWNER_NAMES, ...env } = process.env
const secrets = { FACTORY_ARCHIVE_REPO, NO_PUBLIC_LEAK_LIST, OWNER_NAMES }
const unset = SECRETS.filter((key) => !secrets[key]?.trim())
if (unset.length)
  refuse(
    `${unset.length > 1 ? `${unset.slice(0, -1).join(", ")} and ${unset.at(-1)} are` : `${unset[0]} is`} unset, so trace-count would count nothing: set ${unset.length > 1 ? "them" : "it"} as repository secrets`,
  )

// Each refusal names the secret and the shape it needs, never the value, since the value is private.
const archive = checkSetting("factory.archiveRepo", FACTORY_ARCHIVE_REPO!.trim())
if (!archive.ok) refuse("FACTORY_ARCHIVE_REPO is not a repository's owner/name")
const names = OWNER_NAMES!
  .toLowerCase()
  .split(/[\s,]+/)
  .filter(Boolean)
const owner = checkSetting("owner.names", names)
if (!owner.ok || !names.length)
  refuse("OWNER_NAMES is not a list of lowercase names and handles, split on commas or spaces")

let list: unknown
try {
  list = JSON.parse(NO_PUBLIC_LEAK_LIST!)
} catch {
  list = null
}
if (!isPublicList(list))
  refuse("NO_PUBLIC_LEAK_LIST is not no-public-leak's list, a JSON object of string arrays")
const empty = LIST_KEYS.filter((key) => !list[key].length)
if (empty.length)
  refuse(
    `NO_PUBLIC_LEAK_LIST holds no entry under ${empty.join(", ")}, so those kinds would count nothing`,
  )

const data = mkdtempSync(join(tmpdir(), "trace-count-ci-"))
try {
  const scratch = { ...env, PLAYGROUND_DATA_DIR: data }
  await Bun.write(
    join(data, "extensions", "policy.json"),
    JSON.stringify({
      values: { "factory.archiveRepo": archive.value, "owner.names": owner.value },
    }),
  )
  await Bun.write(publicListPath(scratch), JSON.stringify(list))
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts")], {
    env: scratch,
    stdio: ["ignore", "inherit", "inherit"],
  })
  process.exitCode = await child.exited
} finally {
  rmSync(data, { force: true, recursive: true })
}
