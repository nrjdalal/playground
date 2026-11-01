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

  test("a PR whose files overflow reads its whole list through the paginated REST read, then several such PRs one aliased query, before step 3's Done when", async () => {
    const text = await Bun.file(PAGE).text()
    const rest = text.indexOf("reads its whole list through REST")
    const line = text.slice(rest, text.indexOf("\n", rest))
    expect(line).toContain(
      "`gh api --paginate repos/<owner>/<repo>/pulls/<n>/files --jq '.[].filename'`",
    )
    expect(line).toContain("`gh pr view <n> --json files` stops at 100")
    expect(line).toContain("100 of its 143 files")
    const several = text.indexOf("When several PRs' files say `hasNextPage`")
    const done = text.indexOf("Done when the sweep holds every PR")
    expect(text.indexOf("rename the variable `$endCursor`")).toBeLessThan(rest)
    expect(rest).toBeLessThan(several)
    expect(several).toBeLessThan(done)
    const query = text.slice(several, done)
    expect(query).toContain("repository(owner: $owner, name: $name)")
    expect(query).toContain("pr169: pullRequest(number: 169)")
    expect(query).toContain('files(first: 100, after: "<its endCursor>")')
    expect(query).toContain("endCursor")
    expect(query).toContain("path")
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
