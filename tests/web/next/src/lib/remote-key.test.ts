import { describe, expect, test } from "bun:test"

import { pairBrowser, type BrowserKey } from "../../../../../web/next/src/lib/remote-key"

// two made-up keys, each named by its own fingerprint
const KEY: BrowserKey = {
  fingerprint: "a0a2 32c2 f194 a535",
  id: "oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U",
  publicKey: {
    crv: "P-256",
    kty: "EC",
    x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
    y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  },
}
const SWAPPED = "ffff 0000 ffff 0000"

// A browser's key store in memory: what it keeps, and how many keys it made.
const store = (kept: BrowserKey | null = null) => {
  const made: BrowserKey[] = []
  return {
    made,
    make: async () => {
      kept = KEY
      made.push(KEY)
      return KEY
    },
    read: async () => kept,
  }
}

describe("pairing this browser with the Mac", () => {
  test("gives this browser's own fingerprint, once the Mac's answer names the same key", async () => {
    const keys = store()
    const sent: unknown[] = []
    const paired = await pairBrowser({
      ...keys,
      send: async (publicKey) => {
        sent.push(publicKey)
        return KEY.fingerprint
      },
    })
    expect([paired.fingerprint, sent]).toEqual([KEY.fingerprint, [KEY.publicKey]])
  })

  test("refuses a Mac that received another key, as when the hosted side swaps one in, and never shows its fingerprint as this browser's", async () => {
    const attempt = pairBrowser({ ...store(KEY), send: async () => SWAPPED })
    await expect(attempt).rejects.toThrow(
      `Your Mac received another key (${SWAPPED}, not this browser's ${KEY.fingerprint}). Approve nothing, and pair again.`,
    )
  })

  test("sends the key it keeps again, making one only while it keeps none", async () => {
    const keys = store()
    const send = async () => KEY.fingerprint
    await pairBrowser({ ...keys, send })
    await pairBrowser({ ...keys, send })
    expect(keys.made).toHaveLength(1)
  })
})
