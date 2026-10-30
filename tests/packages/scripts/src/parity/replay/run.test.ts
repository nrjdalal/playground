import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  fixtureDir,
  mcpConfig,
  problems,
  prompt,
  replayArgv,
  replayEnv,
  replayOutcome,
  runSide,
  type Replay,
  type Replays,
  type Side,
  type SkillMap,
} from "../../../../../../packages/scripts/src/parity/replay/run"

const REPO = join(import.meta.dir, "../../../../../..")
const HERE = join(REPO, "packages/scripts/src/parity/replay")
const scratch = mkdtempSync(join(tmpdir(), "parity-replay-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A made-up scope holding one replay, as an extension keeps it: its skill and a sibling, and replays/ with the replay, its map and its recordings.
const SCOPE = join(scratch, "extensions", "acme")
const TRIAGE: Replay = {
  allowed: ["Read", "Bash(gh search:*)", "mcp__linear-shared__get_issue"],
  args: "ACME-201",
  compare: "triage",
  model: "claude-opus-5-5",
  runs: 3,
  servers: ["github-shared", "linear-shared", "slack-shared"],
}
const REPLAYS: Replays = { "made-up-triage": TRIAGE }
const MAP: SkillMap = { "made-up-triage": { paths: ["skills/triage/"], skill: "skills/triage" } }
const FIXTURES = fixtureDir(SCOPE, "made-up-triage")
for (const [path, text] of Object.entries({
  "replays/fixtures/made-up-triage/gh.json": JSON.stringify([
    { argv: ["search", "prs", "ACME-201"], stdout: "[]\n" },
  ]),
  "replays/fixtures/made-up-triage/github-shared.json": "{}",
  "replays/fixtures/made-up-triage/linear-shared.json": "{}",
  "replays/fixtures/made-up-triage/slack-shared.json": "{}",
  "replays/map.json": JSON.stringify(MAP),
  "replays/replays.json": JSON.stringify(REPLAYS),
  "skills/claim/SKILL.md": "# claim\n",
  "skills/triage/SKILL.md": "# triage\n",
})) {
  mkdirSync(dirname(join(SCOPE, path)), { recursive: true })
  writeFileSync(join(SCOPE, path), text)
}

describe("replayArgv", () => {
  const argv = replayArgv({
    allowed: ["Read", "Bash(${CLAUDE_SKILL_DIR}/scripts/render-board.sh:*)"],
    claude: "claude",
    mcp: "{}",
    model: "claude-opus-5-5",
    prompt: prompt("/skills/triage", "ACME-201"),
    skillDir: "/skills/triage",
  })

  test("runs headless on dontAsk with only the stubs, its reads allowed last", () => {
    expect(argv.slice(0, 2)).toEqual(["claude", "-p"])
    expect(argv[2]).toBe(
      "Read /skills/triage/SKILL.md and follow it as the skill it describes, reading ${CLAUDE_SKILL_DIR} as /skills/triage. Its arguments: ACME-201. Each Bash call runs one plain command, with no ;, &&, ||, pipe or redirect, since a compound command is refused whole here.",
    )
    expect(argv.join(" ")).toContain(
      "--permission-mode dontAsk --strict-mcp-config --mcp-config {}",
    )
    expect(argv.slice(argv.indexOf("--allowedTools") + 1)).toEqual([
      "Read",
      "Bash(/skills/triage/scripts/render-board.sh:*)",
    ])
  })

  test("leaves every write callable, so dontAsk's refusals show as denials", () => {
    expect(argv).not.toContain("--disallowedTools")
    expect(argv).not.toContain("bypassPermissions")
  })
})

describe("mcpConfig", () => {
  test("names each server the replay reads as a stub under that name", () => {
    const servers = JSON.parse(mcpConfig(FIXTURES, TRIAGE.servers, "/m.jsonl")).mcpServers
    expect(Object.keys(servers)).toEqual(["github-shared", "linear-shared", "slack-shared"])
    expect(servers["linear-shared"].args).toEqual([
      join(HERE, "stub-mcp.ts"),
      ...[
        "--server",
        "linear-shared",
        "--recording",
        join(SCOPE, "replays/fixtures/made-up-triage/linear-shared.json"),
      ],
      ...["--schemas", join(HERE, "schemas/linear-shared.json"), "--log", "/m.jsonl"],
    ])
  })
})

describe("replayEnv", () => {
  test("a sandboxed HOME, the shim first on PATH, the token, and nothing that moves the run off Claude", () => {
    const env = replayEnv(
      {
        ANTHROPIC_BASE_URL: "x",
        CLAUDE_CODE_ENTRYPOINT: "cli",
        CLAUDE_CONFIG_DIR: "/c",
        CMUX_SURFACE: "s",
        HOME: "/real",
        PATH: "/usr/bin",
      },
      { fixtures: FIXTURES, home: "/sandbox", misses: "/m.jsonl", token: "t" },
    )
    expect(env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      HOME: "/sandbox",
      PARITY_GH: join(FIXTURES, "gh.json"),
      PARITY_MISSES: "/m.jsonl",
      PATH: `${join(HERE, "bin")}:/usr/bin`,
    })
  })
})

describe("problems", () => {
  test("a scope's replay is ready: its skill, a recording and a schema per server, gh's recording", async () => {
    expect(await problems(SCOPE, "made-up-triage", TRIAGE, MAP)).toEqual([])
  })

  test("reads the file map.json names, relative to the skill's folder", async () => {
    const scan: SkillMap = {
      "made-up-triage": { file: "references/SCAN.md", paths: [], skill: "skills/triage" },
    }
    expect(prompt("/x/triage", "", "references/SCAN.md")).toStartWith(
      "Read /x/triage/references/SCAN.md and follow it",
    )
    expect(await problems(SCOPE, "made-up-triage", TRIAGE, scan)).toContain(
      "made-up-triage: no skills/triage/references/SCAN.md",
    )
  })

  test("names a missing skill, a server with no recording and a recorded tool its schema lacks", async () => {
    const broken: Replay = { ...TRIAGE, servers: [...TRIAGE.servers, "notion-shared"] }
    expect(
      await problems(SCOPE, "made-up-triage", broken, {
        "made-up-triage": { paths: [], skill: "skills/none" },
      }),
    ).toEqual([
      "made-up-triage: no skills/none/SKILL.md",
      "made-up-triage: no recording for notion-shared",
    ])
    writeFileSync(join(FIXTURES, "slack-shared.json"), JSON.stringify({ no_such_tool: [] }))
    expect(await problems(SCOPE, "made-up-triage", TRIAGE, MAP)).toEqual([
      "made-up-triage: slack-shared's recording answers no_such_tool, which its schema lacks",
    ])
    writeFileSync(join(FIXTURES, "slack-shared.json"), "{}")
    expect(await problems(SCOPE, "nameless", TRIAGE, MAP)).toEqual(["nameless: not in map.json"])
  })
})

describe("runSide", () => {
  // A stand-in claude: it calls gh through PATH as a skill would, writes what it was given beside it, and prints one read and its result as stream-json.
  const claude = join(scratch, "claude")
  writeFileSync(
    claude,
    `#!/usr/bin/env bun
const searched = Bun.spawnSync(["gh", "search", "prs", "--owner", "some-co", '"ACME-201"']).stdout.toString()
if (process.env.FAKE_MISS) Bun.spawnSync(["gh", "pr", "merge", "1"])
await Bun.write("given.json", JSON.stringify({ argv: process.argv.slice(2), env: process.env }))
console.log(JSON.stringify({ message: { content: [{ id: "a", input: { id: "ACME-201" }, name: "mcp__linear-shared__get_issue", type: "tool_use" }] }, type: "assistant" }))
console.log(JSON.stringify({ permission_denials: [], result: searched, type: "result" }))
`,
  )
  chmodSync(claude, 0o755)
  const side = (dir: string, env: Record<string, string | undefined>) =>
    runSide({
      claude,
      env,
      file: "SKILL.md",
      fixtures: FIXTURES,
      replay: TRIAGE,
      runs: 2,
      scratch: join(scratch, dir),
      skillDir: join(SCOPE, MAP["made-up-triage"]!.skill),
      token: "t",
    })

  test("each run gets its own HOME and the shim, and signs its stream", async () => {
    const result = await side("plain", { ANTHROPIC_API_KEY: "k", PATH: process.env.PATH })
    expect(result.misses).toEqual([])
    expect(result.signatures).toEqual(
      Array(2).fill(JSON.stringify({ denials: [], reads: ["mcp__linear-shared__get_issue"] })),
    )
    const given = JSON.parse(readFileSync(join(scratch, "plain/run-1/home/given.json"), "utf8"))
    expect(given.env.HOME).toBe(join(scratch, "plain/run-1/home"))
    expect(given.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(realpathSync(join(scratch, "plain/run-1/home/.claude/skills/claim"))).toBe(
      realpathSync(join(SCOPE, "skills/claim")),
    )
    expect(given.argv).toContain("dontAsk")
    expect((await side("plain", { PATH: process.env.PATH })).misses).toEqual([])
    expect(readFileSync(join(scratch, "plain/run-0/stream.jsonl"), "utf8")).toContain(
      '"result":"[]\\n"',
    )
  })

  test("a gh call the recording lacks comes back as a miss", async () => {
    const result = await side("miss", { FAKE_MISS: "1", PATH: process.env.PATH })
    expect(result.misses.map((m) => JSON.parse(m).argv)).toEqual([
      ["pr", "merge", "1"],
      ["pr", "merge", "1"],
    ])
  })
})

describe("replayOutcome", () => {
  const fake = (sides: Record<string, string[][]>) => {
    const asked: string[] = []
    const run = async (side: "after" | "before", runs: number): Promise<Side> => {
      asked.push(`${side} ${runs}`)
      return {
        misses: side === "after" && sides.miss ? ["m"] : [],
        signatures: sides[side]!.shift()!,
      }
    }
    return { asked, run }
  }

  test("a quiet before side runs once at the count given", async () => {
    const f = fake({ after: [["a", "a", "b"]], before: [["a", "a", "a"]] })
    expect(await replayOutcome("r", f.run, 3)).toEqual({
      after: "a",
      before: "a",
      misses: [],
      name: "r",
      outcome: "same",
    })
    expect(f.asked).toEqual(["before 3", "after 3"])
  })

  test("a noisy before side reruns at 5, and stays noisy when it still has no majority", async () => {
    const f = fake({
      after: [["a", "a", "a"]],
      before: [
        ["a", "b", "c"],
        ["a", "b", "c", "d", "e"],
      ],
    })
    expect((await replayOutcome("r", f.run, 3)).outcome).toBe("noisy")
    expect(f.asked).toEqual(["before 3", "before 5", "after 3"])
  })

  test("keeps every miss, so a same verdict with a miss still fails", async () => {
    const f = fake({ after: [["a"]], before: [["a"]], miss: [] })
    expect(await replayOutcome("r", f.run, 1)).toMatchObject({ misses: ["m"], outcome: "same" })
  })
})
