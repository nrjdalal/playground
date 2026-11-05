import { expect, test } from "bun:test"
import { join } from "node:path"

const web = join(import.meta.dir, "../../../../../../web/next")
const picker = await Bun.file(join(web, "src/components/dashboard/template-picker.tsx")).text()

test("the picker's Edit templates opens Settings at its Templates section", () => {
  expect(picker).toMatch(/href="\/dashboard\/settings#templates"[\s\S]*?>\s*Edit templates\s*</)
})
