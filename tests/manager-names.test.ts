import { expect, test } from "bun:test"
import { join } from "node:path"

import { OLD, OLD_SECOND } from "./old-names"

const ROOT = join(import.meta.dir, "..")

// the factory names each manager by its role, never by an old session name.
const OLD_NAME = new RegExp(
  String.raw`(?<![\w.-])(${[OLD.ops, OLD.builder, OLD.planner].join("|")})(?![\w-]|\.\w)`,
  "gi",
)

// What keeps the name it was written with: a code block or span, a quote, a blockquote line, a dated attribution (OLD.builder, 8 Oct), a URL and a path.
const NOT_PROSE =
  /(`{3,})[\s\S]*?(?:\1|(?![\s\S]))|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|^\s*>.*$|[\w-]+, \d{1,2} [A-Z][a-z]+\b|https?:\/\/\S+|[^\s`]*[/~][^\s`]*/gm

// Records written as they were: notes, ADRs, the changelog and its entries.
const RECORDS = [
  ":!.github/notes",
  ":!.agents/adr",
  ":!CHANGELOG.md",
  ":!api/hono/src/plugins/changelog/entries",
]

// History whose date sits apart from the name, each kept as it was written.
const HISTORY = [
  `${OLD.ops} measured 17 Oct`,
  `run-slot-commit (${OLD.builder},`,
  `on 7 Oct (${OLD.builder})`,
  `(ND-644, ${OLD.planner})`,
  `14 Oct: ${OLD.planner} sat on`,
  `pruned on 7 Oct (${OLD.ops})`,
  `(12 Oct, ${OLD.builder} killed`,
  `and ${OLD.ops}'s watches and ${OLD.dispatcher}'s login-flip loop died`,
  `${OLD.ops} measured launchd`,
  `on 12 Oct ${OLD.builder} made 58 \`gh\` reads, and ${OLD.builder} and ${OLD.ops} 46 \`sleep\` waits, at $0.30 a turn for ${OLD.builder} and $0.37 for ${OLD.ops}`,
  `built by ${OLD.builder}'s subagent`,
  `${OLD.ops}'s audit on #2391`,
  `and ${OLD.builder} ran 943 turns`,
  `until ${OLD.ops} saw it`,
  `(${OLD.builder}'s go, PG-383)`,
]

// Code keeps the old names as aliases until each session respawns, so only its comments and docstrings are prose.
function proseOf(path: string, text: string): string {
  if (path.endsWith(".md")) return text
  const comments = text
    .split("\n")
    .map((line) => /^\s*(?:\/\/|#(?!!))\s?(.*)$/.exec(line)?.[1] ?? "")
  const docstrings = path.endsWith(".py")
    ? [...text.matchAll(/"""([\s\S]*?)"""/g)].map((m) => m[1]!)
    : []
  return [...comments, ...docstrings].join("\n")
}

function oldNamesIn(prose: string): string[] {
  const kept = HISTORY.reduce((text, phrase) => text.replaceAll(phrase, " "), prose)
  return [...kept.replace(NOT_PROSE, " ").matchAll(OLD_NAME)].map((m) => m[1]!.toLowerCase())
}

test(`prose names a manager by its role, never ${OLD.builder}, ${OLD.ops} or ${OLD.planner}`, async () => {
  const files = Bun.spawnSync(
    [
      "git",
      "-C",
      ROOT,
      "grep",
      "-l",
      "-i",
      "-w",
      "-e",
      OLD.builder,
      "-e",
      OLD.ops,
      "-e",
      OLD.planner,
      "--",
      ".",
      ":!tests",
      ...RECORDS,
    ],
    { stdout: "pipe" },
  )
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
  const found = (
    await Promise.all(
      files.map(async (path) => {
        const names = oldNamesIn(proseOf(path, await Bun.file(join(ROOT, path)).text()))
        return names.length ? [`${path}: ${[...new Set(names)].join(", ")}`] : []
      }),
    )
  ).flat()
  expect(found).toEqual([])
})

test("the check reads prose and leaves code, quotes, paths and dated attributions", () => {
  expect(oldNamesIn(`Each worker reports to ${OLD.builder}.`)).toEqual([OLD.builder])
  expect(
    oldNamesIn(
      `\`spawn.sh column ${OLD.ops}\` and "ask ${OLD.planner}" (${OLD.builder}, 8 Oct) (${OLD.ops}, 7 Oct: a note) ~/x/${OLD.builder}`,
    ),
  ).toEqual([])
  expect(oldNamesIn(`relayed by ${OLD.builder}, 13 Oct 04:35Z: two memberships`)).toEqual([])
  expect(oldNamesIn(`the ${OLD.ops}-checks-3 slot and playground-factory`)).toEqual([])
  expect(oldNamesIn(`a pass every 120s (ND-644, ${OLD.planner}), under`)).toEqual([])
  expect(
    oldNamesIn(
      `\`\`\`\`md\n\`\`\`\n${OLD.builder} ──runs──▶ job\n\`\`\`\n\`\`\`\`\ntell ${OLD.builder}`,
    ),
  ).toEqual([OLD.builder])
  expect(
    oldNamesIn(`(\`/x/spawn.sh column "$PANE" brief.md\`, grouped; tell ${OLD.builder}`),
  ).toEqual([OLD.builder])
  expect(proseOf("a.ts", `const seat = "${OLD.ops}"\n// tell ${OLD.builder}`)).toContain(
    `tell ${OLD.builder}`,
  )
  expect(oldNamesIn(proseOf("a.sh", `#!/bin/bash\n  ${OLD.builder}) echo builder ;;`))).toEqual([])
  expect(
    oldNamesIn(proseOf("a.py", `"""Sent to ${OLD.ops} daily."""\nSEAT = "${OLD.ops}"`)),
  ).toEqual([OLD.ops])
  expect(
    oldNamesIn(proseOf("a.ts", `const HELP = \`\n  --by <name>   (default: ${OLD.builder})\``)),
  ).toEqual([])
})

test("spawn.sh's code names no manager by an old session name, which reaches it through sessions.aliases", async () => {
  const code = (await Bun.file(join(ROOT, "scripts/spawn.sh")).text())
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
  expect(
    code.match(
      new RegExp(
        String.raw`(?<![\w.-])(?:${[OLD.ops, OLD.builder, OLD.planner, OLD_SECOND].join("|")})(?![\w-])`,
        "gi",
      ),
    ) ?? [],
  ).toEqual([])
})
