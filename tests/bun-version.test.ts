import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

// The copies of the bun version that cannot read package.json; each names the line that holds it.
const COPIES = [
  { path: "api/hono/Dockerfile", version: /^FROM oven\/bun:(\S+?)-alpine/m },
  { path: "scripts/ops/runner-host/setup.sh", version: /^BUN_VERSION=(\S+)$/m },
  { path: "web/next/Dockerfile", version: /^FROM oven\/bun:(\S+?)-alpine/m },
]

const packageManagerBun = async (root: string): Promise<string> => {
  const { packageManager } = await Bun.file(join(root, "package.json")).json()
  const version = /^bun@(\S+)$/.exec(packageManager ?? "")?.[1]
  if (!version)
    throw new Error(`package.json's packageManager is not bun@<version>: ${packageManager}`)
  return version
}

const mismatches = async (root: string): Promise<string[]> => {
  const want = await packageManagerBun(root)
  const found: string[] = []
  for (const { path, version } of COPIES) {
    const got = version.exec(await Bun.file(join(root, path)).text())?.[1]
    if (got !== want) found.push(`${path}: ${got ?? "no bun version found"}`)
  }
  return found
}

const scratch: string[] = []
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { force: true, recursive: true })
})

test("every setup-bun step reads its bun from package.json", async () => {
  const steps: string[] = []
  for await (const path of new Bun.Glob(".github/workflows/*.yml").scan({ cwd: ROOT })) {
    const text = await Bun.file(join(ROOT, path)).text()
    if (/^\s*bun-version:/m.test(text)) steps.push(`${path}: writes bun-version`)
    const uses = text.match(/uses: oven-sh\/setup-bun@/g)?.length ?? 0
    const reads = text.match(/^\s*bun-version-file: package\.json$/gm)?.length ?? 0
    if (uses !== reads)
      steps.push(`${path}: ${uses} setup-bun step(s), ${reads} reading package.json`)
  }
  expect(steps.sort()).toEqual([])
})

test("every Dockerfile and setup.sh runs package.json's packageManager bun", async () => {
  expect(await mismatches(ROOT)).toEqual([])
})

test("a copy whose bun differs from packageManager is named", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bun-version-"))
  scratch.push(dir)
  for (const path of ["package.json", ...COPIES.map((copy) => copy.path)]) {
    await Bun.write(join(dir, path), Bun.file(join(ROOT, path)))
  }
  const setup = join(dir, "scripts/ops/runner-host/setup.sh")
  await Bun.write(
    setup,
    (await Bun.file(setup).text()).replace(/^BUN_VERSION=.*$/m, "BUN_VERSION=0.0.1"),
  )
  expect(await mismatches(dir)).toEqual(["scripts/ops/runner-host/setup.sh: 0.0.1"])
})
