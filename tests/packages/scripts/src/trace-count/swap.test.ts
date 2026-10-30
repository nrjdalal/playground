import { describe, expect, test } from "bun:test"

import { count } from "../../../../../packages/scripts/src/trace-count/count"
import { swapper, swapTree } from "../../../../../packages/scripts/src/trace-count/swap"

// Made-up values standing for the hand-made list, two per key where order matters.
const LIST = {
  companies: ["Vantorix", "Vantorix Labs"],
  handles: ["qmarsh", "tbell"],
  linearKeys: ["VX", "OPS"],
  names: ["Quilla", "Marsh", "Tobin"],
  slackIds: ["U0FAKE1234", "C0FAKE9876"],
}
const REPOS = { archive: "octo/archive", owner: ["octo"], public: "qmarsh/playground" }
const { swap } = swapper(LIST, REPOS)

describe("the swap pass", () => {
  test("each value takes the stand-in its position makes, in the found text's case", () => {
    expect(swap("Quilla Marsh and Tobin; quilla; MARSH").text).toBe(
      "Avery Blair and Corin; avery; BLAIR",
    )
    expect(swap("@qmarsh and tbell").text).toBe("@octo-avery and octo-blair")
    expect(swap("in U0FAKE1234 and C0FAKE9876").text).toBe("in U0MADEUP01 and C0MADEUP02")
    expect(swap("VX-12, ops-7 and OPS-").text).toBe("BRAVO-12, acme-7 and OPS-")
    expect(swap("Vantorix Labs ships vantorix, VANTORIX").text).toBe("Acme ships acme, ACME")
  })

  test("the same text always swaps the same way, and a swapped text counts no list value", () => {
    const text = "Quilla (qmarsh) at Vantorix asked in U0FAKE1234 about VX-3"
    expect(swap(text)).toEqual(swap(text))
    expect(swap(text).counts).toEqual({
      companies: 1,
      handles: 1,
      linearKeys: 1,
      names: 1,
      slackIds: 1,
    })
    const counted = count([{ path: "tests/a.ts", text: swap(text).text }], LIST, REPOS)
    expect([
      counted.companies,
      counted.handles,
      counted.linearKeys,
      counted.names,
      counted.slackIds,
    ]).toEqual([0, 0, 0, 0, 0])
  })

  test("each Linear team takes its own made-up team, so keys stay distinct and sort as before", () => {
    const keys = ["VX-2", "OPS-2", "VX-1", "OPS-10"]
    const swapped = keys.map((key) => swap(key).text)
    expect(swapped).toEqual(["BRAVO-2", "ACME-2", "BRAVO-1", "ACME-10"])
    expect(new Set(swapped).size).toBe(keys.length)
    const order = (list: string[]) =>
      list.map((_, i) => i).sort((a, b) => list[a]!.localeCompare(list[b]!))
    expect(order(swapped)).toEqual(order(keys))
  })

  test("no stand-in matches a list entry, the teams' included, or the pass refuses to run", () => {
    expect(() => swapper(LIST, REPOS)).not.toThrow()
    expect(() => swapper({ ...LIST, linearKeys: ["VX", "OPS", "BRAVO"] }, REPOS)).toThrow(
      "a stand-in matches the list's linearKeys",
    )
  })

  test("a value inside a longer word, and the public repository, stay", () => {
    expect(swap("Quillan, tbells, qmarsh/playground").text).toBe(
      "Quillan, tbells, qmarsh/playground",
    )
  })

  test("only the tests, the API's fixtures and the replay fixtures are swapped", () => {
    const files = [
      "tests/web/a.test.ts",
      "api/hono/src/fixtures/dashboard.json",
      "packages/scripts/src/parity/replay/fixtures/scan/run.jsonl",
      "tests/fixture/bun.lock",
      "api/hono/src/routers/apps.ts",
      "skills/x/SKILL.md",
    ].map((path) => ({ path, text: "Tobin" }))
    expect(swapTree(files, LIST, REPOS).map(({ path }) => path)).toEqual(
      files.slice(0, 3).map(({ path }) => path),
    )
  })

  test("a stand-in the list itself holds is refused, naming its kind alone", () => {
    expect(() => swapper({ ...LIST, names: ["Avery"] }, REPOS)).toThrow(
      "a stand-in matches the list's names",
    )
  })
})
