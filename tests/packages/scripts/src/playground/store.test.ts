import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseWords, runStore, type Io } from "../../../../../packages/scripts/src/playground/store"
import { mustGit, writeFiles } from "../../../../../packages/settings/src/folder"
import { GUARD_LISTS, scopeDir } from "../../../../../packages/settings/src/rendered"

const scratch = mkdtempSync(join(tmpdir(), "playground-store-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

describe("parseWords", () => {
  test("positional words, options with their values, a repeated option in order and a bare flag", () => {
    expect(
      parseWords(
        ["doc", "owner", "a", "--attach", "x.png", "--attach", "y.png", "--dry-run"],
        ["--dry-run"],
      ),
    ).toEqual({
      options: { "--attach": ["x.png", "y.png"], "--dry-run": [""] },
      positional: ["doc", "owner", "a"],
    })
  })
})

describe("playground ext", () => {
  const folder = (name: string) => {
    const at = join(scratch, name)
    mkdirSync(join(at, "extensions"), { recursive: true })
    writeFileSync(join(at, "extensions", "login"), "tester\n")
    return at
  }
  const ext = async (at: string, words: string[], stdin = "") => {
    const out: string[] = []
    const err: string[] = []
    const io: Io = {
      data: at,
      out: (l) => out.push(l),
      stdin: async () => stdin,
      write: Bun.write,
    }
    const code = await runStore("ext", words, io, (l) => err.push(l))
    return { code, err: err.join("\n"), out: out.join("\n") }
  }
  const git = (at: string, scope: string, args: string[]) => mustGit(scopeDir(at, scope), args)

  test("put writes a rule's body as a proposal and each attachment by its hash, one commit with the reason, which a 5 accepts", async () => {
    const at = folder("put")
    writeFileSync(join(scratch, "rule.md"), "Keep it short.\n")
    writeFileSync(join(scratch, "shot.png"), Buffer.from([1, 2, 3]))
    const put = await ext(at, [
      "put",
      "tester",
      "rule",
      "short",
      join(scratch, "rule.md"),
      "--reason",
      "shorter replies",
      "--attach",
      join(scratch, "shot.png"),
    ])
    expect(put.code).toBe(0)
    const { rev, state } = JSON.parse(put.out) as { rev: string; state: string }
    expect(state).toBe("proposed")
    const hash = new Bun.CryptoHasher("sha256").update(Buffer.from([1, 2, 3])).digest("hex")
    expect(git(at, "tester", ["ls-files"]).split("\n")).toEqual([
      `attachments/${hash}.png`,
      "proposed/rules/short.md",
    ])
    expect(git(at, "tester", ["log", "-1", "--format=%an|%s"])).toBe("owner|shorter replies")
    const stale = await ext(at, [
      "score",
      "tester",
      "rule",
      "short",
      "0000000",
      "5",
      "--reason",
      "r",
    ])
    expect(stale).toMatchObject({ code: 1 })
    expect(stale.err).toContain("409 the proposal is at")
    const scored = await ext(at, [
      "score",
      "tester",
      "rule",
      "short",
      rev,
      "5",
      "--reason",
      "clear",
      "--by",
      "rev-x",
    ])
    expect(scored.out).toBe(`rev ${git(at, "tester", ["rev-parse", "HEAD"])} is accepted`)
    expect(readFileSync(join(scopeDir(at, "tester"), "rules/short.md"), "utf8")).toBe(
      "Keep it short.\n",
    )
    const why = JSON.parse((await ext(at, ["why", "tester", "rule", "short"])).out) as {
      reason: string
    }[]
    expect(why.map((entry) => entry.reason)).toEqual(["clear", "shorter replies"])
  })

  test("a skill is put from its folder, a list from its JSON and accepted at once, and - reads stdin", async () => {
    const at = folder("kinds")
    mkdirSync(join(scratch, "skill", "refs"), { recursive: true })
    writeFileSync(join(scratch, "skill", "SKILL.md"), "# s\n")
    writeFileSync(join(scratch, "skill", "refs", "a.md"), "a\n")
    writeFileSync(join(scratch, "terms.json"), '["b","a"]')
    expect(
      (await ext(at, ["put", "tester", "skill", "s", join(scratch, "skill"), "--reason", "r"]))
        .code,
    ).toBe(0)
    const list = await ext(at, [
      "put",
      "acme",
      "list",
      "terms",
      join(scratch, "terms.json"),
      "--reason",
      "r",
    ])
    expect(JSON.parse(list.out)).toMatchObject({ state: "accepted" })
    expect(
      (await ext(at, ["put", "tester", "doc", "notes", "-", "--reason", "r"], "from stdin\n")).code,
    ).toBe(0)
    expect(git(at, "tester", ["ls-files"]).split("\n")).toEqual([
      "proposed/docs/notes.md",
      "proposed/skills/s/SKILL.md",
      "proposed/skills/s/refs/a.md",
    ])
    const shown = JSON.parse((await ext(at, ["show", "tester", "skill", "s"])).out)
    expect(shown).toMatchObject({
      content: { files: { "SKILL.md": "# s\n", "refs/a.md": "a\n" } },
      state: "proposed",
    })
    expect(JSON.parse((await ext(at, ["list", "--scope", "acme"])).out)).toEqual([
      {
        accepted: true,
        key: "terms",
        kind: "list",
        proposed: false,
        readOnly: false,
        scope: "acme",
      },
    ])
    expect(
      (
        await ext(at, [
          "put",
          "acme",
          "list",
          "terms",
          join(scratch, "terms.json"),
          "--reason",
          "r",
        ])
      ).err,
    ).toContain("409 the item already holds this content")
  })

  // core ships with the checkout, so list shows its items beside the scopes' own, marked read-only; a folder's .gitkeep only keeps an empty folder in git, so it is no item.
  test("list shows core's items marked read-only, and skips a .gitkeep", async () => {
    const at = folder("list-core")
    writeFiles(
      at,
      "acme",
      new Map([
        ["proposed/templates/.gitkeep", ""],
        ["templates/.gitkeep", ""],
        ["templates/welcome.md", "Hi.\n"],
      ]),
      { author: "owner", reason: "an empty folder kept, and a template" },
    )
    expect(JSON.parse((await ext(at, ["list", "--scope", "acme"])).out)).toEqual([
      {
        accepted: true,
        key: "welcome",
        kind: "template",
        proposed: false,
        readOnly: false,
        scope: "acme",
      },
    ])
    const core = JSON.parse((await ext(at, ["list", "--scope", "core", "--kind", "skill"])).out)
    expect(core).toContainEqual({
      accepted: true,
      key: "code-review-loop",
      kind: "skill",
      proposed: false,
      readOnly: true,
      scope: "core",
    })
    expect(core.every((row: { readOnly: boolean }) => row.readOnly)).toBe(true)
  })

  test("why with a skill's name prints the copy a session loads and the scopes whose copies it shadows", async () => {
    const at = folder("why-skill")
    writeFiles(at, "tester", new Map([["skills/code-review-loop/SKILL.md", "# mine\n"]]), {
      author: "owner",
      reason: "my own review loop",
    })
    const io: Io = { data: at, out: () => {}, stdin: async () => "", write: Bun.write }
    const set = ["set", "ext.order", "[]", "--reason", "a policy to resolve by"]
    expect(await runStore("settings", set, io, () => {})).toBe(0)
    const why = await ext(at, ["why", "code-review-loop"])
    expect(why.code).toBe(0)
    expect(JSON.parse(why.out)).toEqual({
      dir: join(scopeDir(at, "tester"), "skills", "code-review-loop"),
      from: "tester",
      shadowed: ["core"],
    })
    expect(JSON.parse((await ext(at, ["why", "tdd"])).out)).toMatchObject({
      from: "core",
      shadowed: [],
    })
    expect((await ext(at, ["why", "no-such-skill"])).err).toContain(
      "no scope holds the skill no-such-skill",
    )
  })

  test("which with a skill's name prints only the folder of the copy a session loads, and exits 2 on a name no scope holds", async () => {
    const at = folder("which-skill")
    writeFiles(at, "tester", new Map([["skills/code-review-loop/SKILL.md", "# mine\n"]]), {
      author: "owner",
      reason: "my own review loop",
    })
    const io: Io = { data: at, out: () => {}, stdin: async () => "", write: Bun.write }
    const set = ["set", "ext.order", "[]", "--reason", "a policy to resolve by"]
    expect(await runStore("settings", set, io, () => {})).toBe(0)
    expect(await ext(at, ["which", "code-review-loop"])).toMatchObject({
      code: 0,
      out: join(scopeDir(at, "tester"), "skills", "code-review-loop"),
    })
    const missing = await ext(at, ["which", "no-such-skill"])
    expect(missing.code).toBe(2)
    expect(missing.err).toContain("no scope holds the skill no-such-skill")
    expect((await ext(at, ["which"])).code).toBe(2)
  })

  test("search finds the words in accepted items, and diff shows an item's change between two commits", async () => {
    const at = folder("search")
    writeFileSync(join(scratch, "one.json"), '["first"]')
    writeFileSync(join(scratch, "two.json"), '["first","xylograph"]')
    const first = JSON.parse(
      (
        await ext(at, [
          "put",
          "tester",
          "list",
          "words",
          join(scratch, "one.json"),
          "--reason",
          "a",
        ])
      ).out,
    )
    const second = JSON.parse(
      (
        await ext(at, [
          "put",
          "tester",
          "list",
          "words",
          join(scratch, "two.json"),
          "--reason",
          "b",
        ])
      ).out,
    )
    const found = JSON.parse((await ext(at, ["search", "xylograph"])).out) as {
      key: string
      scope: string
    }[]
    expect(found).toMatchObject([{ key: "words", kind: "list", scope: "tester" }])
    const diff = await ext(at, [
      "diff",
      "tester",
      "list",
      "words",
      "--from",
      first.rev,
      "--to",
      second.rev,
    ])
    expect(diff.out.split("\n")).toContain('+  "xylograph"')
  })

  test("export clones each scope into a new folder, refuses one that holds anything, and import brings it to another machine", async () => {
    const at = folder("export")
    writeFileSync(join(scratch, "x.json"), '["x"]')
    await ext(at, ["put", "acme", "list", "x", join(scratch, "x.json"), "--reason", "r"])
    const into = join(scratch, "exported")
    expect((await ext(at, ["export", into])).out).toBe(`exported acme to ${join(into, "acme")}`)
    expect((await ext(at, ["export", into])).err).toContain("is not empty")
    const other = folder("import")
    const dry = await ext(other, ["import", into, "--dry-run"])
    expect(dry.out).toBe("+ acme: new, 1 files")
    expect(existsSync(scopeDir(other, "acme"))).toBe(false)
    expect((await ext(other, ["import", into])).code).toBe(0)
    expect(git(other, "acme", ["rev-parse", "HEAD"])).toBe(git(at, "acme", ["rev-parse", "HEAD"]))
  })

  test("import --from-tree puts each guard's list file into the login's lists in one commit, derives the hooks, and names the ones it lacks", async () => {
    const at = folder("tree")
    const tree = join(scratch, "tree")
    mkdirSync(tree, { recursive: true })
    const [first, ...rest] = GUARD_LISTS
    writeFileSync(join(tree, `${first}.json`), '["made-up"]')
    const r = await ext(at, ["import", "--from-tree", tree])
    expect(r.code).toBe(0)
    expect(r.out.split("\n")).toEqual([
      `+ list tester ${first} from ${join(tree, `${first}.json`)}`,
      ...rest.map(
        (name) =>
          `- ${name}: no ${join(tree, `${name}.json`)}; add it with playground ext put tester list ${name} <file> --reason <why>`,
      ),
      `committed ${git(at, "tester", ["rev-parse", "HEAD"]).slice(0, 12)}`,
    ])
    expect(
      JSON.parse(readFileSync(join(at, "extensions", "hooks", `${first}.json`), "utf8")),
    ).toEqual(["made-up"])
  })

  test("a command it does not have is a usage error", async () => {
    const r = await ext(folder("usage"), ["merge", "tester", "rule", "short"])
    expect(r.code).toBe(2)
    expect(r.err).toStartWith("playground ext: no ext command merge\nusage: playground ext")
  })
})
