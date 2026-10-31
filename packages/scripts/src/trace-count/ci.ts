import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isPublicList } from "./kinds"

// Runs trace-count in CI, where no data folder holds its private inputs: each comes from a repository secret, is written into a scratch data folder, and is never printed.
const SECRETS = ["FACTORY_ARCHIVE_REPO", "NO_PUBLIC_LEAK_LIST", "OWNER_NAMES"] as const

const refuse = (why: string): never => {
  console.error(`trace-count ci: ${why}`)
  process.exit(2)
}

const env = process.env
const unset = SECRETS.filter((key) => !env[key]?.trim())
if (unset.length)
  refuse(
    `${unset.length > 1 ? `${unset.slice(0, -1).join(", ")} and ${unset.at(-1)} are` : `${unset[0]} is`} unset, so trace-count would count nothing: set ${unset.length > 1 ? "them" : "it"} as repository secrets`,
  )

let list: unknown
try {
  list = JSON.parse(env.NO_PUBLIC_LEAK_LIST!)
} catch {
  list = null
}
if (!isPublicList(list))
  refuse("NO_PUBLIC_LEAK_LIST is not no-public-leak's list, a JSON object of string arrays")

const data = mkdtempSync(join(tmpdir(), "trace-count-ci-"))
try {
  await Bun.write(
    join(data, "extensions", "policy.json"),
    JSON.stringify({
      values: {
        "factory.archiveRepo": env.FACTORY_ARCHIVE_REPO!.trim(),
        "owner.names": env
          .OWNER_NAMES!.toLowerCase()
          .split(/[\s,]+/)
          .filter(Boolean),
      },
    }),
  )
  await Bun.write(join(data, "extensions", "hooks", "no-public-leak.json"), JSON.stringify(list))
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts")], {
    env: { ...env, PLAYGROUND_DATA_DIR: data },
    stdio: ["ignore", "inherit", "inherit"],
  })
  process.exitCode = await child.exited
} finally {
  rmSync(data, { force: true, recursive: true })
}
