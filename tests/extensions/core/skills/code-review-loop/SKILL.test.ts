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

  test("green CI at the head stands in for the local touched-tests run while canary changed none of the PR's files (PG-124)", async () => {
    const last = (await skill()).split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    const stand = last.split("**CI stands in**")[1]?.split("\n")[0] ?? ""
    expect(stand).toContain("head sha equal to `<head>`")
    expect(stand).toContain("`HEAD is now at <sha> Merge <head> into <run base>`")
    expect(stand).toContain("`git -C <clone> diff --name-only <run base> origin/canary`")
    expect(stand).toContain("a repo scanner or a data file one reads")
    expect(stand).toContain(
      "`touched tests: PR CI green at <sha7> on canary <run base7>: <run link>`",
    )
    expect(stand).toContain("the local run stays as written")
    expect(last).toContain(
      "on a local merge with `origin/canary`, unless CI stands in for them (below)",
    )
    expect(last).toContain("The merge also runs, unless CI stands in for it,")
    expect(last.split("**Done when**")[1] ?? "").toContain("or CI stood in for them at the head")
    expect(await page()).toContain(
      "cites that run's link in place of a local run of the touched tests",
    )
  })

  test("CI still running at the head is waited on, not raced by a local run, while canary changed none of the PR's files (#166)", async () => {
    const last = (await skill()).split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    const stand = last.split("**CI stands in**")[1]?.split("\n")[0] ?? ""
    expect(stand).toContain(
      "While those checks still run at `<head>` and canary has changed none of the PR's files",
    )
    expect(stand).toContain(
      "`gh api repos/<owner>/<repo>/commits/<head>/check-runs` at playbook's **github** rule's pace (`github.pollMinutes`)",
    )
    expect(stand).toContain("queue them only when a stand-in condition fails or a check goes red")
    expect(await page()).toContain("waits for CI still running at the head")
  })

  test("green CI at the head stands in for check-types, but not for a file packages/scripts imports from outside it (#166)", async () => {
    const last = (await skill()).split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    expect(last).toContain(
      "CI stands in (below) for check-types on the same two conditions as for the touched tests",
    )
    expect(last).toContain(
      "The local run stays when the diff changes a file outside `packages/scripts` that one of its sources imports by relative path",
    )
    expect(last.split("**Done when**")[1] ?? "").toContain(
      "check-types ran green or CI stood in for it",
    )
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
      "tests/packages/scripts/src/parity/record.test.ts",
      "tests/packages/scripts/src/trace-count/count.test.ts",
      "tests/packages/scripts/src/verify/dashboard-map.test.ts",
      "tests/packages/scripts/src/verify/prebuild.test.ts",
      "tests/scripts/hooks/no-bare-slack-link.test.ts",
      "tests/scripts/hooks/no-playground-leak.test.ts",
      "tests/skills/built-in-names.test.ts",
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

// The owner's choice: green for 5/5, orange for 4/5, red for 3/5 or less, each a Tailwind 500 that no-off-palette-label lets through
describe("the Review label carries its score's color (PG-157)", () => {
  const comments = () =>
    Bun.file(join(root, "extensions/core/skills/code-review-loop/references/COMMENTS.md")).text()

  test("COMMENTS.md's table maps every score to its Tailwind 500, and the reviewer sets it before the label", async () => {
    const { TAILWIND_500 } = await import(join(root, "scripts/hooks/no-off-palette-label.ts"))
    const text = await comments()
    const rows = [...text.matchAll(/^\| `Review • (\d)\/5` +\| `#([0-9a-f]{6})` +\|$/gm)].map(
      ([, score, color]) => [Number(score), color],
    )
    const want = (score: number) =>
      score === 5 ? TAILWIND_500.green : score === 4 ? TAILWIND_500.orange : TAILWIND_500.red
    expect(rows).toEqual([5, 4, 3, 2, 1].map((score) => [score, want(score)]))
    expect(text).toContain("gh label create 'Review • <s>/5' -R <repo> --color <hex> --force")
  })
})

describe("a diff holding a long-lived connection is reviewed by a lifecycle table", () => {
  test("step 4 asks for the table in the PR's Evidence, one row per path, and scores blocking until it is there", async () => {
    const step = (await skill()).match(/^4\. \*\*Review on two axes\.\*\*.*$/m)?.[0] ?? ""
    const line = step.split("**Lifecycle table:**")[1]?.split("**Done when**")[0] ?? ""
    expect(line).toContain("a socket, a pub/sub subscriber, a retrying client")
    expect(line).toContain("in the PR's Evidence")
    expect(line).toContain(
      "one row per path: connect, a connect that fails partway, a drop, a hang after connect, reconnect and resubscribe, close, and a member who loses access,",
    )
    expect(line).toContain("the test that proves it, or the reason the path cannot happen")
    expect(line).toContain("blocking finding")
    expect(step.split("**Done when**")[1] ?? "").toContain("lifecycle table")
  })

  test("the docs page says a long-lived connection's lifecycle table holds the score down", async () => {
    expect(await page()).toContain(
      "lifecycle table, one row per path from connect to close, and a missing table holds the score at 3",
    )
  })
})

describe("code-review-loop runs its newest text every round (PG-213)", () => {
  test("step 1 opens by reading the skill from the main checkout, and its Done when checks it", async () => {
    const recover = (await skill()).match(/^1\. \*\*Recover\.\*\*.*$/m)?.[0] ?? ""
    expect(recover).toStartWith(
      "1. **Recover.** Read this skill's newest text from its folder in the main checkout, `$PLAYGROUND_REPO/extensions/core/skills/code-review-loop`,",
    )
    expect(recover).toContain(
      "That folder is the one `${CLAUDE_SKILL_DIR}` stands for in every command the round runs, `scripts/state.py` included",
    )
    expect(recover.split("**Done when**")[1] ?? "").toContain(
      "read code-review-loop's SKILL.md from the main checkout this round and the round's scripts and references come from that folder",
    )
    expect(await page()).toContain(
      "reads the skill's newest text, its scripts included, from the main checkout at the start of every round",
    )
  })
})

describe("code-review-loop's round 1 greps each changed term", () => {
  test("step 4 runs the changed-term grep in round 1, names its finding's shape and its Done when, with its measured case", async () => {
    const step = (await skill()).match(/^4\. \*\*Review on two axes\.\*\*.*$/m)?.[0] ?? ""
    expect(step).toContain(
      "the changed-term grep (`git grep -l <term>` over the agent-facing docs) for each term whose meaning the diff changes",
    )
    expect(step).toContain(
      "file every list or doc either leaves behind as one such finding, each as `file:line`",
    )
    expect(step).toContain("7 rounds")
    expect(step.split("**Done when**")[1] ?? "").toContain(
      "its changed-term grep for each term whose meaning it changes",
    )
    expect(await page()).toContain("each term whose meaning the diff changes")
  })

  test("AGENTS.md's pre-review pass runs the same grep before round 1", async () => {
    const agents = await Bun.file(join(root, "AGENTS.md")).text()
    const line = agents.split("\n").find((l) => l.includes("changed-term grep")) ?? ""
    expect(line).toContain("`git grep -l <term>`")
    expect(line).toContain("each term whose meaning the diff changes")
    expect(agents).toContain("each list grep and changed-term grep with its hits")
  })
})

describe("code-review-loop checks its own fixes and a repo scanner's landing (PG-251)", () => {
  test("step 5 runs the checks a patch's files call for before posting it with the results (R11-1: #61, #186, #212, #246)", async () => {
    const step = (await skill()).match(/^5\. \*\*Hand small fixes over\.\*\*.*$/m)?.[0] ?? ""
    expect(step).toContain(
      "a wording you suggest in a finding included, and run the checks its files call for (`bun run docs:wrap --check` on a wrapped doc, the test that pins the wording, `bun run test:file` on the file's mirrored test)",
    )
    expect(step).toContain("post the patch or wording with those results")
    expect(step.split("**Done when**")[1] ?? "").toContain("its checks' results posted with it")
    expect(await page()).toContain("runs the checks its files call for before it posts")
  })

  test("step 8 runs the touched tests on a local merge when canary adds or changes a repo-scanning test (#223's conventions test against #75 and #106)", async () => {
    const step = (await skill()).match(/^8\. \*\*Report and wait\.\*\*.*$/m)?.[0] ?? ""
    expect(step).toContain(
      "When what landed adds or changes a test that scans the repo or reads the schema, run that test and the touched tests on a local merge with `origin/canary` before you call a waiting 5/5 still good",
    )
    expect(step).toContain("a schema conventions test landed on canary")
    expect(step.split("**Done when**")[1] ?? "").toContain(
      "each scanning or schema-reading test that landed has run",
    )
    expect(await page()).toContain("a test that scans the repo or reads the schema lands on canary")
  })

  test("step 8 checks each waiting 5/5 for a merge conflict with canary whenever canary moves (#118 went CONFLICTING under its 5/5)", async () => {
    const text = await skill()
    const step = text.match(/^8\. \*\*Report and wait\.\*\*.*$/m)?.[0] ?? ""
    expect(step).toContain(
      "beside that `diff --stat`, run `git -C <clone> merge-tree --write-tree --name-only <head> origin/canary` on each waiting 5/5's head",
    )
    expect(step).toContain("as The last 5/5's merge-tree line scores it")
    expect(step).toContain("a new verdict that names the conflicted files")
    expect(step.split("**Done when**")[1] ?? "").toContain(
      "each waiting 5/5's head has a `merge-tree` check against the newest `origin/canary`",
    )
    expect(step).toContain(
      "On a stack held at 5/5 until the owner's try, that verdict is one trigger of a canary sync (playbook's DISPATCH.md, its line \"A stack held at 5/5 until the owner's try\")",
    )
    expect(step).toContain(
      "each canary move runs only this `merge-tree` check on its waiting 5/5s, leaving the stale-text check above and the scanning-test merge below to the round at the sync before the try",
    )
    expect(step.split("**Done when**")[1] ?? "").toContain(
      "a held stack's waiting 5/5 keeping its scanning-test merge and its stale-text check for the round at the sync before the try",
    )
    const last = text.split("## The last 5/5")[1]?.split("\n## ")[0] ?? ""
    expect(last).toContain(
      "First `git -C <clone> merge-tree --write-tree <head> origin/canary`: a conflict there is a blocking finding, which goes to the worker with the merge",
    )
    expect(await page()).toContain(
      "also checks each waiting 5/5's head for a merge conflict with canary",
    )
    expect(await page()).toContain(
      "On a stack held at 5/5 until the owner's try, that verdict is one signal to sync it with canary",
    )
  })
})
