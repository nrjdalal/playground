import { describe, expect, test } from "bun:test"

import {
  ASSET_NAMES,
  assetOf,
  herdrPath,
  PIN_SOURCE,
  pinnedSum,
} from "../../../../../packages/scripts/src/ops-herdr/pin"

describe("the herdr pin", () => {
  test("pins herdr 0.9.5 by GitHub's digest of each macOS and Linux arm64 release asset", () => {
    expect(PIN_SOURCE.version).toBe("0.9.5")
    expect(pinnedSum("darwin-arm64")).toBe(
      "fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2",
    )
    expect(pinnedSum("darwin-x64")).toBe(
      "5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369",
    )
    expect(pinnedSum("linux-arm64")).toBe(
      "17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c",
    )
  })

  test("names an asset only for a Mac, arm64 or x64, and Linux on arm64", () => {
    expect(assetOf("darwin", "arm64")).toBe("darwin-arm64")
    expect(assetOf("darwin", "x64")).toBe("darwin-x64")
    expect(assetOf("linux", "arm64")).toBe("linux-arm64")
    expect(ASSET_NAMES).toEqual({
      "darwin-arm64": "herdr-macos-aarch64",
      "darwin-x64": "herdr-macos-x86_64",
      "linux-arm64": "herdr-linux-aarch64",
    })
    expect(assetOf("linux", "x64")).toBeNull()
    expect(pinnedSum("linux-x64")).toBe("")
  })

  test("keeps the binary in HOME's data folder, whatever Claude login or data folder the env names", () => {
    expect(herdrPath({ HOME: "/scratch/home" })).toBe("/scratch/home/.playground/bin/herdr")
    expect(
      herdrPath({
        CLAUDE_CONFIG_DIR: "/scratch/other-login",
        HOME: "/scratch/home",
        PLAYGROUND_DATA_DIR: "/scratch/data",
        PLAYGROUND_HERDR_DIR: "/scratch/herdr",
      }),
    ).toBe(herdrPath({ HOME: "/scratch/home" }))
  })
})
