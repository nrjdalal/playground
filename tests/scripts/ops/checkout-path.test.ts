import { expect, test } from "bun:test"
import { join } from "node:path"

const repo = join(import.meta.dir, "..", "..", "..")
const ops = join(repo, "scripts", "ops")
const FIXED_CHECKOUT =
  /(?:~|\$\{?HOME\}?|\/Users\/[\w.-]+)\/[\w-][\w.-]*\/dispatcher|,\s*["']\w[\w.-]*["']\s*,\s*["']dispatcher["']\s*\)/
const COMMENT = /^\s*(?:#|\/\/)/
const LOOKUPS = [join(ops, "beat.py"), join(repo, "packages", "scripts", "src", "main-checkout.ts")]

// The two lookups, beat.py's checkout() and main-checkout.ts, are the only places a checkout path is named, so a Mac whose dispatcher lives elsewhere needs no edit in any job
test("no ops script names a fixed dispatcher checkout path", async () => {
  const files = [join(repo, "scripts", "spawn.sh")]
  for (const [cwd, pattern] of [
    [ops, "**/*.{py,sh,ts}"],
    [join(repo, "packages", "scripts", "src"), "ops-*/**/*.ts"],
  ] as const)
    for await (const name of new Bun.Glob(pattern).scan({ cwd })) files.push(join(cwd, name))
  const found: string[] = []
  for (const file of files) {
    if (LOOKUPS.includes(file)) continue
    const lines = (await Bun.file(file).text()).split("\n")
    lines.forEach((line, i) => {
      if (FIXED_CHECKOUT.test(line) && !COMMENT.test(line))
        found.push(`${file.slice(repo.length + 1)}:${i + 1}`)
    })
  }
  expect(found).toEqual([])
})
