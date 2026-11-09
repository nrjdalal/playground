import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")
const WAITER = "extensions/core/skills/code-review-loop/scripts/state.ts"

const step3 = async () => {
  const text = await Bun.file(join(ROOT, "skills/zerostarter/release/SKILL.md")).text()
  return text.match(/^## 3\. Merge into `main`\n[\s\S]*?(?=^## )/m)?.[0] ?? ""
}

describe("the ship's merge step waits for the ship PR's own checks at the pin (#1650)", () => {
  test("it runs code-review-loop's checks waiter on the pin before gh pr merge, since v0.0.82 merged with a red shard", async () => {
    const text = await step3()
    const wait = text.indexOf(`${WAITER} checks <owner>/<repo> <n> "$CANARY"`)
    expect(wait).toBeGreaterThan(-1)
    expect(text.indexOf('gh pr merge <n> --merge --match-head-commit "$CANARY"')).toBeGreaterThan(
      wait,
    )
    expect(await Bun.file(join(ROOT, WAITER)).exists()).toBe(true)
  })

  test("a red reruns its failed jobs once, and a second red holds the ship and ends the freeze by step 1", async () => {
    const text = await step3()
    expect(text).toContain("gh run rerun <run id> --failed")
    expect(text).toContain("--log-failed")
    expect(text).toMatch(/second red.*hold the ship.*step 1/s)
  })

  test("its Done when reads both gate checks green at the pin", async () => {
    const done = (await step3()).match(/^Done when .*$/m)?.[0] ?? ""
    expect(done).toContain("`CHECK success Audit, Lint, and Build`")
    expect(done).toContain("`CHECK success test`")
  })
})
