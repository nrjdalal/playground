import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { countTests, diff, KINDS, record } from "../../../../../packages/scripts/src/parity/record"
import { asRenamed, workingTree } from "../../../../../packages/scripts/src/parity/tree"

const hook = (script: string, matcher?: string) => ({
  ...(matcher ? { matcher } : {}),
  hooks: [{ command: `bun scripts/hooks/${script}.ts`, timeout: 15, type: "command" }],
})

const settings = (pre: object[], extra: object = {}) =>
  JSON.stringify({ autoCompactWindow: 400000, ...extra, hooks: { PreToolUse: pre } })

const TREE: Record<string, string> = {
  ".claude/settings.json": settings([
    hook("no-stash", "^Bash$"),
    hook("no-linear-ticket", "^Bash$"),
  ]),
  "AGENTS.md": "# AGENTS\n\n## Code\n\n- ALWAYS: Make the smallest change that meets it.\n",
  "scripts/briefs/new-reviewer.md": "# Reviewer\n\n- **signal**: only your own.\n",
  "scripts/briefs/new-worker.md": "# Worker\n\n- **signal**: only your own.\n",
  "scripts/factory-settings.json": settings([hook("no-stash", "^Bash$")], { env: { A: "1" } }),
  "scripts/spawn.sh": "WINDOW=400000\n  NOT_TOP=1\n",
  "extensions/core/skills/playbook/SKILL.md": "- **gate**: a PR merges through pr:merge.\n",
  "tests/a.test.ts": 'test("one", () => {})\ntest("two", () => {})\n',
  "tests/test_b.py": "def test_one():\n    pass\n",
}

// The fixture is written in the names from before the rename, and read as tree.ts reads a commit.
const files = (edits: Record<string, string | undefined> = {}) =>
  asRenamed(
    new Map(
      Object.entries({ ...TREE, ...edits }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  )

describe("countTests", () => {
  test("counts each test and it call by parse, skipping comments and strings", () => {
    const text = [
      'import { describe, expect, it, test } from "bun:test"',
      "// test('commented', () => {})",
      'const s = "test(\\"in a string\\", () => {})"',
      'describe("group", () => {',
      '  test("a", () => {})',
      '  it("b", async () => {}, 10_000)',
      '  test.if(true)("c", () => {})',
      '  test.skipIf(false)("d", () => {})',
      "})",
    ].join("\n")
    expect(countTests("tests/x.test.ts", text)).toBe(4)
  })

  test("counts a skip or a todo as no case, since neither runs", () => {
    expect(countTests("tests/x.test.ts", 'test.skip("a", () => {})\ntest.todo("b")\n')).toBe(0)
  })

  test("counts an each table by its rows, a named one included", () => {
    const text = [
      "const CASES = [1, 2, 3] as const",
      'test.each([["a"], ["b"]])("literal %s", () => {})',
      'test.each<{ n: number }>([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }])("typed", () => {})',
      'it.each(CASES)("named %d", () => {})',
      'test.each(load())("computed", () => {})',
    ].join("\n")
    expect(countTests("tests/x.test.ts", text)).toBe(2 + 4 + 3 + 1)
  })

  test("counts a Python file's test functions and check calls", () => {
    expect(countTests("tests/test_a.py", "def test_x():\n    pass\n\ncheck(1)\n  check(2)\n")).toBe(
      3,
    )
  })

  test("counts a Python file with neither by its public top-level functions", () => {
    expect(
      countTests("tests/test_a.py", "def _helper():\n    pass\n\ndef refuses():\n    fail()\n"),
    ).toBe(1)
  })
})

describe("record", () => {
  test("renders every kind, byte-stable and sorted", () => {
    const lines = record(files())
    expect(record(files())).toEqual(lines)
    expect([...lines].sort()).toEqual(lines)
    for (const kind of Object.keys(KINDS))
      expect(lines.some((l) => l.startsWith(`${kind}\t`))).toBe(true)
  })

  test("merges a kind's settings files, running a handler both register once", () => {
    const hooks = record(files()).filter((l) => l.startsWith("repo-worker\thook\t"))
    expect(hooks).toEqual([
      "repo-worker\thook\tPreToolUse ^Bash$ no-linear-ticket timeout=15",
      "repo-worker\thook\tPreToolUse ^Bash$ no-stash timeout=15",
    ])
    const company = record(files()).filter((l) => l.startsWith("outside-worker\thook\t"))
    expect(company).toEqual(["outside-worker\thook\tPreToolUse ^Bash$ no-stash timeout=15"])
  })

  test("names a kind's rule ids and effective values", () => {
    const lines = record(files())
    expect(lines).toContain("reviewer\trule\tAGENTS.md#ALWAYS: Make the smallest change that")
    expect(lines).toContain("reviewer\trule\tplaybook#gate")
    expect(lines).toContain("reviewer\tvalue\tspawn.sh: WINDOW=400000")
    expect(lines).toContain('reviewer\tvalue\tfactory-settings.json: env.A="1"')
    expect(lines.some((l) => l.includes("NOT_TOP"))).toBe(false)
  })

  test("a standing rule keeps its id when it moves from the glance into its own file under rules/", () => {
    const rules = (tree: Map<string, string>) =>
      record(tree).filter((l) => l.startsWith("reviewer\trule\tplaybook"))
    const moved = files({
      "extensions/core/skills/playbook/SKILL.md": "Skill.\n",
      "extensions/core/rules/gate.md": "A PR merges through pr:merge.\n",
    })
    expect(rules(moved)).toEqual(rules(files()))
    expect(rules(moved)).toEqual(["reviewer\trule\tplaybook#gate"])
  })

  test("a tree from before core took the factory's skill and its rules records the same lines", () => {
    const after = files({
      "extensions/core/rules/gate.md": "A PR merges through pr:merge.\n",
      "extensions/core/skills/playbook/SKILL.md": "Skill.\n",
    })
    const before = files({
      "extensions/core/skills/playbook/SKILL.md": undefined,
      "skills/playground/playground-factory/SKILL.md": "Skill.\n",
      "skills/playground/playground-factory/rules/gate.md": "A PR merges through pr:merge.\n",
    })
    expect(diff(record(before), record(after))).toEqual([])
  })

  test("marks an input a kind reads that the tree lacks", () => {
    const lines = record(files({ "scripts/briefs/new-reviewer.md": undefined }))
    expect(lines).toContain("reviewer\tmissing\tbriefs/new-reviewer.md")
  })

  test("goes red on an input both trees lack, since it hides every line it holds", () => {
    const lacking = files({ "scripts/briefs/new-reviewer.md": undefined })
    expect(diff(record(lacking), record(lacking))).toEqual([
      "+ reviewer\tmissing\tbriefs/new-reviewer.md",
    ])
  })

  test("finds an input moved to another folder by its tail", () => {
    const moved = files({
      "skills/engineering/playbook/SKILL.md": TREE["extensions/core/skills/playbook/SKILL.md"],
      "extensions/core/skills/playbook/SKILL.md": undefined,
    })
    expect(diff(record(files()), record(moved))).toEqual([])
  })
})

describe("diff", () => {
  test("is empty for a tree against itself", () => {
    expect(diff(record(files()), record(files()))).toEqual([])
  })

  test("goes red on a dropped test case or a deleted test file", () => {
    const dropped = files({
      "tests/a.test.ts": 'test("one", () => {})\n',
      "tests/test_b.py": undefined,
    })
    expect(diff(record(files()), record(dropped))).toEqual([
      "- tests\ttests/a.test.ts\t2 -> 1",
      "- tests\ttests/test_b.py\t1 -> gone",
    ])
  })

  test("stays empty when a test is added", () => {
    const added = files({
      "tests/a.test.ts": `${TREE["tests/a.test.ts"]}test("three", () => {})\n`,
    })
    expect(diff(record(files()), record(added))).toEqual([])
  })

  test("goes red on a changed hook, both ways", () => {
    const changed = files({
      ".claude/settings.json": settings([hook("no-stash", "^(Bash|Write)$")]),
      "scripts/factory-settings.json": settings([hook("no-stash", "^(Bash|Write)$")], {
        env: { A: "1" },
      }),
    })
    const lines = diff(record(files()), record(changed))
    expect(lines).toContain("- repo-worker\thook\tPreToolUse ^Bash$ no-linear-ticket timeout=15")
    expect(lines).toContain("- repo-worker\thook\tPreToolUse ^Bash$ no-stash timeout=15")
    expect(lines).toContain("+ repo-worker\thook\tPreToolUse ^(Bash|Write)$ no-stash timeout=15")
  })

  test("goes red on a changed value or a dropped rule", () => {
    const changed = files({
      "scripts/spawn.sh": "WINDOW=200000\n",
      "extensions/core/skills/playbook/SKILL.md": "",
    })
    const lines = diff(record(files()), record(changed))
    expect(lines).toContain("- dispatcher\tvalue\tspawn.sh: WINDOW=400000")
    expect(lines).toContain("+ dispatcher\tvalue\tspawn.sh: WINDOW=200000")
    expect(lines).toContain("- dispatcher\trule\tplaybook#gate")
  })
})

describe("the repo's own tree", () => {
  test("gives every kind its hooks and rules, with no input missing", async () => {
    const lines = record(await workingTree(join(import.meta.dir, "../../../../..")))
    expect(lines.filter((l) => l.split("\t")[1] === "missing")).toEqual([])
    for (const kind of Object.keys(KINDS))
      expect(lines.some((l) => l.startsWith(`${kind}\trule\t`))).toBe(true)
    for (const kind of Object.keys(KINDS))
      expect(lines.some((l) => l.startsWith(`${kind}\thook\t`))).toBe(true)
  })
})
