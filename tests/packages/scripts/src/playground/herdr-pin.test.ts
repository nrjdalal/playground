import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkHerdr, pinHerdr } from "../../../../../packages/scripts/src/playground/herdr-pin"

const PIN = join(import.meta.dir, "../../../../../packages/scripts/src/playground/herdr-pin.ts")
const scratch = mkdtempSync(join(tmpdir(), "playground-herdr-pin-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const FAKE = new TextEncoder().encode("#!/bin/sh\necho herdr 0.9.5\n")
const FAKE_SUM = "c3b7d8b7f0e1e2d8b5a7b6d0f9e3f4c0a6b1f0b7c8a1c1f8e0d0d4c8b2d4e2a1"
const sumOf = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
const REAL_SUM = sumOf(FAKE)

let n = 0
const binPath = () => join(scratch, `case-${++n}`, "bin", "herdr")

const pin = (path: string, sha256: string, download: () => Promise<Uint8Array>) =>
  pinHerdr({ asset: "darwin-arm64", download, path, sha256, version: "0.9.5" })

describe("pinHerdr", () => {
  test("puts a download with the pinned sum at the path, runnable", async () => {
    const path = binPath()
    expect(await pin(path, REAL_SUM, async () => FAKE)).toEqual({
      code: 0,
      line: `herdr 0.9.5 pinned at ${path}`,
    })
    expect(sumOf(new Uint8Array(await Bun.file(path).arrayBuffer()))).toBe(REAL_SUM)
    expect(statSync(path).mode & 0o777).toBe(0o755)
  })

  test("leaves a copy that already holds the pinned sum, with no download", async () => {
    const path = binPath()
    await pin(path, REAL_SUM, async () => FAKE)
    let downloads = 0
    const again = await pin(path, REAL_SUM, async () => {
      downloads++
      return FAKE
    })
    expect(again).toEqual({ code: 0, line: `herdr 0.9.5 already pinned at ${path}` })
    expect(downloads).toBe(0)
  })

  test("refuses a download whose sum is not the pin's, naming both, and moves nothing", async () => {
    const path = binPath()
    expect(await pin(path, FAKE_SUM, async () => FAKE)).toEqual({
      code: 2,
      line: `herdr-pin: darwin-arm64 0.9.5 has sha256 ${REAL_SUM}, not the pinned ${FAKE_SUM}; nothing was installed`,
    })
    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(path, ".."))).toBe(false)
  })

  test("puts the pin back over a changed copy", async () => {
    const path = binPath()
    mkdirSync(join(path, ".."), { recursive: true })
    await Bun.write(path, "a herdr someone updated")
    expect((await pin(path, REAL_SUM, async () => FAKE)).code).toBe(0)
    expect(sumOf(new Uint8Array(await Bun.file(path).arrayBuffer()))).toBe(REAL_SUM)
    expect(readdirSync(join(path, ".."))).toEqual(["herdr"])
  })

  test("names a download that fails, and installs nothing", async () => {
    const path = binPath()
    const failed = await pin(path, REAL_SUM, async () => {
      throw new Error("https://example.invalid/herdr-macos-aarch64 answered 404")
    })
    expect(failed).toEqual({
      code: 4,
      line: "herdr-pin: https://example.invalid/herdr-macos-aarch64 answered 404",
    })
    expect(existsSync(path)).toBe(false)
  })

  test("installs nothing on a machine with no pinned asset", async () => {
    const path = binPath()
    const result = await pinHerdr({
      asset: null,
      download: async () => FAKE,
      path,
      sha256: "",
      version: "0.9.5",
    })
    expect(result.code).toBe(3)
    expect(result.line).toContain("macOS on arm64 or x64")
    expect(existsSync(path)).toBe(false)
  })
})

describe("checkHerdr", () => {
  test("reads ok when the path holds the pinned sum", async () => {
    const path = binPath()
    await pin(path, REAL_SUM, async () => FAKE)
    expect(checkHerdr(path, REAL_SUM)).toEqual({ code: 0, line: `herdr pinned at ${path}` })
  })

  test("names a missing copy and a changed one, each with its fix", async () => {
    const path = binPath()
    expect(checkHerdr(path, REAL_SUM)).toEqual({
      code: 1,
      line: `herdr-pin: ${path} is missing; run playground herdr pin`,
    })
    mkdirSync(join(path, ".."), { recursive: true })
    await Bun.write(path, FAKE)
    expect(checkHerdr(path, FAKE_SUM)).toEqual({
      code: 1,
      line: `herdr-pin: ${path} has sha256 ${REAL_SUM}, not the pinned ${FAKE_SUM}; run playground herdr pin`,
    })
  })
})

// HOME moves the pinned path, so each run gets its own; the copy sits at its data folder's bin/herdr
const run = (home: string, ...args: string[]) =>
  Bun.spawnSync([process.execPath, "--no-env-file", PIN, ...args], {
    env: { ...process.env, HOME: home },
  })
const pinnedAt = (home: string) => join(home, ".playground", "bin", "herdr")

describe.if(process.platform === "darwin")("herdr-pin.ts on a Mac", () => {
  test("--asset with a file that is not the release refuses it, naming both sums", async () => {
    const home = join(scratch, "cli-asset")
    const asset = join(scratch, "fake-asset")
    await Bun.write(asset, FAKE)
    const proc = run(home, "--asset", asset)
    expect(proc.exitCode).toBe(2)
    expect(proc.stderr.toString()).toContain(`has sha256 ${REAL_SUM}, not the pinned `)
    expect(existsSync(pinnedAt(home))).toBe(false)
  })

  test("--check names a missing copy and exits 1", () => {
    const home = join(scratch, "cli-check")
    const proc = run(home, "--check")
    expect(proc.exitCode).toBe(1)
    expect(proc.stderr.toString().trim()).toBe(
      `herdr-pin: ${pinnedAt(home)} is missing; run playground herdr pin`,
    )
  })
})

test.if(process.platform !== "darwin")("herdr-pin.ts off a Mac installs nothing, exit 3", () => {
  const home = join(scratch, "cli-linux")
  const proc = run(home)
  expect(proc.exitCode).toBe(3)
  expect(existsSync(pinnedAt(home))).toBe(false)
})

test("herdr-pin.ts refuses a word it does not take, exit 2", () => {
  const proc = run(join(scratch, "cli-usage"), "--force")
  expect(proc.exitCode).toBe(2)
  expect(proc.stderr.toString()).toContain("herdr-pin.ts [--check] [--asset <file>]")
})
