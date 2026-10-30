import { parseArgs } from "node:util"

import type { LockStore } from "@packages/redis"

const USAGE = `Usage: bun run lock <take|renew|free> <key> <holder|value> [--ttl <ms>]

A lock kept in Redis (REDIS_URL) with a time to live, for a shell script to hold:

  take <key> <holder>   prints the lock's value and exits 0 when it was free, else prints
                        who holds it and exits 1
  renew <key> <value>   pushes its expiry out again, exit 0; exit 1 once it has lapsed
  free <key> <value>    frees it while it still holds <value>, exit 0; exit 1 when it does not

--ttl is the time to live in ms (default 60000); renew it a third of the way through.
Exit 3 means Redis did not answer or REDIS_URL is not set: keep to the script's own lock file.`

export const UNREACHABLE = 3

// Runs one lock command against the store, printing as the usage says, and returns the exit code.
export async function runLock(
  argv: string[],
  store: LockStore | null,
  print: (line: string) => void = console.log,
): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: { help: { short: "h", type: "boolean" }, ttl: { type: "string" } },
  })
  const [command, key, arg] = positionals
  const ttlMs = Number(values.ttl ?? 60_000)
  if (values.help || !key || !arg || !(ttlMs > 0) || positionals.length !== 3) {
    print(USAGE)
    return values.help ? 0 : 2
  }
  if (!store) return UNREACHABLE
  try {
    if (command === "take") {
      const taken = await store.take(key, arg, ttlMs)
      print("value" in taken ? taken.value : taken.holder)
      return "value" in taken ? 0 : 1
    }
    if (command === "renew") return (await store.renew(key, arg, ttlMs)) ? 0 : 1
    if (command === "free") return (await store.free(key, arg)) ? 0 : 1
  } catch (err) {
    if (err instanceof Error && err.name === "RedisUnreachable") return UNREACHABLE
    throw err
  }
  print(USAGE)
  return 2
}

if (import.meta.main) {
  const store = await import("@packages/redis")
    .then(({ lockStore }) => lockStore())
    .catch((err: unknown) => {
      console.error(`Redis's client did not load: ${err}`)
      return null
    })
  const code = await runLock(process.argv.slice(2), store)
  store?.close()
  process.exit(code)
}
