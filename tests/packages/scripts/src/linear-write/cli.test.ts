import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/linear-write/cli.ts")

test("fails naming the key when LINEAR_API_KEY is unset", async () => {
  const { LINEAR_API_KEY: _, ...env } = process.env
  const path = join(tmpdir(), `linear-write-cli-${Date.now()}.md`)
  await Bun.write(path, "A body.")
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", CLI, "comment", "DUNE-1", path], {
      env,
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(await child.exited).toBe(1)
    expect(await new Response(child.stderr).text()).toContain("LINEAR_API_KEY is not set")
    expect(await new Response(child.stdout).text()).toBe("")
  } finally {
    await rm(path, { force: true })
  }
})

test("names its command when given none", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI], {
    env: { ...process.env, LINEAR_API_KEY: "lin_api_made_up_key" },
    stderr: "pipe",
  })
  expect(await child.exited).toBe(2)
  expect(await new Response(child.stderr).text()).toContain("comment <ID> <file>")
})

test("refuses a command it does not know", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI, "save", "DUNE-1", "c.md"], {
    env: { ...process.env, LINEAR_API_KEY: "lin_api_made_up_key" },
    stderr: "pipe",
  })
  expect(await child.exited).toBe(2)
  expect(await new Response(child.stderr).text()).toContain("usage:")
})
