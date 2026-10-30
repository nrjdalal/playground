import { describe, expect, test } from "bun:test"

import {
  firstRunView,
  gateOf,
  keptSignIn,
  markTried,
  readSetup,
  triedJustNow,
} from "../../../../../web/next/src/lib/first-run"

describe("gateOf", () => {
  test("reads 200 as setup mode, 404 as the normal app and anything else as not known", () => {
    expect(gateOf(200)).toBe("setup")
    expect(gateOf(404)).toBe("normal")
    for (const status of [undefined, 429, 500, 502]) expect(gateOf(status)).toBe("unknown")
  })
})

describe("firstRunView", () => {
  type Facts = Parameters<typeof firstRunView>[0]
  const cases: [Facts, ReturnType<typeof firstRunView>][] = [
    // nothing known yet: a neutral frame, never a card
    [{}, "frame"],
    [{ gate: "unknown" }, "frame"],
    [{ gate: "unknown", signedIn: true, done: true }, "frame"],
    // setup mode, no database: the checks once they are read
    [{ gate: "setup" }, "frame"],
    [{ gate: "setup", done: false }, "checks"],
    // the normal app, before the silent sign-in answers
    [{ gate: "normal" }, "frame"],
    [{ gate: "normal", done: false }, "frame"],
    [{ gate: "normal", done: true }, "frame"],
    // signed out once the sign-in answers that there is no owner: the checks, with Continue
    [{ gate: "normal", signedIn: false }, "frame"],
    [{ gate: "normal", signedIn: false, done: false }, "checks"],
    [{ gate: "normal", signedIn: false, done: true }, "checks"],
    // signed in: the checks until done, then the steps; Alpha's chat, once it runs, replaces them
    [{ gate: "normal", signedIn: true }, "frame"],
    [{ gate: "normal", signedIn: true, done: false }, "checks"],
    [{ gate: "normal", signedIn: true, done: true }, "steps"],
  ]

  test.each(cases)("%o shows %s", (facts, view) => {
    expect(firstRunView(facts)).toBe(view)
  })

  test("every unread fact on the way to a view draws the neutral frame", () => {
    const views = cases.filter(([facts]) => facts.gate === undefined || facts.gate === "unknown")
    expect(views.every(([, view]) => view === "frame")).toBe(true)
  })
})

describe("the tab's own sign-in", () => {
  const storage = () => {
    const items = new Map<string, string>()
    return {
      getItem: (key: string) => items.get(key) ?? null,
      removeItem: (key: string) => void items.delete(key),
      setItem: (key: string, value: string) => void items.set(key, value),
    }
  }

  test("a signed-out load within 30s of it tries no second time, and one after tries again", () => {
    const tab = storage()
    markTried(tab, 1_000)
    expect(triedJustNow(tab, 2_000)).toBe(true)
    markTried(tab, 1_000)
    expect(triedJustNow(tab, 31_000)).toBe(false)
  })

  test("a signed-in load keeps it, so signing out later shows no false cookie error", () => {
    const tab = storage()
    markTried(tab, 1_000)
    keptSignIn(tab)
    expect(triedJustNow(tab, 2_000)).toBe(false)
  })
})

describe("readSetup", () => {
  test("reads setup mode's 200, the normal app's 404, and nothing from an API that is down", async () => {
    let status = 200
    const server = Bun.serve({
      fetch: () => Response.json({ data: { status: "idle" } }, { status }),
      hostname: "127.0.0.1",
      port: 0,
    })
    const api = `http://127.0.0.1:${server.port}`
    expect(await readSetup(api)).toBe(200)
    status = 404
    expect(await readSetup(api)).toBe(404)
    await server.stop(true)
    expect(await readSetup(api)).toBeUndefined()
  })
})
