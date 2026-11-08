import { compactIdle } from "@/lib/dashboard/idle-compact"

// `bun run idle-compact [--dry]`: one pass of the idle-compaction trial (api/hono/src/lib/dashboard/idle-compact.ts), which ops-tick's idle-compact beat runs every 5 minutes; prints one line a session it compacted, or would with --dry.
const args = process.argv.slice(2)
if (args.some((arg) => arg !== "--dry")) {
  console.error("usage: bun run idle-compact [--dry]")
  process.exit(2)
}
for (const line of await compactIdle({ dry: args.includes("--dry") })) console.log(line)
process.exit(0)
