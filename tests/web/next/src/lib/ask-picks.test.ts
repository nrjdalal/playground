import { afterEach, describe, expect, test } from "bun:test"

import {
  type AskPicks,
  EMPTY_PICKS,
  PICKS_KEY,
  parsePicks,
  putPicks,
  readPicks,
  savePicks,
} from "../../../../../web/next/src/lib/ask-picks"

// A questions signature, as picksKey builds it, held with the picks so a set changed under an unmounted card drops them.
const SIG = JSON.stringify([["Ship when?", ["Staging first", "After the next ship"]]])
const ID = "0b7e5f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b"
const OTHER = "1b7e5f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b"

const entry = (e: Partial<AskPicks>): AskPicks => ({ ...EMPTY_PICKS, ...e })

describe("parsePicks", () => {
  test("reads a card's single pick, a multi card's picks, the step and the Note back", () => {
    const stored = {
      [ID]: entry({ note: "soak a day", pick: 2 }),
      [OTHER]: entry({ picks: [0, null, 1], sig: SIG, step: 2 }),
    }
    expect(parsePicks(JSON.stringify(stored))).toEqual(stored)
  })

  test("a missing, broken or foreign value reads as no picks", () => {
    expect(parsePicks(null)).toEqual({})
    expect(parsePicks("{")).toEqual({})
    expect(parsePicks("[1]")).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: "picked" }))).toEqual({})
  })

  test("drops an entry a hand-edit malformed: a bad sig, note, pick, picks or step", () => {
    expect(parsePicks(JSON.stringify({ [ID]: { pick: 1, picks: [], step: 0 } }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ pick: 1, sig: 7 as never }) }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ pick: 1, note: 7 as never }) }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ pick: 1.5 }) }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ pick: -1 }) }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ picks: "0" as never, sig: SIG }) }))).toEqual(
      {},
    )
    expect(
      parsePicks(JSON.stringify({ [ID]: entry({ picks: ["0"] as never, sig: SIG }) })),
    ).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ pick: 1, step: -1 }) }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ pick: 1, step: 1.5 }) }))).toEqual({})
  })

  test("an entry with no pick and no note is dropped; a note alone keeps it", () => {
    expect(parsePicks(JSON.stringify({ [ID]: entry({}) }))).toEqual({})
    expect(parsePicks(JSON.stringify({ [ID]: entry({ picks: [null, null], sig: SIG }) }))).toEqual(
      {},
    )
    expect(parsePicks(JSON.stringify({ [ID]: entry({ note: "   " }) }))).toEqual({})
    const noted = { [ID]: entry({ note: "a comment" }) }
    expect(parsePicks(JSON.stringify(noted))).toEqual(noted)
  })
})

describe("putPicks", () => {
  test("replaces one card's answer and leaves the others", () => {
    const store = {
      [ID]: entry({ pick: 1 }),
      [OTHER]: entry({ picks: [0], sig: SIG, step: 1 }),
    }
    expect(putPicks(store, ID, entry({ note: "hold", pick: 2 }))).toEqual({
      [ID]: entry({ note: "hold", pick: 2 }),
      [OTHER]: entry({ picks: [0], sig: SIG, step: 1 }),
    })
  })

  test("an entry with no pick and no note, as a clear leaves, removes the card's", () => {
    const store = { [ID]: entry({ pick: 1 }) }
    expect(putPicks(store, ID, entry({}))).toEqual({})
  })
})

// A stand-in for the browser's localStorage, shared as one origin's tabs share it; restored after each test, with the module's cache emptied.
const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
let refuse = false
const useStorage = () => {
  const store = new Map<string, string>()
  refuse = false
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => {
        if (refuse) throw new Error("QuotaExceededError")
        store.set(key, value)
      },
    } as Storage,
  })
  return store
}

afterEach(() => {
  refuse = false
  for (const id of Object.keys(readPicks())) savePicks(id, entry({}))
  if (real) Object.defineProperty(globalThis, "localStorage", real)
  else delete (globalThis as { localStorage?: Storage }).localStorage
})

describe("savePicks", () => {
  test("writes to localStorage, keeps the answer in the tab when storage refuses, and a clear removes it", () => {
    const store = useStorage()

    savePicks(ID, entry({ note: "ok", pick: 2 }))
    expect(parsePicks(store.get(PICKS_KEY) ?? null)).toEqual({
      [ID]: entry({ note: "ok", pick: 2 }),
    })

    refuse = true
    savePicks(ID, entry({ picks: [0, 1], sig: SIG, step: 1 }))
    expect(readPicks()[ID]).toEqual(entry({ picks: [0, 1], sig: SIG, step: 1 }))

    refuse = false
    savePicks(ID, entry({}))
    expect(readPicks()).toEqual({})
    expect(store.has(PICKS_KEY)).toBe(false)
  })

  test("writes over what storage holds now, so another card's answer stays", () => {
    const store = useStorage()
    savePicks(ID, entry({ pick: 1 }))
    store.set(
      PICKS_KEY,
      JSON.stringify({
        [OTHER]: entry({ picks: [0, 1], sig: SIG, step: 1 }),
        [ID]: entry({ pick: 1 }),
      }),
    )
    savePicks(ID, entry({ pick: 0 }))
    expect(parsePicks(store.get(PICKS_KEY) ?? null)).toEqual({
      [OTHER]: entry({ picks: [0, 1], sig: SIG, step: 1 }),
      [ID]: entry({ pick: 0 }),
    })
  })
})
