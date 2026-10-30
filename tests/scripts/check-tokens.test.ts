import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { missing, tokens } from "../../scripts/check-tokens"

const script = join(import.meta.dir, "../../scripts/check-tokens.ts")

const OLD = [
  "# Skill",
  "",
  "- **ask**: post it with `dashboard:ask new`, then `dashboard:ask close` once it is settled.",
  "- ALWAYS: Do every change in its own git worktree, never on main.",
  "",
].join("\n")

describe("tokens: what a rewrite must keep", () => {
  test("takes backticks, bold names and an ALWAYS rule's first five words", () => {
    expect(tokens(OLD)).toEqual([
      { kind: "backtick", text: "dashboard:ask new" },
      { kind: "backtick", text: "dashboard:ask close" },
      { kind: "bold", text: "ask" },
      { kind: "rule", text: "ALWAYS: Do every change in its" },
    ])
  })

  test("a quoted phrase is no token", () => {
    expect(tokens('The ask ("keep it generic"), as a reviewer said "ship it".')).toEqual([])
  })
})

describe("missing: what a rewrite lost", () => {
  test("a rewrite that keeps every token, rewrapped, loses nothing", () => {
    const after = [
      "## ask",
      "Post every decision with `dashboard:ask new`, and settle it with `dashboard:ask close`; the **ask** rule.",
      "- ALWAYS: Do every change in its own worktree.",
    ].join("\n")
    expect(missing(OLD, after, "")).toEqual([])
  })

  test("a token the rewrite dropped is reported until a dropped: line names it", () => {
    const after =
      "Post with `dashboard:ask new`; **ask**. - ALWAYS: Do every change in its own tree."
    expect(missing(OLD, after, "")).toEqual([{ kind: "backtick", text: "dashboard:ask close" }])
    expect(missing(OLD, after, "| `dashboard:ask close` | dropped: said twice |")).toEqual([])
    expect(missing(OLD, after, "| `dashboard:ask close` | kept elsewhere |")).toEqual([
      { kind: "backtick", text: "dashboard:ask close" },
    ])
  })
})

describe("the command line", () => {
  const run = async (cwd: string, args: string[]) => {
    const proc = Bun.spawn(["bun", script, ...args], { cwd, stderr: "pipe", stdout: "pipe" })
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()
    return { code: await proc.exited, err, out }
  }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })

  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "check-tokens-"))
    git(dir, "init", "-q")
    writeFileSync(join(dir, "SKILL.md"), OLD)
    git(dir, "add", "SKILL.md")
    git(dir, "commit", "-q", "-m", "base")
    writeFileSync(join(dir, "ledger.md"), "")
    return dir
  }

  test("passes when the files still hold every token, a new file included", async () => {
    const dir = repo()
    writeFileSync(join(dir, "SKILL.md"), "# Skill\n\nSee REFERENCE.md.\n")
    writeFileSync(join(dir, "REFERENCE.md"), OLD)
    const result = await run(dir, ["HEAD", "ledger.md", "SKILL.md", "REFERENCE.md"])
    expect(result.code).toBe(0)
  })

  test("fails naming each lost token, and passes once the ledger drops it", async () => {
    const dir = repo()
    writeFileSync(
      join(dir, "SKILL.md"),
      OLD.replace(", then `dashboard:ask close` once it is settled", ""),
    )
    const lost = await run(dir, ["HEAD", "ledger.md", "SKILL.md"])
    expect(lost.code).toBe(1)
    expect(lost.out).toBe("backtick: dashboard:ask close\n")
    writeFileSync(
      join(dir, "ledger.md"),
      "- `dashboard:ask close`: dropped: the rule says it once\n",
    )
    expect((await run(dir, ["HEAD", "ledger.md", "SKILL.md"])).code).toBe(0)
  })

  test("refuses to run with no files, an unknown base or a missing ledger", async () => {
    const dir = repo()
    expect((await run(dir, ["HEAD", "ledger.md"])).code).toBe(2)
    expect((await run(dir, ["no-such-ref", "ledger.md", "SKILL.md"])).code).toBe(2)
    expect((await run(dir, ["HEAD", "nope.md", "SKILL.md"])).code).toBe(2)
  })
})
