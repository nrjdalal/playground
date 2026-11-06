import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { COUNTED, WRAPPERS } from "../../../scripts/hooks/shell"
import { SCRIPT } from "./run-slot-fake"

const script = readFileSync(SCRIPT, "utf8")
const words = (line: string) => line.split(" ").filter(Boolean).sort()

// the options shell.ts's parse reads by hand rather than from its lists: env's -C and --chdir, and xargs's -I, -J and -i or --replace
const SPECIAL: Record<string, { flags: string[]; values: string[] }> = {
  env: { flags: [], values: ["--chdir", "-C"] },
  xargs: { flags: ["--replace", "-i"], values: ["-I", "-J"] },
}

// chain_steps reads past the wrapper words and options the hooks' shell reader reads past, so the two readers agree on which program a wrapper runs
test("chain_steps's wrapper table is shell.ts's WRAPPERS", () => {
  const table = script.match(/^CHAIN_WRAPPER_OPTIONS="([^"]*)"$/m)?.[1] ?? ""
  const got = Object.fromEntries(
    table
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const [name, flags = "", values = ""] = row.split("|")
        return [name, { flags: words(flags), values: words(values) }]
      }),
  )
  const want = Object.fromEntries(
    [...WRAPPERS].map(([name, { flags, values }]) => [
      name,
      {
        flags: words([...flags, ...(SPECIAL[name]?.flags ?? [])].join(" ")),
        values: words([...values, ...(SPECIAL[name]?.values ?? [])].join(" ")),
      },
    ]),
  )
  expect(Object.keys(got)).toEqual(Object.keys(want).sort())
  expect(got).toEqual(want)
})

test("chain_steps's counted wrappers are shell.ts's COUNTED", () => {
  expect(words(script.match(/^CHAIN_COUNTED="([^"]*)"$/m)?.[1] ?? "")).toEqual([...COUNTED].sort())
})
