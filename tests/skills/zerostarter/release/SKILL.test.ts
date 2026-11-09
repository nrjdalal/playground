import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")
const WAITER = "extensions/core/skills/code-review-loop/scripts/state.ts"

const step = async (heading: string) => {
  const text = await Bun.file(join(ROOT, "skills/zerostarter/release/SKILL.md")).text()
  return text.match(new RegExp(`^## ${heading}\\n[\\s\\S]*?(?=^## )`, "m"))?.[0] ?? ""
}
const step1 = () => step("1\\. Pin the content")
const step3 = () => step("3\\. Merge into `main`")

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

const PIN = "a11fb8850c8304a91ab714b2ff46ad89fe7411a7"
const TAG = "c400e3cb57db6a8addfabacaea06c703ae1fa964"
const OTHER = "6d8ab5ace7734a46201c0061cb9e961fbd5f5aa3"

// Step 3's reads of the body, each `echo "$BODY" | grep` line of its block, run on a made-up body with the pin and the last tag's commit set.
const reads = async (body: string): Promise<string[]> => {
  const lines = (await step3()).match(/^echo "\$BODY" \| grep .+$/gm) ?? []
  return Promise.all(
    lines.map(async (line) => {
      const proc = Bun.spawn(["bash", "-c", line], {
        env: { BODY: body, CANARY: PIN, PATH: process.env.PATH, TAG },
        stdout: "pipe",
      })
      await proc.exited
      return (await new Response(proc.stdout).text()).trim()
    }),
  )
}

describe("the ship's merge step reads step 1's new-user gate line for the pin (#1659)", () => {
  test("step 1 writes one gate line keyed by the pin: PASS, FAIL, or a FAIL the last tag shares with its open issue", async () => {
    const text = await step1()
    expect(text).toContain("`New-user gate at <CANARY>: PASS`")
    expect(text).toContain("`New-user gate at <CANARY>: FAIL`")
    expect(text).toContain("`New-user gate at <CANARY>: FAIL, shared with <TAG> as #<issue>`")
    expect(text).toContain("`New-user gate at <TAG>: FAIL`")
    expect(text).toMatch(/INCONCLUSIVE step alone reads `PASS`/)
  })

  test("step 3 reads the pin's line and the last tag's line, two reads", async () => {
    expect((await reads("")).length).toBe(2)
  })

  test("a body with no gate line, or one for another sha, reads nothing, and step 3 holds", async () => {
    expect((await reads("## What ships\n- #1651 docs"))[0]).toBe("")
    expect((await reads(`New-user gate at ${OTHER}: PASS\n`))[0]).toBe("")
    expect(await step3()).toMatch(/prints nothing.*hold/s)
  })

  test("a new FAIL, and a shared FAIL with no issue, read nothing, so both hold", async () => {
    expect((await reads(`New-user gate at ${PIN}: FAIL\nFAIL 1. the install's finish\n`))[0]).toBe(
      "",
    )
    const noIssue = `New-user gate at ${PIN}: FAIL, shared with ${TAG}\nNew-user gate at ${TAG}: FAIL\n`
    expect((await reads(noIssue))[0]).toBe("")
    const otherTag = `New-user gate at ${PIN}: FAIL, shared with ${OTHER} as #1658\n`
    expect((await reads(otherTag))[0]).toBe("")
  })

  test("a PASS line for the pin reads PASS, and step 3 goes on", async () => {
    const [pin] = await reads(`New-user gate at ${PIN}: PASS\nINCONCLUSIVE 5. Usage: a refusal\n`)
    expect(pin).toBe(`New-user gate at ${PIN}: PASS`)
    expect(await step3()).toMatch(/prints `PASS`, go on/)
  })

  test("a shared FAIL with its issue goes on only beside the last tag's own FAIL line and an open issue", async () => {
    const line = `New-user gate at ${PIN}: FAIL, shared with ${TAG} as #1658`
    expect(await reads(`${line}\nNew-user gate at ${TAG}: FAIL\n`)).toEqual([
      line,
      `New-user gate at ${TAG}: FAIL`,
    ])
    expect((await reads(`${line}\n`))[1]).toBe("")
    expect(await step3()).toContain("gh issue view <issue> --json state --jq .state")
    expect(await step3()).toMatch(
      /second read prints the last tag's line and the issue reads `OPEN`/,
    )
  })

  test("its Done when reads the pin's gate line going on", async () => {
    const done = (await step3()).match(/^Done when .*$/m)?.[0] ?? ""
    expect(done).toContain("gate line for `$CANARY`")
  })
})
