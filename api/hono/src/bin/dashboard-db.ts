import { locate } from "@/lib/sessions/guard"

// Prints the name of the dashboard's database container: the one running container that publishes the port of POSTGRES_URL (from the .env of the folder it runs in) on loopback alone, the rule bun run ingest proves before its first write. ops-dashboard's supervisor reads it, so the dashboard's database runs under any name; it exits 1 with the reason when no container passes.
try {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is not set")
  console.log(locate(process.env.POSTGRES_URL).owner.name)
} catch (err) {
  console.error(`dashboard-db: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
