import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { freshName, usedNames } from "../../../../../packages/scripts/src/name/pick"

// Each case reads its own Claude config folder, so the roster, the registry and the pins it checks are the stubs the case wrote.
const configs: string[] = []
const config = (
  files: { backends?: string[]; roster?: string; sessions?: Record<string, string> } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "name-config-"))
  configs.push(dir)
  const data = join(dir, "playground")
  mkdirSync(data, { recursive: true })
  mkdirSync(join(dir, "sessions"), { recursive: true })
  if (files.backends) {
    mkdirSync(join(data, "backends"), { recursive: true })
    for (const name of files.backends) writeFileSync(join(data, "backends", name), "")
  }
  if (files.roster) writeFileSync(join(data, "roster.json"), files.roster)
  for (const [file, name] of Object.entries(files.sessions ?? {})) {
    writeFileSync(join(dir, "sessions", file), JSON.stringify({ sessionId: file, name }))
  }
  return dir
}
afterAll(() => {
  for (const dir of configs) rmSync(dir, { force: true, recursive: true })
})
// ids handed out in turn, so a case says which are held
const ids = (...list: string[]) => {
  let next = 0
  return () => list[next++] ?? "zzzzzz"
}

describe("a new id", () => {
  test("skips an id any held name starts with, whatever kind followed it", () => {
    const used = ["k3m9px-reviewer", "b7k2mq-worker"]
    expect(freshName("worker", used, ids("k3m9px", "b7k2mq", "h4n8zt"))).toBe("h4n8zt-worker")
  })

  test("an id that only appears inside a held name is free", () => {
    expect(freshName("tester", ["worker-k3m9px"], ids("k3m9px"))).toBe("k3m9px-tester")
  })

  test("gives none after five held ids in a row", () => {
    const held = ["aaaaaa", "bbbbbb", "cccccc", "dddddd", "ffffff"]
    const used = held.map((id) => `${id}-worker`)
    expect(freshName("worker", used, ids(...held, "gggggg"))).toBeNull()
  })

  test("reads the roster, ended entries included, the registry and the pins", async () => {
    const dir = config({
      backends: ["p9c3wx-tester"],
      roster: JSON.stringify({
        agents: [null, 7, { name: 5 }, { name: "k3m9px-reviewer", status: "ended" }],
      }),
      sessions: { "40123.json": "b7k2mq-worker" },
    })
    // made-up JSON under a .key name, so only the .json filter keeps it out
    writeFileSync(join(dir, "sessions", "40125.key"), JSON.stringify({ name: "r6t2dv-tester" }))
    writeFileSync(join(dir, "sessions", "40124.json"), JSON.stringify({ name: 5 }))
    expect((await usedNames(dir, join(dir, "playground"))).toSorted()).toEqual([
      "b7k2mq-worker",
      "k3m9px-reviewer",
      "p9c3wx-tester",
    ])
  })

  test("a config with nothing in it holds no names", async () => {
    const nowhere = join(config(), "nowhere")
    expect(await usedNames(nowhere, nowhere)).toEqual([])
  })
})
