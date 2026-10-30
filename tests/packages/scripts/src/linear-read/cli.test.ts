import { expect, test } from "bun:test"
import { join } from "node:path"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/linear-read/cli.ts")

test("fails naming the key when LINEAR_API_KEY is unset", async () => {
  const { LINEAR_API_KEY: _, ...env } = process.env
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI, "issue", "DUNE-1"], {
    env,
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(await child.exited).toBe(1)
  expect(await new Response(child.stderr).text()).toContain("LINEAR_API_KEY is not set")
  expect(await new Response(child.stdout).text()).toBe("")
})

test("names its commands when given none", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI], {
    env: { ...process.env, LINEAR_API_KEY: "lin_api_made_up_key" },
    stderr: "pipe",
  })
  expect(await child.exited).toBe(2)
  expect(await new Response(child.stderr).text()).toContain("issue <ID>")
})
