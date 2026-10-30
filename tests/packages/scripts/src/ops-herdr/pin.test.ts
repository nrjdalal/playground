import { describe, expect, test } from "bun:test"

import {
  assetOf,
  herdrPath,
  PIN_SOURCE,
  pinnedSum,
} from "../../../../../packages/scripts/src/ops-herdr/pin"

describe("the herdr pin", () => {
  test("pins herdr 0.9.5 by GitHub's digest of each macOS release asset", () => {
    expect(PIN_SOURCE.version).toBe("0.9.5")
    expect(pinnedSum("darwin-arm64")).toBe(
      "fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2",
    )
    expect(pinnedSum("darwin-x64")).toBe(
      "5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369",
    )
  })

  test("names an asset only for a Mac, arm64 or x64", () => {
    expect(assetOf("darwin", "arm64")).toBe("darwin-arm64")
    expect(assetOf("darwin", "x64")).toBe("darwin-x64")
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
