// Refuses a commit whose staged changes add a conflict marker line (`<<<<<<<` or `>>>>>>>`), read from the staged diff alone so it stays fast, and with `--push` a push whose commits add one; pre-commit runs it before lint-staged, whose formatter can rewrite a marker into Markdown that reads clean. `=======` alone is left out, since a setext heading can be one.

const MARKER = /^(?:<{7}|>{7})(?:[ \r]|$)/

// Each added line of a `git diff -U0` that is a conflict marker, as `<path>:<line>` in the staged file. A hunk's lines are counted from its header, so an added or removed line that starts with `++ ` or `-- ` is never read as a file header.
export const markersIn = (diff: string): string[] => {
  const found: string[] = []
  let path = ""
  let line = 0
  let removed = 0
  let added = 0
  for (const text of diff.split("\n")) {
    if (removed > 0 || added > 0) {
      if (text.startsWith("-")) removed--
      else if (text.startsWith("+")) {
        added--
        if (MARKER.test(text.slice(1))) found.push(`${path}:${line}`)
        line++
      }
      continue
    }
    if (text.startsWith("+++ ")) {
      path = text
        .slice(4)
        .replace(/\t$/, "")
        .replace(/^"?b\//, "")
        .replace(/"$/, "")
      continue
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text)
    if (hunk) {
      removed = Number(hunk[1] ?? 1)
      line = Number(hunk[2])
      added = Number(hunk[3] ?? 1)
    }
  }
  return found
}

// set here, since a committer's diff settings would change what is read: diff.noprefix or diff.mnemonicPrefix the b/ before each path, diff.interHunkContext context lines inside a hunk, a textconv driver the lines themselves
const DIFF = [
  "git",
  "-c",
  "core.quotePath=false",
  "diff",
  "-U0",
  "--inter-hunk-context=0",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
]

const ZERO = /^0+$/

const git = (args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { stderr: "pipe", stdout: "pipe" })
  return { code: result.exitCode, out: result.stdout.toString().trim() }
}

// Each pushed ref's range from git's pre-push lines (`<local ref> <local sha> <remote ref> <remote sha>`): from the remote sha when this clone has it, else from the merge-base with origin/canary for a new branch; a delete, or a ref with neither, reads nothing.
const pushRanges = (stdin: string): string[][] => {
  const ranges: string[][] = []
  for (const line of stdin.split("\n")) {
    const [, local, , remote] = line.trim().split(/\s+/)
    if (!local || ZERO.test(local)) continue
    const known =
      remote && !ZERO.test(remote) && git(["cat-file", "-e", `${remote}^{commit}`]).code === 0
    const base = known ? remote : git(["merge-base", local, "origin/canary"]).out
    if (base) ranges.push([base, local])
  }
  return ranges
}

if (import.meta.main) {
  const push = process.argv[2] === "--push"
  const found = new Set<string>()
  for (const range of push ? pushRanges(await Bun.stdin.text()) : [["--cached"]]) {
    const diff = Bun.spawnSync([...DIFF, ...range], { stderr: "pipe", stdout: "pipe" })
    if (diff.exitCode !== 0) {
      console.error(`conflict-markers: git diff failed: ${diff.stderr.toString().trim()}`)
      process.exit(1)
    }
    for (const at of markersIn(diff.stdout.toString())) found.add(at)
  }
  if (found.size === 0) process.exit(0)
  console.error(
    push
      ? `conflict-markers: the pushed commits hold conflict markers at ${[...found].join(", ")}: resolve each one, keeping the lines both sides need, then commit the fix and push again`
      : `conflict-markers: the staged changes hold conflict markers at ${[...found].join(", ")}: resolve each one, keeping the lines both sides need, then stage the file again`,
  )
  process.exit(1)
}
