import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const DISPATCH = join(import.meta.dir, "../../../../../extensions/core/skills/playbook/DISPATCH.md")

describe("DISPATCH.md", () => {
  test("files an org's or a person's ask in that extension's repo, and only the factory's own in the factory repo (PG-83)", async () => {
    const text = await Bun.file(DISPATCH).text()
    const lines = text.split("\n")
    const at = lines.findIndex((l) =>
      l.includes("It files an issue in the repo where the work lives"),
    )
    const line = lines[at] ?? ""
    expect(line).toContain("the factory's own work in the factory repo")
    expect(lines[at + 1]).toContain("Before it files one, it searches that repo's open issues")
    expect(line).toContain(
      "an org's in that org's extension repo and a person's in their login extension ([ADR 0016](",
    )
  })

  test("a stacked child merges its parent's branch once, when the parent scores 5/5 or merges, with its measured case", async () => {
    const text = await Bun.file(DISPATCH).text()
    const line =
      text.split("\n").find((l) => l.includes("merges its parent's branch in once")) ?? ""
    expect(line).toContain("once, when the parent scores 5/5 or merges")
    expect(line).toContain("and `canary` only when it needs it")
    expect(line).toContain("four times in 59 minutes while the parent sat at 3/5")
  })

  test("a lane's item aims at about 1,000 changed lines, a bigger diff splitting off canary, with its measured case", async () => {
    const text = await Bun.file(DISPATCH).text()
    const line = text.split("\n").find((l) => l.includes("aims at about 1,000 changed lines")) ?? ""
    expect(line).toContain("splits the rest into a new PR off `canary`")
    expect(line).toContain("rather than stacking a third level")
    expect(line).toContain("9,089 lines")
  })

  test("a lane's or a stack's file set and an overlap check read each PR's whole list through the paginated read, since gh pr view stops at 100", async () => {
    const lines = (await Bun.file(DISPATCH).text()).split("\n")
    const lanes = lines.findIndex((l) => l.includes("each lane owning its files"))
    const at = lines.findIndex((l) => l.includes("every overlap check between open PRs"))
    expect(at).toBeGreaterThan(lanes)
    const line = lines[at] ?? ""
    expect(line).toContain("a stack's")
    expect(line).toContain("overlap")
    expect(line).toContain(
      "`gh api --paginate repos/<owner>/<repo>/pulls/<n>/files --jq '.[].filename'`",
    )
    expect(line).toContain("`gh pr view <n> --json files` stops at 100")
    expect(line).toContain("100 of its 143 files")
  })
})
