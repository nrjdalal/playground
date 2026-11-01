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

  test("reads a PR's whole file list through the paginated REST read beside the --paginate line, since gh pr view stops at 100", async () => {
    const lines = (await Bun.file(PAGE).text()).split("\n")
    const paginate = lines.findIndex((l) => l.includes("rename the variable `$endCursor`"))
    const line =
      lines.slice(paginate + 1, paginate + 3).find((l) => l.includes("pulls/<n>/files")) ?? ""
    expect(line).toContain(
      "`gh api --paginate repos/<owner>/<repo>/pulls/<n>/files --jq '.[].filename'`",
    )
    expect(line).toContain("`gh pr view <n> --json files` stops at 100")
    expect(line).toContain("100 of its 143 files")
  })

  test("the sweep's files connection carries its cursor, and step 2 says how to read the rest", async () => {
    const text = await Bun.file(PAGE).text()
    const files = text.slice(text.indexOf("files(first: 50) {"), text.indexOf("reviews(last: 1)"))
    expect(files).toContain("hasNextPage")
    expect(files).toContain("endCursor")
    const line = text.split("\n").find((l) => l.includes("`files(first: 50)` cuts a PR")) ?? ""
    expect(line).toContain("`hasNextPage`")
    expect(line).toContain("step 3")
  })
})
