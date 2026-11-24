import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "../../..")
const read = (path: string) => Bun.file(join(root, path)).text()

// The rush brief rides on every worker spawn, so its own header scopes it to the lane it applies to.
describe("brief-rush.md scopes itself to the lanes it binds (#2235)", () => {
  test("the header opens with its scope and names the lanes it binds and skips", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).toMatch(/^Scope: /)
    expect(text).toContain("binds every worker that builds")
    expect(text).toContain("A read-only lane")
  })

  test("the versioned brief keeps the live body's RUN SLOTS opener and worker greeting", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).toContain("RUN SLOTS")
    expect(text).toContain("You are worker-<name>: fill in the name your lead gave you.")
  })

  test("the owner step narrows to an org ticket and an outward send (#1350)", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).toContain(
      "A slice sends only these to him, via the dispatcher: a new org ticket, and an outward send",
    )
    expect(text).not.toContain(
      "shipping canary to main, new Linear tickets, irreversible deletes, and budget",
    )
  })
})

// issue 2030: the merge-tree line runs as written, pr:merge runs from the PR's own worktree, and logs stay inside the scratch folder
describe("brief-rush.md's merge and scratch lines run as written", () => {
  test("the before-each-round merge-tree check takes two commits", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    const line = text.split("\n").find((l) => l.startsWith("- Before each review round,")) ?? ""
    expect(line).toContain("`git merge-tree --write-tree <head> HEAD`")
    expect(line).toContain("exits 0 on a clean pair and 1 on a conflict")
    expect(text).not.toContain("--write-tree origin/canary <head> HEAD")
  })

  test("pr:merge runs from the PR's own worktree, never a checkout of origin/canary", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    expect(text).not.toContain("from a checkout of current origin/canary")
    expect(text).toContain("run from your PR's own worktree")
  })

  test("every log goes inside the session's own scratch folder, and a loose file named after it is its own", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    const line = text.split("\n").find((l) => l.startsWith("Plan: ")) ?? ""
    expect(line).toContain("Write every log inside `scratch/<session name>/`")
    expect(line).toContain("`<session name>-*` or `<session name>.*`")
  })
})

// issue 2825: the brief starts in the worktree by absolute path and gives every file tool that path
describe("brief-rush.md starts in the worktree and gives every file tool its absolute path (#2825)", () => {
  test("the worktree step cds into the worktree first, and every file tool gets its absolute path", async () => {
    const text = await read(join("scripts/briefs", "brief-rush.md"))
    const stepLine = text.split("\n").find((l) => l.startsWith("- Worktree:")) ?? ""
    expect(stepLine).toContain(
      "Your first command once it exists is `cd <worktree>`, its absolute path",
    )
    expect(stepLine).toContain("again after every resume")
    const fileLine = text.split("\n").find((l) => l.startsWith("- Give every file tool")) ?? ""
    expect(fileLine).toContain(
      "Give every file tool (Edit, Write, Read) the worktree's absolute path",
    )
    expect(fileLine).toContain("never a repo-relative one")
    expect(fileLine).toContain("since a relative path lands in the main checkout")
  })
})

describe("brief-rush points to testing.md's Traps for a red-first stub (#2854)", () => {
  test("a red-first commit that calls an export not built yet stubs it, typed and throwing, with any new field optional", async () => {
    const testing = await read(join(".agents", "testing.md"))
    expect(testing).toContain(
      "red-first commit whose rows call an export not built yet also commits a stub of it, typed as the real one with a body that throws",
    )
    const rush = await read(join("scripts/briefs", "brief-rush.md"))
    expect(rush).toContain("red-first commit that calls an export not built yet stubs it first, as")
    expect(rush).toContain("agents/testing.md#traps")
  })
})

// issue 2854: the GLM rule also pins the bundled-code check, a local or GLM worker puts new code where no hook bundle carries it, checked before each commit
describe("brief-rush.md's GLM rule pins the bundled-code check for a local or GLM worker (#2854)", () => {
  test("new code goes where no scripts/hooks/*.ts imports, checked with git grep and hooks-bundle before each commit", async () => {
    const rush = await read(join("scripts/briefs", "brief-rush.md"))
    const line = rush.split("\n").find((l) => l.startsWith("- New code goes in a module")) ?? ""
    expect(line).toContain("`scripts/hooks/*.ts` imports")
    expect(line).toContain("git grep -l")
    expect(line).toContain("hooks-bundle.ts --check")
    expect(line).toContain("no-glm-heavy-path")
    expect(line).toContain("a local session")
  })
})

// issue 2854: a local session reads a file over 300 lines only by grep then sed of at most 80 lines around each hit, never whole, since one read filled its 120k window reading three such files whole and then hung in compaction
describe("brief-rush.md's local-model rule reads a long file by grep then sed, never whole (#2854)", () => {
  test("a local session reads over 300 lines only by grep -n, then sed -n of at most 80 lines around each hit, never whole", async () => {
    const rush = await read(join("scripts/briefs", "brief-rush.md"))
    const line = rush.split("\n").find((l) => l.startsWith("- Local model rule:")) ?? ""
    expect(line).toContain("over 300 lines only by `grep -n`")
    expect(line).toContain("sed -n` of at most 80 lines around each hit")
    expect(line).toContain("never whole")
    expect(line).toContain("120k window in about 25 minutes")
  })
})

// issue 2854: the brief has no stacked-PR step yet, so a line beside its PR lines pins one, since the PR's CI workflows run only on a PR into canary or main and a retarget fires edited which starts neither
describe("brief-rush.md's stacked-PR line pins the retarget-to-canary CI step (#2854)", () => {
  test("a stacked PR gets no CI until it targets canary, then retargets to canary, merges it in and pushes", async () => {
    const rush = await read(join("scripts/briefs", "brief-rush.md"))
    const line = rush.split("\n").find((l) => l.startsWith("- A stacked PR gets no CI")) ?? ""
    expect(line).toContain("gets no CI until it targets `canary`")
    expect(line).toContain("`auto-check-build.yml` and `auto-test.yml`")
    expect(line).toContain("a PR into `canary` or `main`")
    expect(line).toContain("a retarget fires `edited`")
    expect(line).toContain("merge `origin/canary` in")
    expect(line).toContain("so CI runs at the head that merges")
  })
})

// issue 2854: a local worker that compacts twice without a commit is respawned on one-step briefs, each a single step with its own completion criterion, with the next step sent only after the report
describe("brief-rush.md's one-step line respawns a local worker that compacted twice on one-step briefs (#2854)", () => {
  test("a local worker that compacts twice without a commit is respawned on one-step briefs", async () => {
    const rush = await read(join("scripts/briefs", "brief-rush.md"))
    const line = rush.split("\n").find((l) => l.startsWith("- A local worker that compacts")) ?? ""
    expect(line).toContain("compacts twice without a commit")
    expect(line).toContain("respawned on one-step briefs")
    expect(line).toContain("each a single step with its own completion criterion")
    expect(line).toContain("with the next step sent only after its report")
  })
})
