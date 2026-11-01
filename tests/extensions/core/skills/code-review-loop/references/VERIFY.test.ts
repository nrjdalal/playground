import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const VERIFY = join(
  import.meta.dir,
  "../../../../../../extensions/core/skills/code-review-loop/references/VERIFY.md",
)

describe("VERIFY.md", () => {
  test("reads another PR's whole file list through the paginated read and the PR's own from the clone, since gh pr view stops at 100", async () => {
    const line =
      (await Bun.file(VERIFY).text())
        .split("\n")
        .find((l) => l.includes("**Read a whole file list.**")) ?? ""
    expect(line).toContain(
      "`gh api --paginate repos/<owner>/<repo>/pulls/<n>/files --jq '.[].filename'`",
    )
    expect(line).toContain("`git -C <clone> diff --name-only")
    expect(line).toContain("`gh pr view <n> --json files` stops at 100")
    expect(line).toContain("100 of its 143 files")
  })
})
