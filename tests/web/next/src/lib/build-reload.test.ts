import { describe, expect, test } from "bun:test"

import { buildReload, versionOf } from "../../../../../web/next/src/lib/build-reload"

const at = (current: string | null, extra: Partial<Parameters<typeof buildReload>[0]> = {}) =>
  buildReload({ busy: false, current, loaded: "0.0.1-aaaaaaa", reloadedFor: null, ...extra })

describe("buildReload", () => {
  test("reloads once the API names a version other than the one the page loaded against", () => {
    expect(at("0.0.1-bbbbbbb")).toBe("reload")
  })

  test("stays on the version it loaded, and on a read that failed", () => {
    expect(at("0.0.1-aaaaaaa")).toBe("stay")
    expect(at(null)).toBe("stay")
    expect(at("0.0.1-bbbbbbb", { loaded: null })).toBe("stay")
  })

  test("never reloads twice for one version, so a version that keeps differing never loops", () => {
    expect(at("0.0.1-bbbbbbb", { reloadedFor: "0.0.1-bbbbbbb" })).toBe("stay")
    expect(at("0.0.1-ccccccc", { reloadedFor: "0.0.1-bbbbbbb" })).toBe("reload")
  })

  test("waits while the owner types in a field, so no text is lost", () => {
    expect(at("0.0.1-bbbbbbb", { busy: true })).toBe("wait")
  })
})

describe("versionOf", () => {
  test("reads /api/health's version, and nothing from any other body", () => {
    expect(versionOf({ data: { message: "ok", version: "0.0.1-bbbbbbb" } })).toBe("0.0.1-bbbbbbb")
    expect(versionOf({ data: { version: "" } })).toBeNull()
    expect(versionOf({ data: { version: 7 } })).toBeNull()
    expect(versionOf(undefined)).toBeNull()
  })
})
