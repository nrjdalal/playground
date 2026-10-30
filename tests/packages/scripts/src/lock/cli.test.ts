import { describe, expect, test } from "bun:test"

import type { LockStore } from "../../../../../packages/redis/src/index"
import { runLock, UNREACHABLE } from "../../../../../packages/scripts/src/lock/cli"

// A store with one key, held by 112, that answers or is unreachable.
const store = (down = false): LockStore => {
  const reach = () => {
    if (down) throw Object.assign(new Error("connection refused"), { name: "RedisUnreachable" })
  }
  let value: string | null = null
  return {
    close: () => {},
    free: async (_key, given) => {
      reach()
      const was = value === given
      if (was) value = null
      return was
    },
    renew: async (_key, given) => {
      reach()
      return value === given
    },
    take: async (_key, holder) => {
      reach()
      if (value) return { holder: value.split(" ")[1] ?? "" }
      value = `token ${holder}`
      return { value }
    },
  }
}

const run = async (argv: string[], at: LockStore | null) => {
  const lines: string[] = []
  const code = await runLock(argv, at, (line) => lines.push(line))
  return { code, lines }
}

describe("bun run lock", () => {
  test("take prints the value and exits 0, then a second take prints the holder and exits 1", async () => {
    const at = store()
    expect(await run(["take", "slot", "112"], at)).toEqual({ code: 0, lines: ["token 112"] })
    expect(await run(["take", "slot", "150"], at)).toEqual({ code: 1, lines: ["112"] })
  })

  test("renew and free hold to the value that took the lock", async () => {
    const at = store()
    await run(["take", "slot", "112"], at)
    expect((await run(["renew", "slot", "token 150"], at)).code).toBe(1)
    expect((await run(["renew", "slot", "token 112", "--ttl", "500"], at)).code).toBe(0)
    expect((await run(["free", "slot", "token 150"], at)).code).toBe(1)
    expect((await run(["free", "slot", "token 112"], at)).code).toBe(0)
    expect((await run(["take", "slot", "150"], at)).code).toBe(0)
  })

  test("no store, or one that does not answer, exits 3 so the script keeps its own lock file", async () => {
    expect((await run(["take", "slot", "112"], null)).code).toBe(UNREACHABLE)
    for (const command of ["take", "renew", "free"])
      expect((await run([command, "slot", "112"], store(true))).code).toBe(UNREACHABLE)
  })

  test("a malformed call prints the usage and exits 2", async () => {
    for (const argv of [
      [],
      ["take", "slot"],
      ["grab", "slot", "112"],
      ["take", "slot", "112", "--ttl", "0"],
    ]) {
      const { code, lines } = await run(argv, store())
      expect(code).toBe(2)
      expect(lines[0]).toStartWith("Usage: bun run lock")
    }
  })
})
