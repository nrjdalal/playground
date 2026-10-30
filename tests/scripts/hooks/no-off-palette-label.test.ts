import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check, TAILWIND_500 } from "../../../scripts/hooks/no-off-palette-label"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-off-palette-label.ts")
const scratch = mkdtempSync(join(tmpdir(), "no-off-palette-label-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const input = (command: string) =>
  JSON.stringify({
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  })
const bash = (command: string) => check(input(command))
const mcp = (toolInput: Record<string, unknown>) =>
  check(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_input: { name: "audit", owner: "acme-owner", repo: "dispatcher", ...toolInput },
      tool_name: "mcp__github__label_write",
    }),
  )
const HEXES = Object.values(TAILWIND_500)

test("the palette is Tailwind's 22 hues at 500", () => {
  expect(Object.keys(TAILWIND_500)).toHaveLength(22)
  expect(TAILWIND_500.orange).toBe("f97316")
  expect(TAILWIND_500.stone).toBe("78716c")
})

describe("a label written in a Tailwind 500 runs", () => {
  test.each(HEXES)(
    "gh label create and edit with %s, in any case, with or without #",
    async (hex) => {
      for (const color of [hex, hex.toUpperCase(), `"#${hex}"`, `'#${hex.toUpperCase()}'`]) {
        expect(await bash(`gh label create audit --color ${color} -R acme/archive`)).toBeUndefined()
        expect(await bash(`gh label edit audit -c ${color}`)).toBeUndefined()
        expect(await bash(`gh label create audit --color=${color} -d "x"`)).toBeUndefined()
      }
    },
  )

  test.each(HEXES)("gh api and the MCP tool with %s", async (hex) => {
    expect(
      await bash(`gh api repos/acme/archive/labels -f name=audit -f color=${hex.toUpperCase()}`),
    ).toBeUndefined()
    expect(await bash(`gh api -X PATCH repos/o/r/labels/audit -f color=#${hex}`)).toBeUndefined()
    expect(await mcp({ color: hex, method: "create" })).toBeUndefined()
    expect(await mcp({ color: `#${hex}`, method: "update" })).toBeUndefined()
  })
})

describe("a label write in any other color is refused, naming the 22 hexes", () => {
  test.each([
    "gh label create audit --color d93f0b",
    "gh label create audit -c ededed -R acme/archive",
    "gh label create audit --color=#dc2626",
    "gh label edit audit --color 0e8a16",
    "gh -R acme/archive label edit audit -c FBCA04 -d x",
    "env GH_REPO=o/r gh label create audit -c d93f0b",
    "gh api repos/acme/archive/labels -f name=audit -f color=d93f0b",
    "gh api -X POST /repos/o/r/labels -F name=audit -F color=ededed",
    "gh api --method PATCH repos/o/r/labels/audit -f color=d93f0b",
    "gh api https://api.github.com/repos/o/r/labels -f name=a -f color=red",
    "G=gh; $G label create audit -c ededed",
  ])("%s", async (command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-off-palette-label hook refused")
    for (const [name, hex] of Object.entries(TAILWIND_500))
      expect(reason).toContain(`${name} ${hex}`)
  })

  test("the MCP tool's create and update", async () => {
    expect(await mcp({ color: "d93f0b", method: "create" })).toContain("refused")
    expect(await mcp({ color: "ededed", method: "update" })).toContain("refused")
    expect(await mcp({ color: 3, method: "create" })).toContain("refused")
  })

  test("a JSON body sent with --input", async () => {
    const body = join(scratch, "label.json")
    writeFileSync(body, JSON.stringify({ color: "d93f0b", name: "audit" }))
    expect(await bash(`gh api repos/o/r/labels --input ${body}`)).toContain("refused")
    writeFileSync(body, JSON.stringify({ color: "f97316", name: "audit" }))
    expect(await bash(`gh api repos/o/r/labels --input ${body}`)).toBeUndefined()
  })
})

describe("a create with no color is refused, since GitHub picks one", () => {
  test.each([
    "gh label create audit",
    'gh label create audit -d "canary audit" -R acme/archive',
    "gh label create audit --force",
    "gh label create audit --color #f97316",
    'gh label create audit --color ""',
    "gh api repos/o/r/labels -f name=audit",
  ])("%s", async (command) => {
    expect(await bash(command)).toContain("no color")
  })

  test("the MCP tool's create", async () => {
    expect(await mcp({ method: "create" })).toContain("no color")
  })
})

describe("an edit with no color runs, since it keeps the label's color", () => {
  test.each([
    'gh label edit audit -d "new text"',
    "gh label edit audit --name audit-2",
    "gh api -X PATCH repos/o/r/labels/audit -f description=x",
  ])("%s", async (command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("the MCP tool's update and delete", async () => {
    expect(await mcp({ method: "update", new_name: "audit-2" })).toBeUndefined()
    expect(await mcp({ method: "delete" })).toBeUndefined()
  })
})

describe("a color the hook cannot read is refused, with the fix", () => {
  test.each([
    "gh label create audit --color $C",
    'gh api repos/o/r/labels -f name=a -f color="$C"',
    "gh api repos/o/r/labels --input $F",
    "gh label edit audit --color $C",
    "gh api -X PATCH repos/o/r/labels/audit --input $F",
  ])("%s", async (command) => {
    const reason = await bash(command)
    expect(reason).toContain("cannot read its color")
    expect(reason).toContain("literally")
  })

  test("an edit body that is not JSON, or whose color is not text", async () => {
    const body = join(scratch, "edit.json")
    for (const text of ["color=d93f0b", JSON.stringify({ color: 123 })]) {
      writeFileSync(body, text)
      expect(await bash(`gh api -X PATCH repos/o/r/labels/audit --input ${body}`)).toContain(
        "cannot read its color",
      )
    }
  })

  test.each([3, null])("label_write update with color %p", async (color) => {
    expect(await mcp({ color, method: "update" })).toContain("cannot read its color")
  })
})

describe("every other call runs", () => {
  test.each([
    "gh label list",
    "gh label delete audit --yes",
    "gh label clone acme/zerostarter",
    "gh api repos/o/r/labels",
    "gh api repos/o/r/labels/audit",
    "gh api -X DELETE repos/o/r/labels/audit",
    "gh api repos/o/r/issues/1/labels -f 'labels[]=audit'",
    "gh pr create --label audit --title x --body y",
    "gh issue edit 1 --add-label audit",
    "echo gh label create audit --color d93f0b",
    "grep -rn 'label create' scripts",
  ])("%s", async (command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("another MCP tool and input it cannot read", async () => {
    expect(
      await check(
        JSON.stringify({
          tool_input: { color: "d93f0b", name: "x" },
          tool_name: "mcp__github__get_label",
        }),
      ),
    ).toBeUndefined()
    expect(await check("not json")).toBeUndefined()
  })
})

test("the script exits 2 with the reason on stderr", async () => {
  const proc = Bun.spawn(["bun", "--no-env-file", script], {
    stderr: "pipe",
    stdin: new Blob([input("gh label create audit --color d93f0b")]),
  })
  expect(await proc.exited).toBe(2)
  expect(await new Response(proc.stderr).text()).toContain("no-off-palette-label hook refused")
})

// The hook guards a session's own calls; this pins the colors the repo's code creates labels in.
test("every label color the repo's code creates is a Tailwind 500", async () => {
  const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root }).stdout.toString()
  const files = listed
    .split("\0")
    .filter(
      (f) =>
        /\.(?:go|js|mjs|py|sh|ts|tsx|ya?ml)$/.test(f) &&
        !f.startsWith("tests/") &&
        !f.startsWith("scripts/hooks/"),
    )
  const colors: string[] = []
  for (const file of files) {
    const text = await Bun.file(join(root, file)).text()
    if (!/createLabel|label create|label edit|["'`]\/labels["'`]|\/labels\/\$\{/.test(text))
      continue
    // in a file that creates labels, every quoted hex and every flag or key named color is read as a label color
    for (const m of text.matchAll(
      /(?:\bcolor["']?\s*[:=]\s*|--color[ =]|-c )["'`]?#?([0-9a-fA-F]{6})\b|["'`]#?([0-9a-fA-F]{6})["'`]/g,
    ))
      colors.push(`${file}: ${(m[1] ?? m[2]).toLowerCase()}`)
  }
  expect(colors).toContain("packages/scripts/src/audit-canary.ts: f97316")
  expect(colors).toContain(".github/workflows/auto-labeler.yml: a855f7")
  for (const found of colors) expect(HEXES).toContain(found.split(": ")[1])
})
