import { RouteStore } from "portless"

import { readsLive } from "@/lib/dashboard/fixture"
import { portlessDir } from "@/lib/dev/proxy"

// A web stack portless serves on this machine, by its name (its host's first label), for the Inbox's Preview row.
export type Stack = { name: string; url: string }

type Route = { hostname?: unknown; pid?: unknown }

// Pure: each web host with a process behind it, A to Z: an API host (an `api` label), an alias (pid 0, as portless writes one) and a bare app host (the live dashboard's second name) left out.
export function webStacks(routes: unknown): Stack[] {
  if (!Array.isArray(routes)) return []
  return (routes as Route[])
    .flatMap(({ hostname, pid }) => {
      if (typeof hostname !== "string" || typeof pid !== "number" || pid <= 0) return []
      const labels = hostname.split(".")
      if (labels.length < 3 || labels.at(-1) !== "localhost" || labels.includes("api")) return []
      return [{ name: labels[0] ?? "", url: `https://${hostname}` }]
    })
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

// The machine's stacks through portless's own store, which drops a route whose process has gone; a fixture stack lists none, since it reads no machine.
export function readStacks(): Stack[] {
  if (!readsLive()) return []
  try {
    return webStacks(new RouteStore(portlessDir()).loadRoutes())
  } catch {
    return []
  }
}
