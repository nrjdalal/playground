import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ops = join(import.meta.dir, "..", "..", "..", "scripts", "ops")
const scratch = mkdtempSync(join(tmpdir(), "ops-cmux-open-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The factory is herdr only: a script's argv and a plist's ProgramArguments both read as `open -a cmux`, `open -ga cmux` or `open cmux.app` once tags and quotes are dropped.
const opensCmux = (text: string) =>
  /\bopen\s+(?:-\S+\s+)*(?:-[a-z]*a\s+\S*cmux\b|\S*cmux\.app\b)/i.test(
    text.replace(/<[^>]+>|["'`,[\]()]/g, " "),
  )

// A repo folder lists only what git tracks, since the test is about what the repo runs and an ignored stale `.pyc` outlives its source; a scratch folder outside git lists every file
const tracked = (root: string) =>
  Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root })
    .stdout.toString()
    .split("\0")
    .filter(Boolean)
const every = (root: string) => Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true }))

const offenders = async (root: string, paths: string[]) => {
  const found: string[] = []
  for (const path of paths) {
    if (opensCmux(await Bun.file(join(root, path)).text())) found.push(path)
  }
  return found.sort()
}

test("nothing under scripts/ops opens cmux", async () => {
  expect(tracked(ops).length).toBeGreaterThan(0)
  expect(await offenders(ops, tracked(ops))).toEqual([])
})

test("a script or a launchd plist that opens cmux is found", async () => {
  writeFileSync(join(scratch, "watch.py"), 'code, out = run(["open", "-a", "cmux"])\n')
  writeFileSync(
    join(scratch, "com.x.watch.plist"),
    "<key>ProgramArguments</key>\n<array><string>/usr/bin/open</string><string>-a</string><string>cmux</string></array>\n",
  )
  writeFileSync(join(scratch, "tick.sh"), 'open -g -a "/Applications/cmux.app"\n')
  writeFileSync(join(scratch, "bg.sh"), "open -ga cmux\n")
  writeFileSync(join(scratch, "app.sh"), "open /Applications/cmux.app\n")
  writeFileSync(join(scratch, "herdr.sh"), "herdr pane open --label ops-a\n")
  writeFileSync(
    join(scratch, "notes.sh"),
    "open ~/Documents/cmux-notes.txt\nopen -a Safari ~/cmux/notes\n",
  )
  expect(await offenders(scratch, await every(scratch))).toEqual([
    "app.sh",
    "bg.sh",
    "com.x.watch.plist",
    "tick.sh",
    "watch.py",
  ])
})

test("an ignored file that opens cmux is not reported, a tracked one is", async () => {
  const repo = mkdtempSync(join(tmpdir(), "ops-cmux-open-repo-"))
  try {
    mkdirSync(join(repo, "cmux-watch", "__pycache__"), { recursive: true })
    writeFileSync(join(repo, ".gitignore"), "__pycache__/\n")
    writeFileSync(
      join(repo, "cmux-watch", "__pycache__", "watch.cpython-313.pyc"),
      "it runs `open -a cmux` once\n",
    )
    writeFileSync(join(repo, "tick.sh"), "open -ga cmux\n")
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: repo }).exitCode).toBe(0)
    expect(Bun.spawnSync(["git", "add", "."], { cwd: repo }).exitCode).toBe(0)
    expect(await offenders(repo, tracked(repo))).toEqual(["tick.sh"])
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})
