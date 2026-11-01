import { describe, expect, test } from "bun:test"

import {
  buildReload,
  holdsText,
  holdsTyped,
  versionOf,
} from "../../../../../web/next/src/lib/build-reload"

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

describe("holdsText", () => {
  test("holds a failed message, whose bubble alone keeps its words, and nothing a reload resends", () => {
    expect(holdsText([{ state: "queued" }, { state: "failed" }])).toBe(true)
    expect(holdsText([{ state: "queued" }, { state: "sending" }, { state: "typed" }])).toBe(false)
    expect(holdsText([])).toBe(false)
  })
})

describe("holdsTyped", () => {
  const field = (text: string, extra: { atRisk?: boolean; isConnected?: boolean } = {}) => ({
    atRisk: true,
    isConnected: true,
    text,
    ...extra,
  })

  test("holds a typed field whose words live nowhere else, focused or not", () => {
    expect(holdsTyped([field("a reply left in an Inbox box")])).toBe(true)
    expect(holdsTyped([field("  "), field("x")])).toBe(true)
  })

  test("lets a field go once it is emptied or gone from the page", () => {
    expect(holdsTyped([field(" \n")])).toBe(false)
    expect(holdsTyped([field("a sent reply's card", { isConnected: false })])).toBe(false)
    expect(holdsTyped([])).toBe(false)
  })

  test("lets a field the app fills or keeps itself go, such as the preview's Address", () => {
    expect(holdsTyped([field("http://localhost:3000/docs", { atRisk: false })])).toBe(false)
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
