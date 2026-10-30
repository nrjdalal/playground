import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { claudeBinary } from "../../../../../api/hono/src/lib/claude-binary"

describe("claudeBinary", () => {
  test("the installed claude is found past cmux's shims", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-binary-"))
    try {
      const shim = join(dir, "cmux-cli-shims", "abc")
      const installed = join(dir, "bin")
      for (const folder of [shim, installed]) {
        mkdirSync(folder, { recursive: true })
        writeFileSync(join(folder, "claude"), "#!/bin/sh\n")
        chmodSync(join(folder, "claude"), 0o755)
      }
      expect(claudeBinary(`${shim}:${installed}`)).toBe(join(installed, "claude"))
      expect(claudeBinary(shim)).toBeNull()
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
