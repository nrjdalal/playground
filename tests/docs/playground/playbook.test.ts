import { expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "../../..")

test("playbook.md's standing rules list names exactly the rule files in extensions/core/rules/", async () => {
  const doc = await Bun.file(join(root, "docs/playground/playbook.md")).text()
  const list = doc.match(/the standing rules \(([^)]+)\)/)?.[1] ?? ""
  const named = list.split(", ").map((name) => name.replaceAll(" ", "-"))
  const files = readdirSync(join(root, "extensions/core/rules"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""))
  expect([...named].sort()).toEqual([...files].sort())
})
