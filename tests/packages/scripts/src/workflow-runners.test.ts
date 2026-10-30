import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { runnerProblems } from "../../../../packages/scripts/src/workflow-runners"

const DIR = join(import.meta.dir, "../../../../.github/workflows")

// A made-up workflow with one job, its runs-on and anything else given as YAML lines.
const workflow = (runsOn: string, extra = "", on = "push") =>
  `on: ${on}\njobs:\n  build:\n    runs-on: ${runsOn}\n${extra}    steps:\n      - run: echo hi\n`

const rules = (text: string) => runnerProblems("x.yml", text).map((p) => p.match(/rule (\d)/)![1])

describe("runnerProblems", () => {
  test("a hosted image, as a string or a one-item list, passes", () => {
    expect(runnerProblems("x.yml", workflow("ubuntu-latest"))).toEqual([])
    expect(runnerProblems("x.yml", workflow("[ubuntu-latest]"))).toEqual([])
    expect(runnerProblems("x.yml", workflow("macos-15"))).toEqual([])
  })

  test("a self-hosted label fails rule 2, in a list or as a string", () => {
    for (const runsOn of ["[self-hosted, dispatcher]", "self-hosted", "[self-hosted, mac]"])
      expect(rules(workflow(runsOn))).toContain("2")
    expect(runnerProblems("x.yml", workflow("[self-hosted, dispatcher]"))[0]).toStartWith(
      "x.yml job build:",
    )
  })

  test("a list of more than one label fails rule 1", () => {
    expect(rules(workflow("[ubuntu-latest, gpu]"))).toEqual(["1"])
  })

  test("an expression picks a runner at run time, so it fails rule 3", () => {
    expect(rules(workflow("${{ inputs.runner }}"))).toContain("3")
  })

  test("a matrix counts only when every value it lists is hosted", () => {
    const matrix = (values: string) =>
      workflow("${{ matrix.os }}", `    strategy:\n      matrix:\n        os: ${values}\n`)
    expect(runnerProblems("x.yml", matrix("[ubuntu-latest, macos-latest]"))).toEqual([])
    expect(rules(matrix("[ubuntu-latest, self-hosted]"))).toContain("2")
  })

  test("the object form reaches runner groups, so it fails rule 4", () => {
    expect(rules(workflow("{ group: ours }"))).toEqual(["4"])
    expect(rules(workflow("{ labels: [ubuntu-latest] }"))).toEqual(["4"])
  })

  test("pull_request_target or workflow_run checking out the PR's head fails rule 5", () => {
    const checkout =
      "    steps:\n      - uses: actions/checkout@v5\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n"
    const text = (on: string) =>
      `on: ${on}\njobs:\n  build:\n    runs-on: ubuntu-latest\n${checkout}`
    expect(rules(text("pull_request_target"))).toEqual(["5"])
    expect(rules(text("[workflow_run]"))).toEqual(["5"])
    expect(runnerProblems("x.yml", text("pull_request"))).toEqual([])
  })

  test("a file that does not parse is a problem, so the guard fails closed", () => {
    expect(runnerProblems("x.yml", "jobs: [")).toHaveLength(1)
  })
})

describe("the real workflows", () => {
  const files = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name))
  const read = (name: string) => Bun.file(join(DIR, name)).text()

  test("the pull request gate is the hosted pair, each on hosted runners alone", async () => {
    const gate: string[] = []
    for (const name of files) {
      const text = await read(name)
      const parsed = Bun.YAML.parse(text) as { on?: { pull_request?: unknown } } | null
      if (!parsed?.on?.pull_request) continue
      gate.push(name)
      expect(runnerProblems(name, text)).toEqual([])
    }
    expect(gate.toSorted()).toEqual(["hosted-check-build.yml", "hosted-test.yml"])
  })

  // a self-hosted runner would run a fork's pull request on that machine, so the list stays empty and a new self-hosted workflow fails here
  test("every workflow runs on hosted runners alone", async () => {
    const selfHosted: string[] = []
    for (const name of files)
      if (runnerProblems(name, await read(name)).length) selfHosted.push(name)
    expect(selfHosted).toEqual([])
  })
})
