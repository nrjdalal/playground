import { expect, test } from "bun:test"
import { join } from "node:path"

const SOURCE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "scripts",
  "src",
  "shadcn-update.ts",
)

// The script runs on import, so its delete is read from its text; toTrash's own behaviour is trash.test.ts's.
test("sync:shadcn moves the ui folder to the trash with toTrash, and deletes nothing recursively", async () => {
  const text = await Bun.file(SOURCE).text()
  expect(text).toMatch(/toTrash\(\s*resolve\("web\/next\/src\/components\/ui"\)/)
  expect(text).not.toContain("recursive")
})
