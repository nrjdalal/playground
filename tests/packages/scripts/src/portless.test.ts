import { describe, expect, test } from "bun:test"

import { overridesFor } from "../../../../packages/scripts/src/portless"

describe("overridesFor", () => {
  test("tells a worktree's apps their own branch-prefixed names", () => {
    for (const url of [
      "https://feat.playground.localhost",
      "https://feat.api.playground.localhost",
    ]) {
      expect(overridesFor(url)).toEqual({
        HONO_APP_URL: "https://feat.api.playground.localhost",
        HONO_TRUSTED_ORIGINS: "https://feat.playground.localhost",
        NEXT_PUBLIC_API_URL: "https://feat.api.playground.localhost",
        NEXT_PUBLIC_APP_URL: "https://feat.playground.localhost",
      })
    }
  })

  test("keeps the live dashboard's apps on their own names, and trusts the bare web origin too", () => {
    for (const url of [
      "https://desk.playground.localhost",
      "https://desk.api.playground.localhost",
    ]) {
      expect(overridesFor(url, true)).toEqual({
        HONO_APP_URL: "https://desk.api.playground.localhost",
        HONO_TRUSTED_ORIGINS: "https://desk.playground.localhost,https://playground.localhost",
        NEXT_PUBLIC_API_URL: "https://desk.api.playground.localhost",
        NEXT_PUBLIC_APP_URL: "https://desk.playground.localhost",
      })
    }
  })

  test("keeps a proxy's own port in every origin", () => {
    expect(overridesFor("https://desk.playground.localhost:8443", true).HONO_TRUSTED_ORIGINS).toBe(
      "https://desk.playground.localhost:8443,https://playground.localhost:8443",
    )
  })
})
