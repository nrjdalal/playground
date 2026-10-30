import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { livePair } from "../../../../../../api/hono/src/lib/dev/live-dashboard"

const dir = mkdtempSync(join(tmpdir(), "live-dashboard-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const DEFAULTS = { branch: "live/dashboard", database: "playground-dashboard-db" }

// The Dashboard's stack reads the live pair as it starts, before any setting has written policy.json, as when ext init stopped after making the extensions root.
describe("livePair before a first setting", () => {
  test("a data folder with no extensions root reads the default pair", () => {
    expect(livePair({ PLAYGROUND_DATA_DIR: join(dir, "no-root") })).toEqual(DEFAULTS)
  })

  test("an extensions root with no policy.json reads the default pair", () => {
    const data = join(dir, "root-only")
    mkdirSync(join(data, "extensions"), { recursive: true })
    expect(livePair({ PLAYGROUND_DATA_DIR: data })).toEqual(DEFAULTS)
  })

  test("a policy.json that does not parse is still refused", () => {
    const data = join(dir, "bad-policy")
    mkdirSync(join(data, "extensions"), { recursive: true })
    writeFileSync(join(data, "extensions", "policy.json"), "{")
    expect(() => livePair({ PLAYGROUND_DATA_DIR: data })).toThrow("does not parse")
  })
})
