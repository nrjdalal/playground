import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { downloadAsset, readRelease } from "../../../../../../api/hono/src/plugins/changelog/github"

const path = process.env.PATH
let bin = ""

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "gh-timeout-"))
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexec sleep 30\n")
  chmodSync(join(bin, "gh"), 0o755)
  process.env.PATH = `${bin}:${path}`
})

afterEach(() => {
  process.env.PATH = path
  rmSync(bin, { force: true, recursive: true })
})

// Shortens only the 30s gh timer, so the real run() path times out.
async function timeoutMessage(read: () => Promise<unknown>): Promise<string> {
  const real = globalThis.setTimeout
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: () => void,
    ms?: number,
  ) => real(fn, ms === 30_000 ? 20 : ms)) as typeof setTimeout)
  try {
    const error = await read().catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    return (error as Error).message
  } finally {
    timers.mockRestore()
  }
}

test("a gh read that runs past its time names the command", async () => {
  expect(await timeoutMessage(() => readRelease("v1.2.3"))).toBe(
    "gh release view v1.2.3 ran past 30000ms",
  )
})

test("the gh token read that runs past its time names the command", async () => {
  const asset = "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000"
  expect(await timeoutMessage(() => downloadAsset(asset))).toBe("gh auth token ran past 30000ms")
})
