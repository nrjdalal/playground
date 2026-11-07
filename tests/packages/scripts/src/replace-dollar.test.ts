import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { dollarReplacements, FIX } from "../../../../packages/scripts/src/replace-dollar"

// Each pattern is built at run time, so this file's own lines hold none of the calls the repo scan below flags.
const pid = "$" + "$"
const match = "$" + "&"
const group = "$" + "1"

describe("dollarReplacements", () => {
  test("flags $$, $` and $' in any literal replacement, the 7 Nov run-slot.sh slip among them", () => {
    expect(dollarReplacements(`s.replace("a", "echo ${pid}")`)).toEqual([1])
    expect(dollarReplacements(`ok\ns.replaceAll(/a/g, 'x ${"$"}\` y')`)).toEqual([2])
    expect(dollarReplacements(`s.replace(MARK, \`mark-${pid}\`)`)).toEqual([1])
  })

  test("flags $& and $1 after a string search, which has no groups", () => {
    expect(dollarReplacements(`s.replace("a", "[${match}]")`)).toEqual([1])
    expect(dollarReplacements(`s.replace('a', "${group}")`)).toEqual([1])
  })

  test("leaves a regex's back-references, a named search, a replacer function and split(a).join(b)", () => {
    expect(dollarReplacements(`s.replace(/[.*]/g, "\\\\${match}")`)).toEqual([])
    expect(dollarReplacements(`s.replace(/(a)(b)/, "${group}-")`)).toEqual([])
    expect(dollarReplacements(`s.replace(RE, "${group}")`)).toEqual([])
    expect(dollarReplacements(`s.replace("a", () => "echo ${pid}")`)).toEqual([])
    expect(dollarReplacements(`s.split("a").join("echo ${pid}")`)).toEqual([])
  })

  test("reads a template's interpolation as code, not a pattern, beside a flagged $$", () => {
    expect(dollarReplacements('s.replace("a", `${x} and ${y.z(1)}`)')).toEqual([])
    expect(dollarReplacements(`s.replace("a", \`\${x} ${pid}\`)`)).toEqual([1])
  })

  test("reads a regex search whose class holds a slash or a comma", () => {
    expect(dollarReplacements(`s.replace(/[/,]x/g, "${pid}")`)).toEqual([1])
  })
})

describe("the repo", () => {
  test("holds no flagged replacement in its TypeScript", async () => {
    const root = join(import.meta.dir, "../../../..")
    const proc = Bun.spawn(["git", "ls-files", "--", "*.ts", "*.tsx", "*.mts"], {
      cwd: root,
      stdout: "pipe",
    })
    const files = (await new Response(proc.stdout).text()).split("\n").filter(Boolean)
    const flagged: string[] = []
    for (const path of files) {
      const text = await Bun.file(join(root, path)).text()
      for (const line of dollarReplacements(text)) flagged.push(`${path}:${line}: ${FIX}`)
    }
    expect(flagged).toEqual([])
  })
})
