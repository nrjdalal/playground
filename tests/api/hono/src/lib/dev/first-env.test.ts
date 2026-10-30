import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { firstEnv } from "../../../../../../api/hono/src/lib/dev/first-env"

describe("firstEnv", () => {
  const example =
    "# Generate using `openssl rand -base64 32`\nBETTER_AUTH_SECRET=\nNODE_ENV=local\nPOSTGRES_URL=\n"

  test("a checkout with no .env gets .env.example's, its auth secret generated and the rest as written", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-first-env-"))
    writeFileSync(join(dir, ".env.example"), example)
    expect(firstEnv(dir)).toBe(
      "started .env from .env.example, with a generated BETTER_AUTH_SECRET",
    )
    const written = readFileSync(join(dir, ".env"), "utf8")
    expect(written).toMatch(/^BETTER_AUTH_SECRET=[A-Za-z0-9+/]{43}=$/m)
    expect(written.replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=")).toBe(example)
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600)
    rmSync(dir, { force: true, recursive: true })
  })

  test("an .env already there, or no .env.example, is left as it is", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-first-env-"))
    expect(firstEnv(dir)).toBeNull()
    writeFileSync(join(dir, ".env.example"), example)
    writeFileSync(join(dir, ".env"), "NODE_ENV=local\n")
    expect(firstEnv(dir)).toBeNull()
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe("NODE_ENV=local\n")
    rmSync(dir, { force: true, recursive: true })
  })
})
