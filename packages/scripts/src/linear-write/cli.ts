#!/usr/bin/env -S bun --no-env-file
import { linearGql } from "../linear-gql"
import { comment, USAGE } from "./comment"

// Run under the vault skill so the key lives only in this process's environment: vault.py run -e LINEAR_API_KEY=shared.linear.api-key -- packages/scripts/src/linear-write/cli.ts comment <ID> <file>
const [command, id, file] = process.argv.slice(2)
if (command !== "comment" || !id || !file) {
  console.error(USAGE)
  process.exit(2)
}

try {
  const result = await comment(linearGql(process.env.LINEAR_API_KEY ?? ""), id, file)
  console.log(JSON.stringify(result, null, 2))
} catch (err) {
  console.error(`linear-write: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
