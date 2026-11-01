import { describe, expect, test } from "bun:test"

import {
  KEYCHAIN_SERVICE,
  keychain,
  type Run,
} from "../../../../../../api/hono/src/lib/yard/keychain"

// A fake `security`, so no test reaches the real Keychain.
const fake = (answer: { code: number; stdout?: string }) => {
  const calls: string[][] = []
  const inputs: (string | undefined)[] = []
  const run: Run = async (argv, input) => {
    calls.push(argv)
    inputs.push(input)
    return { code: answer.code, stderr: "", stdout: answer.stdout ?? "" }
  }
  return { calls, inputs, store: keychain(run, "owner") }
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

  test("writes a Yard token in place through stdin, never in an argv, and refuses anything else", async () => {
    const { calls, inputs, store } = fake({ code: 0 })
    await store.write("yard_new-Token_1")
    expect(calls).toEqual([["security", "-i"]])
    expect(inputs).toEqual([
      `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "owner" -w "yard_new-Token_1"\n`,
    ])
    await expect(store.write("not a token")).rejects.toThrow("starts yard_")
    await expect(store.write('yard_a" -w "x')).rejects.toThrow("starts yard_")
  })
})
