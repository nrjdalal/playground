import { hostname } from "node:os"

// The name a fixture stack shows for its made-up machine, so no real Mac's name reaches a screenshot (ADR 0008).
export const FIXTURE_MACHINE = "Test Mac"

// Pure: a host name as the user menu shows it, macOS's .local suffix dropped.
export const machineName = (host: string): string =>
  host.replace(/\.local$/i, "").trim() || "This Mac"

// The Mac the user menu names, from the API's /api/health body and read on the server so the menu paints whole: a fixture stack names its made-up one, only a stack reading this machine its real name, and a health read that failed or was slow neither, since a fixture stack under load lands there too.
export const thisMachine = (health: unknown): string => {
  const dashboard = (health as { data?: { dashboard?: unknown } } | null)?.data?.dashboard
  if (dashboard === "fixture") return FIXTURE_MACHINE
  return dashboard === "live" ? machineName(hostname()) : "This Mac"
}
