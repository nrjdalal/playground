import { moveRoute } from "@/lib/dev/launch"

// Points the live dashboard's web route (its URL, $1) at a port ($2) under an owner pid ($3), for ops-dashboard's supervisor, which starts each web on a port of its own; it exits 1 with the reason when the route is another live process's.
const [url, port, owner] = process.argv.slice(2)
try {
  if (!url || !port || !owner) throw new Error("usage: web-route.ts <web url> <port> <owner pid>")
  moveRoute(new URL(url).hostname, Number(port), Number(owner))
} catch (err) {
  console.error(`web-route: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
