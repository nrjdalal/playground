import { describe, expect, test } from "bun:test"

import { KEEP_MS, sortKept, withClaim } from "../../../../../web/next/src/lib/draft-files"

const NOW = 1_800_000_000_000
const row = (key: string, to: string, age: number) => ({
  at: NOW - age,
  file: new File(["x"], `${key}.png`),
  key,
  to,
})

describe("sortKept", () => {
  test("keeps one session's files, oldest first, and leaves every session's past a week to drop", () => {
    const rows = [
      row("b", "dispatcher", 1000),
      row("a", "dispatcher", 2000),
      row("c", "dispatcher-2", 1000),
      row("old", "dispatcher-2", KEEP_MS),
    ]
    const { kept, stale } = sortKept(rows, "dispatcher", NOW)
    expect(kept.map((r) => r.key)).toEqual(["a", "b"])
    expect(stale).toEqual(["old"])
  })

  test("a row that does not read whole is passed over", () => {
    const { kept, stale } = sortKept(
      [null, { key: "x", to: "dispatcher" }, { ...row("y", "dispatcher", 0), file: "bytes" }],
      "dispatcher",
      NOW,
    )
    expect(kept).toEqual([])
    expect(stale).toEqual([])
  })
})

// A lock manager as one origin's tabs share it: a name held by one is not available to the next until its callback settles.
const fakeLocks = () => {
  const held = new Set<string>()
  return {
    request: (async (
      name: string,
      _options: { ifAvailable: boolean },
      callback: (lock: { name: string } | null) => Promise<boolean> | boolean,
    ) => {
      if (held.has(name)) return callback(null)
      held.add(name)
      try {
        return await callback({ name })
      } finally {
        held.delete(name)
      }
    }) as unknown as LockManager["request"],
  }
}

describe("withClaim", () => {
  test("two tabs a restart reloaded upload one kept file once: the second finds it claimed", async () => {
    const locks = fakeLocks()
    let uploads = 0
    let release = () => {}
    const first = withClaim(
      "k",
      () =>
        new Promise<void>((resolve) => {
          uploads += 1
          release = resolve
        }),
      locks,
    )
    const second = await withClaim(
      "k",
      async () => {
        uploads += 1
      },
      locks,
    )
    expect(second).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(uploads).toBe(1)
  })

  test("once the first tab is done, the file can be claimed again (a Retry)", async () => {
    const locks = fakeLocks()
    await withClaim("k", async () => {}, locks)
    expect(await withClaim("k", async () => {}, locks)).toBe(true)
  })

  test("with no Web Locks, the upload runs as is", async () => {
    let ran = false
    expect(
      await withClaim(
        "k",
        async () => {
          ran = true
        },
        null,
      ),
    ).toBe(true)
    expect(ran).toBe(true)
  })
})
