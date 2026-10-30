import { expect, test } from "bun:test"
import { join } from "node:path"

const ops = join(import.meta.dir, "..", "..", "..", "scripts", "ops")

// A moved script names its state folder under ~/.playground/ops, since a path from `__file__` follows the path it is run by and a run by its repo path would write the main checkout
test("no merge-train or usage script finds its state from __file__", async () => {
  const found: string[] = []
  for (const folder of ["merge-train", "usage"])
    for await (const name of new Bun.Glob("*.py").scan({ cwd: join(ops, folder) }))
      if ((await Bun.file(join(ops, folder, name)).text()).includes("__file__"))
        found.push(`${folder}/${name}`)
  expect(found).toEqual([])
})
