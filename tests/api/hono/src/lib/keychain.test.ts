import { describe, expect, test } from "bun:test"

import { keychainItem, type Run } from "../../../../../api/hono/src/lib/keychain"
import {
  KEYCHAIN_ITEMS,
  type KeychainItemName,
} from "../../../../../api/hono/src/lib/keychain-items"

// A fake `security`, so no test reaches the real Keychain.
const fake = (answer: { code: number; stderr?: string }, name: KeychainItemName = "yard") => {
  const calls: { argv: string[]; input?: string }[] = []
  const run: Run = async (argv, input) => {
    calls.push({ argv, input })
    return { code: answer.code, stderr: answer.stderr ?? "", stdout: "" }
  }
  return { calls, item: keychainItem(name, { account: "owner", run }) }
}

describe("an allowlisted Keychain item", () => {
  test("the allowlist holds slack and yard", () => {
    expect(Object.keys(KEYCHAIN_ITEMS)).toEqual(["slack", "yard"])
  })

  test("slack takes a Slack user token, xoxp-, under playground-slack, and refuses any other", async () => {
    const { calls, item } = fake({ code: 0 }, "slack")
    for (const value of ["xoxb-made-up", "yard_made-up", "xoxp-a\nb"])
      await expect(item.write(value)).rejects.toThrow("a Slack user token starts xoxp-")
    await item.write("xoxp-made-up-0000")
    expect(calls).toEqual([
      {
        argv: ["security", "-i"],
        input: 'add-generic-password -U -s "playground-slack" -a "owner" -w "xoxp-made-up-0000"\n',
      },
    ])
  })

  test("writes the value on stdin alone, never in an argv", async () => {
    const { calls, item } = fake({ code: 0 })
    await item.write("yard_made-up")
    expect(calls).toEqual([
      {
        argv: ["security", "-i"],
        input: 'add-generic-password -U -s "playground-yard" -a "owner" -w "yard_made-up"\n',
      },
    ])
  })

  test("refuses a value off its shape, or one holding a quote, a backslash or a line break", async () => {
    const { calls, item } = fake({ code: 0 })
    for (const value of ["nope", 'yard_a" -w "x', "yard_a\\b", "yard_a\nb"])
      await expect(item.write(value)).rejects.toThrow("a Yard token starts yard_")
    expect(calls).toEqual([])
  })

  test("names a refusal by its first line, with the value cut out", async () => {
    const { item } = fake({ code: 1, stderr: "security: could not add yard_made-up\nmore" })
    await expect(item.write("yard_made-up")).rejects.toThrow(
      "the Keychain refused it: security: could not add …",
    )
  })
})
