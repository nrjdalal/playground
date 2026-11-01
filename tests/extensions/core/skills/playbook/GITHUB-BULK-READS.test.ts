import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const PAGE = join(
  import.meta.dir,
  "../../../../../extensions/core/skills/playbook/GITHUB-BULK-READS.md",
)

describe("GITHUB-BULK-READS.md", () => {
  test("names $endCursor for gh's --paginate beside the manual loop, with its measured case", async () => {
    const lines = (await Bun.file(PAGE).text()).split("\n")
    const loop = lines.findIndex((l) =>
      l.includes("back as `$cursor` until `hasNextPage` is false"),
    )
    const line = lines.slice(loop + 1, loop + 4).find((l) => l.includes("--paginate")) ?? ""
    expect(line).toContain("`gh api graphql --paginate`")
    expect(line).toContain("`$endCursor`")
    expect(line).toContain("`pageInfo { hasNextPage endCursor }`")
    expect(line).toContain("refetched page 1 554 times")
  })
})
