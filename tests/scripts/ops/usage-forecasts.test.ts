import { expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", "..")
const read = (path: string) => Bun.file(join(root, path)).text()

// #183: the usage rule's forecast method names its readings by file, so each file it names is one the code writes or reads today
const forecasts = async () => {
  const readme = await read("scripts/ops/README.md")
  return readme.slice(readme.indexOf("## Usage forecasts"), readme.indexOf("## Ops switches"))
}

test("the forecast method names no reading source that nothing writes (#183)", async () => {
  const docs = [await forecasts(), await read("extensions/core/rules/usage.md")].join("\n")
  expect(docs).not.toContain("spare-history")
  expect(docs).not.toContain("usage_table")
})

test("every ops/usage file the forecast method names is one the usage scripts write or read (#183)", async () => {
  const section = await forecasts()
  const named = [...section.matchAll(/`([\w.-]+\.(?:jsonl|json))`/g)].map((m) => m[1]!)
  expect(named).toContain("week-samples.jsonl")
  expect(named).toContain("account-samples.jsonl")
  const code = (
    await Promise.all(
      ["week-marks.py", "run.py", "login-flip.py"].map((f) => read(`scripts/ops/usage/${f}`)),
    )
  ).join("\n")
  for (const file of named) expect(code).toContain(file.replace(/^usage-\*\.json$/, "usage-"))
})
