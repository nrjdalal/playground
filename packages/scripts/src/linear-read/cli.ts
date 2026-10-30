#!/usr/bin/env -S bun --no-env-file
import { linearGql } from "../linear-gql"
import { read, USAGE } from "./read"

// Run under the vault skill so the key lives only in this process's environment: vault.py run -e LINEAR_API_KEY=shared.linear.api-key -- packages/scripts/src/linear-read/cli.ts <command> <arg>
const [command, ...words] = process.argv.slice(2)
if (!command || !words.length) {
  console.error(USAGE)
  process.exit(2)
}

try {
  const data = await read(linearGql(process.env.LINEAR_API_KEY ?? ""), command, words.join(" "))
  console.log(JSON.stringify(data, null, 2))
} catch (err) {
  console.error(`linear-read: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
