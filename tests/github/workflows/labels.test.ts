import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { GATE_LABEL, LOCAL_LABEL } from "../../../packages/scripts/src/pr-merge/go"

const DIR = join(import.meta.dir, "../../../.github/workflows")
const workflows = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name))
const text = (name: string) => Bun.file(join(DIR, name)).text()
const REQUIRED = /contains\(github\.event\.pull_request\.labels\.\*\.name, '([^']+)'\)/g
const NAMED = /github\.event\.label\.name == '([^']+)'/g

describe("the workflows' label gate", () => {
  test("only Cloud CI starts the gated workflows", async () => {
    const gated: string[] = []
    for (const name of workflows) {
      const body = await text(name)
      const labels = [...body.matchAll(REQUIRED), ...body.matchAll(NAMED)].map((m) => m[1])
      if (labels.length) gated.push(name)
      expect(labels.every((label) => label === GATE_LABEL)).toBe(true)
    }
    expect(gated.sort()).toEqual(["hosted-check-build.yml", "hosted-test.yml"])
  })

  test("Local CI starts no workflow", async () => {
    for (const name of workflows) expect(await text(name)).not.toContain(LOCAL_LABEL)
  })
})
