import { expect, test } from "bun:test"
import { join } from "node:path"

const DIR = join(import.meta.dir, "../../../.github/workflows")

type Step = { env?: Record<string, unknown>; run?: string }
type Workflow = { jobs: Record<string, { steps: Step[]; "timeout-minutes"?: number }> }
const read = async (name: string) =>
  Bun.YAML.parse(await Bun.file(join(DIR, name)).text()) as Workflow

// GitHub runs a job with no timeout-minutes for up to 360 minutes, so a hung suite holds a PR's checks for hours; a green Audit run takes 6 to 9 minutes
test("every job of the two pull request checks stops at 20 minutes", async () => {
  for (const name of ["auto-check-build.yml", "auto-test.yml"]) {
    const { jobs } = await read(name)
    for (const [id, job] of Object.entries(jobs))
      expect([name, id, job["timeout-minutes"]]).toEqual([name, id, 20])
  }
})

test("Audit's suite reaches its own deadline, which names the file it hangs in, 10 minutes before the job stops", async () => {
  const { jobs } = await read("auto-check-build.yml")
  const suite = Object.values(jobs)
    .flatMap((job) => job.steps)
    .find((step) => step.run?.includes("bun run test"))
  expect(suite?.env?.TEST_PARALLEL_DEADLINE_MS).toBe(600_000)
})
