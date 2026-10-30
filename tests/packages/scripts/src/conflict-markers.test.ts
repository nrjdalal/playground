import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { markersIn } from "../../../../packages/scripts/src/conflict-markers"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/conflict-markers.ts")
const DIR = mkdtempSync(join(tmpdir(), "conflict-markers-"))

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

// nothing from this machine's git settings: git exports GIT_DIR into hooks, and a global config could add an external diff or colour
const ENV: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("GIT_"),
    ),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
}

const diffOf = (path: string, start: number, lines: string[]) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},0 +${start},${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n")

describe("markersIn", () => {
  test.each<{ $label: string; diff: string; found: string[] }>([
    {
      $label: "an ours marker with its label",
      diff: diffOf("a.md", 3, ["<<<<<<< HEAD", "kept"]),
      found: ["a.md:3"],
    },
    {
      $label: "a theirs marker at the end of a hunk",
      diff: diffOf("src/b.ts", 10, ["x", ">>>>>>> origin/canary"]),
      found: ["src/b.ts:11"],
    },
    { $label: "a bare marker", diff: diffOf("c.md", 1, ["<<<<<<<"]), found: ["c.md:1"] },
    {
      $label: "a bare marker in a CRLF file",
      diff: diffOf("crlf.md", 4, ["<<<<<<<\r", ">>>>>>> canary\r"]),
      found: ["crlf.md:4", "crlf.md:5"],
    },
    {
      $label: "the middle separator alone, which a setext heading can be",
      diff: diffOf("d.md", 2, ["Title", "======="]),
      found: [],
    },
    {
      $label: "eight angle brackets, which git never writes",
      diff: diffOf("e.md", 1, ["<<<<<<<< x"]),
      found: [],
    },
    {
      $label: "a marker in the middle of a line",
      diff: diffOf("f.ts", 1, ['const s = "<<<<<<< HEAD"']),
      found: [],
    },
    {
      $label: "a marker on a removed line",
      diff: ["--- a/g.md", "+++ b/g.md", "@@ -4,1 +3,0 @@", "-<<<<<<< HEAD"].join("\n"),
      found: [],
    },
    {
      $label: "an added line that starts with ++, which reads as a file header",
      diff: diffOf("a.md", 1, ["++ c", "<<<<<<< HEAD"]),
      found: ["a.md:2"],
    },
    {
      $label: "a removed -- line then an added ++ line, which read as a header pair",
      diff: [
        "--- a/h.md",
        "+++ b/h.md",
        "@@ -1,1 +1,2 @@",
        "--- old",
        "+++ new",
        "+>>>>>>> canary",
      ].join("\n"),
      found: ["h.md:2"],
    },
    {
      $label: "a path holding a space, whose header git ends with a tab",
      diff: ["--- a/s p.md\t", "+++ b/s p.md\t", "@@ -0,0 +6 @@", "+<<<<<<< HEAD"].join("\n"),
      found: ["s p.md:6"],
    },
    {
      $label: "a hunk header with no counts, one line each side",
      diff: ["--- a/i.md", "+++ b/i.md", "@@ -3 +3 @@", "-x", "+<<<<<<< HEAD"].join("\n"),
      found: ["i.md:3"],
    },
  ])("$label", ({ diff, found }) => {
    expect(markersIn(diff)).toEqual(found)
  })

  test("counts lines across hunks and files", () => {
    const diff = [
      diffOf("a.md", 2, ["one", "<<<<<<< HEAD"]),
      "@@ -9,0 +20,2 @@",
      "+two",
      "+>>>>>>> canary",
      diffOf("b.md", 5, [">>>>>>> canary"]),
    ].join("\n")
    expect(markersIn(diff)).toEqual(["a.md:3", "a.md:21", "b.md:5"])
  })
})

// the script, run as lefthook runs it, against a scratch repo's staged changes
describe("the pre-commit step", () => {
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: DIR, env: ENV, stdin: "ignore" })
    return { code: result.exitCode, err: result.stderr.toString() }
  }
  const git = (...args: string[]) =>
    run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args])

  test("refuses staged markers by file and line, and passes once resolved", async () => {
    expect(git("init", "-q")).toMatchObject({ code: 0 })
    await Bun.write(join(DIR, "notes.md"), "one\ntwo\n")
    expect(git("add", "notes.md")).toMatchObject({ code: 0 })
    expect(git("commit", "-q", "-m", "base")).toMatchObject({ code: 0 })

    await Bun.write(
      join(DIR, "notes.md"),
      "one\n<<<<<<< HEAD\ntwo\n=======\nthree\n>>>>>>> canary\n",
    )
    // an unstaged marker is not this commit's
    expect(run(["bun", "--no-env-file", SCRIPT])).toEqual({ code: 0, err: "" })

    expect(git("add", "notes.md")).toMatchObject({ code: 0 })
    const refused = run(["bun", "--no-env-file", SCRIPT])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain("notes.md:2, notes.md:6")

    // a committer's own diff settings leave each path and line as staged: prefixes (one under a folder named b included), hunks joined across context, and a textconv driver that would print the file as something else
    await Bun.write(join(DIR, "b/n.md"), "<<<<<<< HEAD\n")
    expect(git("add", "b/n.md")).toMatchObject({ code: 0 })
    await Bun.write(join(DIR, ".git/info/attributes"), "*.md diff=hide\n")
    for (const [setting, value] of [
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
      ["diff.interHunkContext", "3"],
      ["diff.hide.textconv", "true"],
    ] as const) {
      expect(git("config", setting, value)).toMatchObject({ code: 0 })
      expect(run(["bun", "--no-env-file", SCRIPT]).err).toContain(
        " at b/n.md:1, notes.md:2, notes.md:6:",
      )
      expect(git("config", "--unset", setting)).toMatchObject({ code: 0 })
    }
    expect(git("rm", "-q", "-f", "b/n.md")).toMatchObject({ code: 0 })

    await Bun.write(join(DIR, "notes.md"), "one\ntwo\nthree\n")
    expect(git("add", "notes.md")).toMatchObject({ code: 0 })
    expect(run(["bun", "--no-env-file", SCRIPT])).toEqual({ code: 0, err: "" })
  }, 30_000)
})
