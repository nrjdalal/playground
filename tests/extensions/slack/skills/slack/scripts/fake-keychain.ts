import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A PATH whose first folder holds a fake `security` that finds no item, exiting 44 as `security` does, so a script's Keychain read never reaches this Mac's Keychain.
export function fakeKeychain(dir: string): string {
  const bin = join(dir, "fake-bin")
  mkdirSync(bin, { recursive: true })
  const security = join(bin, "security")
  writeFileSync(security, "#!/bin/sh\nexit 44\n")
  chmodSync(security, 0o755)
  return `${bin}:${process.env.PATH ?? ""}`
}
