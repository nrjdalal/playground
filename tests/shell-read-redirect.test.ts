import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// PG-1383: bash applies redirections left to right, so in `read -r l < "$f" 2>/dev/null` the < fails before 2>/dev/null takes effect and a missing file's error prints; every shell script puts 2>/dev/null first or wraps the read in { ...; } 2>/dev/null.
const ROOT = join(import.meta.dir, "..")

// An input redirect from a file (not <<, <<< or <(...)), then 2>/dev/null, with nothing that ends the command between them
const LATE = /(?<!<)<\s*(?:"[^"]*"|'[^']*'|[^\s<>()|;&]+)\s+2>\s*\/dev\/null/

const FIX = "put 2>/dev/null before the <, or wrap the read in { ...; } 2>/dev/null"

const lateReads = (text: string): number[] =>
  text.split("\n").flatMap((line, index) => (LATE.test(line) ? [index + 1] : []))

describe("a shell script's read of a file silences its own error", () => {
  test("no tracked .sh file puts 2>/dev/null after a read's <", async () => {
    const list = Bun.spawnSync(["git", "ls-files", "-z", "--", "*.sh"], { cwd: ROOT })
    if (list.exitCode !== 0) throw new Error(`git ls-files failed: ${list.stderr}`)
    const late: string[] = []
    for (const path of list.stdout.toString().split("\0").filter(Boolean))
      for (const line of lateReads(await Bun.file(join(ROOT, path)).text()))
        late.push(`${path}:${line}`)
    expect(late, `a missing file's error still prints at each of these: ${FIX}`).toEqual([])
  })

  test("refuses the old order and passes both fixes", () => {
    for (const line of [
      'read -r l < "$f" 2>/dev/null',
      'l=; read -r _ l _ < "$f" 2>/dev/null; case "$l" in',
      'mark=$(wc -l < "$RUNS" 2>/dev/null | tr -d " ")',
      "read -r l < $f 2> /dev/null",
      `said=$(tr -s '\\n' ' ' <"$said_file" 2>/dev/null || true)`,
      'exec 3< "$f" 2>/dev/null',
    ])
      expect(lateReads(line)).toEqual([1])
    for (const line of [
      'read -r l 2>/dev/null < "$f"',
      '{ read -r l < "$f"; } 2>/dev/null',
      "cat <<EOF 2>/dev/null",
      "while read -r l; do :; done < <(ls 2>/dev/null)",
      'grep x <<< "$v" 2>/dev/null',
    ])
      expect(lateReads(line)).toEqual([])
  })
})
