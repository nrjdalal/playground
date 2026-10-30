import { describe, expect, test } from "bun:test"
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  candidates,
  hunksOf,
  likeness,
  lostLines,
  mergeTreeOf,
  unquote,
} from "../../../../../packages/scripts/src/pr-merge/lost"
import type { Run } from "../../../../../packages/scripts/src/pr-merge/merge"

const env = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_AUTHOR_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
}

// A scratch repository: canary starts with a.ts and old.ts, the PR branches from it, and canary then adds a line to a.ts and a new file.
function world() {
  const repo = mkdtempSync(join(tmpdir(), "lost-"))
  const git = (...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-C", repo, ...args], { env })
    if (proc.exitCode !== 0 && args[0] !== "merge") throw new Error(proc.stderr.toString())
    return proc.stdout.toString().trim()
  }
  const run: Run = async (args) => {
    const proc = Bun.spawnSync(["git", "-C", repo, ...args], { env })
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  const write = (file: string, text: string) => writeFileSync(join(repo, file), text)
  const commit = (message: string) => {
    git("add", "-A")
    git("commit", "--quiet", "--no-verify", "-m", message)
    return git("rev-parse", "HEAD")
  }
  // Concludes a merge left open by a conflict or --no-commit.
  const conclude = () => {
    git("add", "-A")
    git("commit", "--quiet", "--no-verify", "--no-edit")
    return git("rev-parse", "HEAD")
  }
  const on = (branch: string) => git("checkout", "--quiet", branch)
  git("init", "--quiet", "--initial-branch=canary")
  write("a.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n")
  write("old.ts", "keep one\nkeep two\n")
  commit("base")
  git("checkout", "--quiet", "-b", "pr")
  write("pr.ts", "export const pr = true\n")
  commit("pr: its own file")
  on("canary")
  write(
    "a.ts",
    "export const a = 1\nexport const b = 2\nexport const c = 3\nexport const canaryAdded = 4\n",
  )
  write("new.ts", "export const fresh = 5\n")
  commit("canary: a new line and a new file")
  on("pr")
  const merge = (...args: string[]) => {
    git("merge", "--quiet", "--no-edit", ...args, "canary")
    return git("rev-parse", "HEAD")
  }
  // What the gate reads: the squash GitHub would make, the head merged with canary.
  const lost = async () => {
    const head = git("rev-parse", "pr")
    const tree = git("merge-tree", "--write-tree", head, "canary").split("\n")[0]
    return lostLines(run, "canary", head, tree)
  }
  const done = () => rmSync(repo, { force: true, recursive: true })
  return { commit, conclude, done, git, lost, merge, on, repo, write }
}

describe("lostLines in a scratch repository", () => {
  test("a plain merge of canary loses nothing", async () => {
    const w = world()
    w.merge()
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("a head behind canary with no merge loses nothing", async () => {
    const w = world()
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("-s ours drops canary's new line and its new file, naming the merge and each file", async () => {
    const w = world()
    const ours = w.merge("-s", "ours")
    expect(await w.lost()).toEqual([
      { commit: ours, line: 4, path: "a.ts" },
      { commit: ours, line: 1, path: "new.ts" },
    ])
    w.done()
  })

  test("-s ours on a merge that conflicts is still caught in the files that merge clean", async () => {
    const w = world()
    w.on("canary")
    w.write("old.ts", "keep one\nkeep two, said canary\n")
    w.commit("canary: edits keep two")
    w.on("pr")
    w.write("old.ts", "keep one\nkeep two, said the PR\n")
    w.commit("pr: edits keep two")
    const ours = w.merge("-s", "ours")
    const lost = await w.lost()
    expect(lost).toContainEqual({ commit: ours, line: 4, path: "a.ts" })
    expect(lost).toContainEqual({ commit: ours, line: 1, path: "new.ts" })
    expect(typeof lost !== "string" && lost.some((l) => l.path === "old.ts")).toBe(false)
    w.done()
  })

  test("-X ours in a file that conflicts passes, since its author resolved that file by hand (the hook refuses the call)", async () => {
    const w = world()
    w.on("canary")
    w.write("old.ts", "keep one\nkeep two\nfunction canaryOnly() {\n  return 42\n}\n")
    w.commit("canary: a function after keep two")
    w.on("pr")
    w.write("old.ts", "keep one\nkeep two, said the PR\n")
    w.commit("pr: edits keep two")
    w.merge("-X", "ours")
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("a file whose name git quotes is named as it is", async () => {
    const w = world()
    w.on("canary")
    w.write("naïve.ts", "export const accent = true\n")
    w.commit("canary: a file git quotes")
    w.on("pr")
    const ours = w.merge("-s", "ours")
    expect(await w.lost()).toContainEqual({ commit: ours, line: 1, path: "naïve.ts" })
    w.done()
  })

  test("a file whose name holds a space is read, not passed as empty", async () => {
    const w = world()
    w.on("canary")
    w.write("my file.ts", "export const spaced = true\n")
    w.commit("canary: a file with a space in its name")
    w.on("pr")
    const ours = w.merge("-s", "ours")
    expect(await w.lost()).toContainEqual({ commit: ours, line: 1, path: "my file.ts" })
    w.done()
  })

  test("a line an ours merge dropped that canary has since deleted itself passes", async () => {
    const w = world()
    w.merge("-s", "ours")
    w.on("canary")
    w.write("a.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n")
    w.git("rm", "--quiet", "new.ts")
    w.commit("canary: drops its own new line and file")
    w.on("pr")
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("lines the PR's own commits remove after a plain merge pass", async () => {
    const w = world()
    w.merge()
    w.write("a.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n")
    w.commit("pr: drops canary's new line on purpose")
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("a line an ours merge dropped that the PR then brings back passes", async () => {
    const w = world()
    w.merge("-s", "ours")
    w.write(
      "a.ts",
      "export const a = 1\nexport const b = 2\nexport const c = 3\nexport const canaryAdded = 4\n",
    )
    w.write("new.ts", "export const fresh = 5\n")
    w.commit("pr: takes canary's lines back")
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("a line an ours merge dropped that the PR restores and then replaces is still lost (#1539)", async () => {
    const w = world()
    const ours = w.merge("-s", "ours")
    w.write(
      "a.ts",
      "export const a = 1\nexport const b = 2\nexport const c = 3\nexport const canaryAdded = 4\n",
    )
    w.write("new.ts", "export const fresh = 5\n")
    w.commit("pr: takes canary's lines back")
    w.write(
      "a.ts",
      "export const a = 1\nexport const b = 2\nexport const c = 3\nexport const replaced = 9\n",
    )
    w.commit("pr: replaces canary's line")
    expect(await w.lost()).toEqual([{ commit: ours, line: 4, path: "a.ts" }])
    w.done()
  })

  test("a rename by the PR loses nothing", async () => {
    const w = world()
    renameSync(join(w.repo, "old.ts"), join(w.repo, "kept.ts"))
    w.commit("pr: renames old.ts")
    w.merge()
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("an edit made in a merge passes as a rewrite, and one that drops canary's line is caught", async () => {
    const w = world()
    w.git("merge", "--quiet", "--no-commit", "canary")
    w.write(
      "a.ts",
      "export const a = 1\nexport const b = 2\nexport const c = 3\nexport const canaryAdded = 40\n",
    )
    w.conclude()
    expect(await w.lost()).toEqual([])
    w.done()
    const v = world()
    v.git("merge", "--quiet", "--no-commit", "canary")
    v.write("a.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n")
    const evil = v.conclude()
    expect(await v.lost()).toEqual([{ commit: evil, line: 4, path: "a.ts" }])
    v.done()
  })

  test("a modify and delete conflict resolved by the delete passes", async () => {
    const w = world()
    w.on("canary")
    w.write("old.ts", "keep one\nkeep two\nkeep three\n")
    w.commit("canary: adds keep three")
    w.on("pr")
    w.git("rm", "--quiet", "old.ts")
    w.commit("pr: deletes old.ts")
    w.merge()
    w.git("rm", "--quiet", "old.ts")
    w.conclude()
    expect(await w.lost()).toEqual([])
    w.done()
  })

  test("a git read that fails says why", async () => {
    const failing: Run = async () => ({ code: 128, stderr: "fatal", stdout: "" })
    expect(await lostLines(failing, "canary", "head", "tree")).toBe("git rev-list exited 128")
    expect(await lostLines(failing, "canary", "head", null)).toBe(
      "the head conflicts with canary, so its squash cannot be read",
    )
  })
})

describe("the pure parts", () => {
  test("hunksOf reads a deleted file's path from --- a/, not +++ /dev/null, and drops the tab after a spaced name", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-one",
      "--- two",
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -5 +5 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "diff --git a/my file.ts b/my file.ts",
      "--- a/my file.ts\t",
      "+++ b/my file.ts\t",
      "@@ -2 +1,0 @@",
      "-spaced",
    ].join("\n")
    expect(hunksOf(diff)).toEqual([
      {
        added: [],
        removed: [
          { content: "one", line: 1, path: "gone.ts" },
          { content: "-- two", line: 2, path: "gone.ts" },
        ],
      },
      { added: ["new"], removed: [{ content: "old", line: 5, path: "x.ts" }] },
      { added: [], removed: [{ content: "spaced", line: 2, path: "my file.ts" }] },
    ])
  })

  test("candidates leaves out blank lines, moves and rewrites", () => {
    const hunks = [
      {
        added: ["const total = sum(rows) + 1"],
        removed: [
          { content: "", line: 1, path: "f.ts" },
          { content: "const moved = 2", line: 3, path: "f.ts" },
          { content: "const total = sum(rows)", line: 4, path: "f.ts" },
          { content: "const lost = 3", line: 5, path: "f.ts" },
        ],
      },
      { added: ["const moved = 2"], removed: [] },
    ]
    expect(candidates(hunks)).toEqual([{ content: "const lost = 3", line: 5, path: "f.ts" }])
  })

  test("mergeTreeOf reads the tree and the conflicted files from merge-tree -z --name-only", () => {
    expect(mergeTreeOf("t1\0")).toEqual({ conflicted: new Set(), tree: "t1" })
    expect(
      mergeTreeOf("t2\0old.ts\0na ve.ts\0\x001\0old.ts\0CONFLICT (contents)\0Merge conflict\0"),
    ).toEqual({ conflicted: new Set(["old.ts", "na ve.ts"]), tree: "t2" })
  })

  test("unquote decodes git's C-quoted paths, bytes past ASCII included", () => {
    expect(unquote("a/plain.ts")).toBe("a/plain.ts")
    expect(unquote('"a/na\\303\\257ve.ts"')).toBe("a/naïve.ts")
    expect(unquote('"a/tab\\there \\"quoted\\" back\\\\slash"')).toBe(
      'a/tab\there "quoted" back\\slash',
    )
  })

  test("likeness is 1 for the same text, low for unrelated lines, and reads a long line word by word", () => {
    expect(likeness("abc", "abc")).toBe(1)
    expect(likeness("const total = sum(rows)", "const total = sum(rows) + 1")).toBeGreaterThan(0.8)
    expect(likeness("function canaryOnly() {", "keep two, said the PR")).toBeLessThan(0.8)
    const paragraph = Array.from({ length: 200 }, (_, k) => `word${k}`).join(" ")
    expect(likeness(paragraph, `${paragraph} and one more clause`)).toBeGreaterThan(0.8)
    expect(likeness(paragraph, paragraph.toUpperCase())).toBeLessThan(0.8)
  })
})
