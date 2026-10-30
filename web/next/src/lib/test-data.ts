import { site } from "@packages/config/site"

// The label a fixture stack wears beside the brand and in the tab's title, so its made-up machine is never mistaken for a real one (ADR 0008).
export const TEST_DATA = "Test data"

// Pure: the badge for a stack whose /api/health answered this body; none unless its dashboard reads the fixture, so a health read that fails shows none.
export const testDataBadge = (health: unknown): string | undefined => {
  const data = (health as { data?: { dashboard?: unknown } } | null)?.data
  return data?.dashboard === "fixture" ? TEST_DATA : undefined
}

// Pure: every dashboard page's tab title, the product's name alone, a fixture stack's with its Test data badge.
export const tabTitle = (badge: string | undefined): string =>
  badge ? `${badge} | ${site.name}` : site.name
