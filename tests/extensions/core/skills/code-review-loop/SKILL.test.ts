import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "../../../../..")
const skill = () => Bun.file(join(root, "extensions/core/skills/code-review-loop/SKILL.md")).text()
const page = () => Bun.file(join(root, "docs/playground/code-review-loop.md")).text()

describe("code-review-loop keeps its reviewer for the merge (#1067)", () => {
  test("after a 5/5 the reviewer stays up until the PR merges", async () => {
    const step = (await skill()).match(/^8\. \*\*Report and wait\.\*\*.*$/m)?.[0] ?? ""
    expect(step).toContain("until the waiter ends with `CLOSED`")
    expect(await page()).toContain("stays up after its 5/5")
  })

  test("a moved canary touching the PR's files gets its touched tests run on a local merge", async () => {
    const last = (await skill()).split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    expect(last).toContain("on a local merge with `origin/canary`")
    expect(last).toContain("a red run there is a blocking finding")
    expect(last.split("**Done when**")[1] ?? "").toContain("on a local merge with canary")
    expect(await page()).toContain("on a local merge with canary")
  })

  test("a PR that adds or changes a repo scanner gets the local merge whatever canary changed (#1959)", async () => {
    const last = (await skill()).split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    expect(last).toContain(
      "adds or changes a repo scanner, as the touched tests' fourth rule finds one",
    )
    expect(last).toContain("PG-1949's owner-text ratchet")
    expect(last.split("**Done when**")[1] ?? "").toContain(
      "or the PR adds or changes a repo scanner",
    )
    expect(await page()).toContain("or the PR adds or changes a repo scanner")
  })

  test("a dependency bump's pinned advisory stands only after the audit skill's parent read (#1950)", async () => {
    const step = (await skill()).match(/^4\. \*\*Review on two axes\.\*\*.*$/m)?.[0] ?? ""
    expect(step).toContain("the audit skill's rung 2")
    expect(step).toContain("`npm view <parent> version dependencies`")
    expect(step.split("**Done when**")[1] ?? "").toContain("for a dependency bump, the parent read")
    expect(await page()).toContain("the audit skill's rung 2")
  })

  test("a head made only by merging canary in after the fresh read gets its own (#1525)", async () => {
    const last = (await skill()).split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    expect(last).toContain(
      "A head made only by merging `canary` in, after the fresh full read, is a new head",
    )
    expect(last).toContain("needs a fresh full read of its own before 5/5")
    expect(await page()).toContain("again at a head made only by merging canary in after it")
  })

  test("a base merge keeps a standing 5/5 a candidate, never a jump past the read (#1558)", async () => {
    const step = (await skill()).match(/^2\. \*\*Place the push\*\*.*$/m)?.[0] ?? ""
    const merge = step.split("`BASE-MERGE`:")[1]?.split("`OWN: <files>`")[0] ?? ""
    expect(merge).toContain("a standing 5/5 is still a **candidate**")
    expect(merge).toContain("The last 5/5's fresh full read and check-types at the new head")
  })
})

describe("code-review-loop's touched tests come from the diff (#1104, #1525)", () => {
  test("one definition runs state.py touched-tests and names its four rules", async () => {
    const text = await skill()
    expect(text.match(/\*\*The touched tests\*\*/g)?.length).toBe(1)
    const rule = text.split("**The touched tests**")[1]?.split("**Done when** every test")[0] ?? ""
    expect(rule).toContain("come from the diff")
    expect(rule).toContain("state.py touched-tests <clone> <merge base> <head>")
    expect(rule).toContain(
      "state.py touched-tests <clone> <merge base> <head> > <scratch>/touched.txt",
    )
    expect(rule).toContain("in a TypeScript repo, the file holds at least one path")
    expect(rule).toContain("A Python repo's list can be empty with nothing wrong")
    expect(rule).toContain("grep -l <dotted name> -- tests")
    expect(rule).toContain("xargs ~/.playground/ops/run-slot.sh")
    expect(rule).toContain("test:file < <scratch>/touched.txt")
    expect(rule).not.toContain("| xargs")
    expect(rule).toContain("the source's extension swapped for `.test.ts` or `.test.tsx`")
    expect(rule).toContain("`readdirSync` or `readdir(`")
    expect(rule).toContain(
      "a `git grep` (in a shell line or as argv, wrapped across lines or after an option like `-C`: `GIT_GREP` in the script)",
    )
    expect(rule).toContain("`SCANS_THROUGH_SOURCE` in the script")
    expect(rule).toContain("`rglob(`, `.glob(`, `os.walk` or `read_text(`")
    const script = await Bun.file(
      join(root, "extensions/core/skills/code-review-loop/scripts/state.py"),
    ).text()
    for (const file of [
      "tests/packages/scripts/src/verify/dashboard-map.test.ts",
      "tests/scripts/hooks/no-bare-slack-link.test.ts",
      "tests/scripts/hooks/no-playground-leak.test.ts",
    ])
      expect(script).toContain(file)
    expect(script).toContain("GIT_GREP = ")
    expect(await page()).toContain("come from the diff")
  })

  test("a merge that moves a fixture's path proves the fixture still reaches its reader (#1529)", async () => {
    const text = await skill()
    const check =
      text
        .split("When the merge with canary moves a path a test fixture uses")[1]
        ?.split("\n\n")[0] ?? ""
    expect(check).toContain("point the reader at a missing path")
    expect(check).toContain("git -C <clone> checkout -- <file>")
    expect(check).toContain("**Done when** every fixture-reading case went red")
  })
})

describe("code-review-loop posts on fresh checks (#1657)", () => {
  test("step 7 reads the head's checks again right before posting and scores a red one", async () => {
    const step = (await skill()).match(/^7\. \*\*Post\*\*.*$/m)?.[0] ?? ""
    const [body, done] = step.split("**Done when**")
    expect(body).toContain("Right before the verdict posts, read the head's checks again")
    expect(body).toContain("each check red there is a blocking finding")
    expect(done).toContain("the head's checks were read again right before the verdict posted")
  })
})
