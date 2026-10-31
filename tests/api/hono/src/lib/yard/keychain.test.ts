import { describe, expect, test } from "bun:test"

import {
  KEYCHAIN_SERVICE,
  keychain,
  type Run,
} from "../../../../../../api/hono/src/lib/yard/keychain"

// A fake `security`, so no test reaches the real Keychain.
const fake = (answer: { code: number; stdout?: string }) => {
  const calls: string[][] = []
  const run: Run = async (argv) => {
    calls.push(argv)
    return { code: answer.code, stderr: "", stdout: answer.stdout ?? "" }
  }
  return { calls, store: keychain(run, "owner") }
}

describe("the Mac's Yard token in the Keychain", () => {
  test("is read as the signed-in user's generic password under one service", async () => {
    const { calls, store } = fake({ code: 0, stdout: "yard_abc\n" })
    expect(await store.read()).toBe("yard_abc")
    expect(calls).toEqual([
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", "owner", "-w"],
    ])
  })

  test("reads as none when the item is missing or holds no Yard token", async () => {
    expect(await fake({ code: 44 }).store.read()).toBeNull()
    expect(await fake({ code: 0, stdout: "hunter2" }).store.read()).toBeNull()
  })

  test("writes a Yard token in place, and refuses anything else", async () => {
    const { calls, store } = fake({ code: 0 })
    await store.write("yard_new")
    expect(calls[0]).toEqual([
      "security",
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      "owner",
      "-w",
      "yard_new",
    ])
    expect(store.write("not a token")).rejects.toThrow("starts yard_")
  })
})
