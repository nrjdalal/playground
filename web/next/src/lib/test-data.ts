import { site } from "@packages/config/site"

// The label a fixture stack wears beside the brand and in the tab's title, so its made-up machine is never mistaken for a real one (ADR 0008).
export const TEST_DATA = "Test data"

// Pure: the badge for a stack whose /api/health answered this body; none unless its dashboard reads the fixture, so a health read that fails shows none.
export const testDataBadge = (health: unknown): string | undefined => {
  const data = (health as { data?: { dashboard?: unknown } } | null)?.data
  return data?.dashboard === "fixture" ? TEST_DATA : undefined
}

// The label a Vibeground wears, its branch beside the name, so its real data on a branch is never mistaken for the live dashboard (asks.md's Preview).
export const vibeLabel = (branch: string): string => `Vibeground · ${branch}`

// Pure: the badge for a stack whose /api/health names the branch it runs as a Vibeground; none for any other stack or a failed read.
export const vibeBadge = (health: unknown): string | undefined => {
  const vibe = (health as { data?: { vibe?: unknown } } | null)?.data?.vibe
  return typeof vibe === "string" && vibe ? vibeLabel(vibe) : undefined
}

// Pure: every dashboard page's tab title, the product's name alone, a fixture stack's or a Vibeground's with its badge.
export const tabTitle = (badge: string | undefined): string =>
  badge ? `${badge} | ${site.name}` : site.name
