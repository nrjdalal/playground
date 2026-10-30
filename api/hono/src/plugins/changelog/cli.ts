import { createDatabase } from "@packages/db"
import { env } from "@packages/env/db"

import { readsLive } from "@/lib/dashboard/fixture"
import { provenLocal } from "@/lib/sessions/guard"
import { runCommand, UsageError, type Deps } from "@/plugins/changelog/commands"
import { fixtureEntries } from "@/plugins/changelog/fixture"
import { github } from "@/plugins/changelog/github"
import { storeImage } from "@/plugins/changelog/images"
import seedFile from "@/plugins/changelog/seed.json"
import { seedSchema } from "@/plugins/changelog/sources"
import {
  addEntries,
  dropFixtureRows,
  dropKeys,
  keysWithImages,
  knownKeys,
  pullKeys,
} from "@/plugins/changelog/store"
import { pluginOn } from "@/plugins/switch"

// `bun run changelog`: adds rows to the Changelog from GitHub's merges and versions (sync, which ops runs every 5 minutes), a line by hand (add), or the one-time seed. It writes only to a Postgres it has proved is a container on this machine, as bun run ingest does, and nothing at all while the plugin is off.

const fail = (message: string, code = 1): never => {
  console.error(`changelog: ${message}`)
  process.exit(code)
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

if (!pluginOn("changelog")) {
  console.error("changelog: the changelog plugin is off (CHANGELOG_ENABLED); nothing written")
  process.exit(0)
}

// sync and seed read GitHub, so only a stack that reads this machine runs them (the live Dashboard, a person's own clone, or PLAYGROUND_LIVE_READS; ADR 0008), and a fixture stack's database never holds real lines; add writes only what it is given.
const command = process.argv[2]
if ((command === "sync" || command === "seed") && !readsLive()) {
  fail(
    `${command} reads GitHub only on a stack that reads this machine (the live Dashboard, your own clone, or PLAYGROUND_LIVE_READS=true); this one does not`,
  )
}

let db: ReturnType<typeof createDatabase> | null = null

// The database, proved this machine's own container before the first read or write.
async function database(): Promise<ReturnType<typeof createDatabase>> {
  if (db) return db
  try {
    await provenLocal(env.POSTGRES_URL)
  } catch (err) {
    fail(`refusing to write: ${errorText(err)}`)
  }
  db = createDatabase(env.POSTGRES_URL)
  return db
}

const deps: Deps = {
  drop: async (keys) => dropKeys(await database(), keys),
  github,
  known: async (keys) => knownKeys(await database(), keys),
  pullKeys: async () => pullKeys(await database()),
  seed: seedSchema.parse(seedFile),
  store: (bytes) => storeImage(bytes),
  withImages: async (keys) => keysWithImages(await database(), keys),
  write: async (entries, actor, options) => addEntries(await database(), entries, actor, options),
}

// A test stack's made-up rows, replaced at the current time; their drawn screenshots are served from memory (readImage). Refused on a stack that reads this machine, whose database holds only real lines.
if (command === "fixture") {
  if (readsLive()) fail("fixture writes made-up rows, so it runs only on a fixture stack")
  if (process.argv.length > 3) fail("fixture takes no arguments", 2)
  const store = await database()
  await dropFixtureRows(store)
  const { added } = await addEntries(store, fixtureEntries(), "fixture")
  console.log(`fixture: wrote ${added.length} made-up rows`)
  process.exit(0)
}

try {
  for (const line of await runCommand(process.argv.slice(2), deps)) console.log(line)
  process.exit(0)
} catch (err) {
  if (err instanceof UsageError) fail(err.message, 2)
  fail(errorText(err))
}
