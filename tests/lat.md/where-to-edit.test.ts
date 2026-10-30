import { afterAll, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const LAT = join(ROOT, "node_modules", ".bin", "lat-core")
const MAP = join(ROOT, "lat.md", "where-to-edit.md")
const RENAMED = "[[api/hono/src/lib/error.ts#errorHandler]]"

const scratch = mkdtempSync(join(tmpdir(), "lat-where-to-edit-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const latCheck = async (cwd: string) => {
  // run through bun, since the bin's shebang wants node
  const proc = Bun.spawn(["bun", LAT, "check"], { cwd, stderr: "pipe", stdout: "pipe" })
  const [stderr, stdout] = await Promise.all([
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ])
  return { code: await proc.exited, output: stdout + stderr }
}

test("lat check passes on the real tree", async () => {
  const { code, output } = await latCheck(ROOT)
  expect(output).toContain("All checks passed")
  expect(code).toBe(0)
})

test("lat check names the link whose symbol was renamed", async () => {
  cpSync(join(ROOT, "lat.md"), join(scratch, "lat.md"), { recursive: true })
  const map = await Bun.file(MAP).text()
  const files = new Set(
    [...map.matchAll(/\[\[([^\]#]+\.[a-z]+)(?:#[^\]]*)?\]\]/g)].map((m) => m[1]),
  )
  for (const file of files) {
    mkdirSync(dirname(join(scratch, file)), { recursive: true })
    cpSync(join(ROOT, file), join(scratch, file))
  }
  expect(map).toContain(RENAMED)
  const error = join(scratch, "api/hono/src/lib/error.ts")
  await Bun.write(error, (await Bun.file(error).text()).replaceAll("errorHandler", "onError"))
  const { code, output } = await latCheck(scratch)
  expect(output).toContain(RENAMED)
  expect(code).not.toBe(0)
})
