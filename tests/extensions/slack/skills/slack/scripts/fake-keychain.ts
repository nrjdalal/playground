import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A PATH whose first folder holds a fake `security`, printing out and exiting with code, so a script's Keychain read never reaches this Mac's Keychain; its default finds no item, as `security` exits 44.
export function fakeKeychain(dir: string, { code = 44, out = "" } = {}): string {
  const bin = join(dir, "fake-bin")
  mkdirSync(bin, { recursive: true })
  const security = join(bin, "security")
  writeFileSync(security, `#!/bin/sh\nprintf '%s' '${out}'\nexit ${code}\n`)
  chmodSync(security, 0o755)
  return `${bin}:${process.env.PATH ?? ""}`
}
