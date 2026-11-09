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

  test("it reads the pin's runs before the waiter, since the waiter counts only a red that concludes after it starts", async () => {
    const text = await step3()
    const read = text.indexOf(
      'gh run list --commit "$CANARY" --event pull_request --json databaseId,workflowName,status,conclusion',
    )
    expect(read).toBeGreaterThan(-1)
    expect(text.indexOf(`${WAITER} checks`)).toBeGreaterThan(read)
    expect(text).toMatch(/red run is the first red: rerun it .* before the waiter starts/)
  })

  test("a pin with no gate run, its runs action_required under the bot's draft, opens the ship PR again from step 2", async () => {
    const text = await step3()
    expect(text).toMatch(/missing, or one reading `action_required`/)
    expect(text).toContain("`gh pr close <n>`")
    expect(text).toContain("step 2's `gh pr create`")
  })

  test("it names the waiter's CLOSED ending and reruns a cancelled run whole", async () => {
    const text = await step3()
    expect(text).toContain("`CLOSED <state>` when the ship PR closed (go back to step 2)")
    expect(text).toContain("`cancelled`")
    expect(text).toContain("# a cancelled run: gh run rerun <run id>")
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
