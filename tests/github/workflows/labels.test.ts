import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "../../../.github/workflows")
const workflows = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name))
const text = (name: string) => Bun.file(join(DIR, name)).text()

type Workflow = {
  on?: {
    pull_request?: { branches?: string[]; types?: string[] }
  }
  permissions?: Record<string, string>
}

describe("the checks on a pull request", () => {
  test("run on every pull request into canary or main, with no label to start them", async () => {
    for (const name of ["auto-check-build.yml", "auto-test.yml"]) {
      const body = await text(name)
      const { on, permissions } = Bun.YAML.parse(body) as Workflow
      expect(on?.pull_request?.types?.toSorted()).toEqual(["opened", "reopened", "synchronize"])
      expect(on?.pull_request?.branches?.toSorted()).toEqual(["canary", "main"])
      expect(permissions).toEqual({ contents: "read" })
    }
  })

  test("no workflow waits on a label, or runs a fork's code with the base's token", async () => {
    for (const name of workflows) {
      const body = await text(name)
      expect(body).not.toMatch(/labels\.\*\.name|event\.label\.name/)
      expect(body).not.toContain("pull_request_target:")
    }
  })
})
