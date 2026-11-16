// The macOnly count: each call in the repo's code to a program or form that macOS alone has, with no Linux branch in front of it, so the ratchet stops a new one landing now the factory also runs on Linux. It is no private trace, so it stays out of kinds.ts, whose patterns no-public-leak refuses.
import type { File } from "./count"

// Each Mac-only call as its words, A to Z: a shell line runs them space-separated, and an argv names each as its own quoted string.
const PROGRAMS = [
  ["brew", "install"],
  ["caffeinate"],
  ["cp", "-c"],
  ["launchctl"],
  ["memory_pressure"],
  ["open", "-a"],
  ["osascript"],
  ["pmset"],
  ["security", "find-generic-password"],
  ["sysctl", "-n"],
  ["top", "-l"],
  ["vm_stat"],
]

// Where a shell line starts a command: the line's start, after an operator or `$(`, a backtick, or a word that runs the next one.
const SHELL_HEAD = String.raw`(?<=(?:^|[;&|{\x60!]|\$\(|\b(?:command|do|elif|else|env|exec|if|nohup|sudo|then|time|xargs))\s*["']?)`
const SHELL_CALL = new RegExp(
  `${SHELL_HEAD}(?:${PROGRAMS.map((words) => words.join(String.raw`\s+`)).join("|")})(?=\\s|$|[;&)])`,
)
// An argv's head: the program's name as a whole quoted string, first in an array or a call's first argument (`["vm_stat"`, `Bun.which("osascript"`).
const ARGV_CALL = new RegExp(
  `(?<=[[(]\\s*)(?:${PROGRAMS.map((words) => words.map((word) => `["'\x60]${word}["'\x60]`).join(String.raw`\s*,\s*`)).join("|")})`,
)

const CODE = /\.(?:[cm]?[jt]sx?|py|sh)$/
const SHELL = /\.sh$/
const COMMENT = /^\s*(?:\/\/|\/?\*|#)/
// A test of the platform: a shell's uname or OSTYPE, Node's or Python's platform, or a branch named for macOS or Linux (`Darwin)`, `darwin:`, `linux ?`).
const PLATFORM = /\buname\b|\bOSTYPE\b|\bplatform\b|\bdarwin\b|\blinux\b/i
// A line that leaves its block, so an earlier platform test there takes Linux another way (`[ "$OS" = Darwin ] || return 1`).
const LEAVES = /\b(?:continue|exit|return|throw)\b/

const indent = (line: string): number => line.length - line.trimStart().length

// Whether a Linux branch covers line i: its own line or an enclosing block's opening line tests the platform, or an earlier line of one of those blocks tests it and leaves; a top-level line's earlier lines are never read, so one test at a file's top guards nothing below it.
const guarded = (lines: string[], i: number): boolean => {
  if (PLATFORM.test(lines[i]!)) return true
  let depth = indent(lines[i]!)
  for (let j = i - 1; j >= 0 && depth > 0; j--) {
    const line = lines[j]!
    if (!line.trim() || COMMENT.test(line)) continue
    const at = indent(line)
    if (at < depth) {
      if (PLATFORM.test(line)) return true
      depth = at
    } else if (at === depth && PLATFORM.test(line) && LEAVES.test(line)) return true
  }
  return false
}

// Whether a file is code the count reads: a source or script by its extension or its shebang, outside tests/ and this file, which hold these names as data.
const isCode = ({ path, text }: File): boolean =>
  (CODE.test(path) || text.startsWith("#!")) &&
  !path.startsWith("tests/") &&
  path !== "packages/scripts/src/trace-count/mac-only.ts"

// The 0-based lines of a file that hold a counted call: a call at a command or argv head, on a line that is no comment, with no Linux branch in front of it.
export const macOnlyLines = (file: File): number[] => {
  if (!isCode(file)) return []
  const shell = SHELL.test(file.path) || /^#!.*\b(?:ba|z)?sh\b/.test(file.text)
  const lines = file.text.split("\n")
  return lines.flatMap((line, i) =>
    !COMMENT.test(line) &&
    ((shell && SHELL_CALL.test(line)) || ARGV_CALL.test(line)) &&
    !guarded(lines, i)
      ? [i]
      : [],
  )
}

// Each counted call as path:line: macOnly, the changed files' alone when they hold one, as located names the other kinds.
export const macOnlyAt = (files: File[], changed: string[] = []): string[] => {
  const at = (from: File[]) =>
    from.flatMap((file) => macOnlyLines(file).map((i) => `${file.path}:${i + 1}: macOnly`))
  const own = at(files.filter((file) => changed.includes(file.path)))
  return own.length > 0 ? own : at(files)
}
