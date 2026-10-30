import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// The repo's own code is all rights reserved: the root LICENSE and NOTICE are held to their exact text, while each vendored folder keeps the license it shipped with.
const ROOT = join(import.meta.dir, "..")
const LICENSE = `Copyright (c) 2026 nrjdalal. All rights reserved.
This software is not licensed for public use. No permission is granted to use, copy, modify or distribute it.
It is provided "as is", without warranty of any kind. Use it at your own risk.
`
const NOTICE = `All rights reserved. Not licensed for use.

This notice covers only this repository's own code; each vendored folder keeps its own license.
`

describe("the root LICENSE and NOTICE", () => {
  test("hold their exact text", () => {
    expect(readFileSync(join(ROOT, "LICENSE"), "utf8")).toBe(LICENSE)
    expect(readFileSync(join(ROOT, "NOTICE"), "utf8")).toBe(NOTICE)
  })

  test("the root holds one LICENSE file, any case or extension, while the vendored one stays", () => {
    const licenses = readdirSync(ROOT).filter((name) => /^license(\..*)?$/i.test(name))
    expect(licenses).toEqual(["LICENSE"])
    expect(existsSync(join(ROOT, "extensions", "core", "upstream", "LICENSE"))).toBe(true)
  })

  test("the README ends on the all-rights-reserved line", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8")
    expect(readme.trimEnd().split("\n").at(-1)).toBe(
      "All rights reserved. Not for public use; use at your own risk. See LICENSE.",
    )
  })
})
