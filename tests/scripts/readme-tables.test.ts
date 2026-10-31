import { expect, test } from "bun:test"
import { join } from "node:path"

const repo = join(import.meta.dir, "..", "..")
const READMES = ["scripts/README.md", "scripts/ops/README.md"]

// oxfmt re-pads every row of a table when one cell widens, so a one-line change shows as the whole table changed; these READMEs list one line per entry instead
test("the scripts READMEs hold no markdown table", async () => {
  const found: string[] = []
  for (const readme of READMES) {
    let fenced = false
    ;(await Bun.file(join(repo, readme)).text()).split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("```")) fenced = !fenced
      else if (!fenced && line.trimStart().startsWith("|")) found.push(`${readme}:${i + 1}`)
    })
  }
  expect(found).toEqual([])
})
