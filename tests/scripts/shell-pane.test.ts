import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dataDir } from "../../packages/env/src/data-dir"
import {
  bashGuards,
  close,
  type Herdr,
  main,
  open,
  read,
  Refusal,
  run,
} from "../../scripts/shell-pane"
import { ALLOWED, type Paths, REFUSED_FORMS } from "./hooks/fixtures/refused-forms"
import { storeWith } from "./hooks/render-set"

const CHECKOUT = join(import.meta.dir, "..", "..")
const SCRATCH = mkdtempSync(join(tmpdir(), "shell-pane-"))
afterAll(() => rmSync(SCRATCH, { force: true, recursive: true }))

// The launcher runs in a factory session, whose role the guards read.
const PRIOR_ROLE = process.env.PLAYGROUND_ROLE
process.env.PLAYGROUND_ROLE = "worker"
afterAll(() =>
  PRIOR_ROLE === undefined
    ? delete process.env.PLAYGROUND_ROLE
    : (process.env.PLAYGROUND_ROLE = PRIOR_ROLE),
)

// Folders the fixture's rows name, none of them made: each row stays data, read only by check().
const NONE = join(SCRATCH, "none")
const PATHS: Paths = {
  BARE: NONE,
  CLI_DIR: NONE,
  DATA: NONE,
  HOME: NONE,
  LINK: NONE,
  LIST: NONE,
  MAIN: NONE,
  ROOT: NONE,
  SCOPE: NONE,
  WORDS: NONE,
  WORK: NONE,
}

// A refused command for each registered Bash guard the fixture holds no refused row for in this setting.
const OWN_ROWS: Record<string, string[]> = {
  "no-false-green": ["bun run test | grep pass"],
  "no-linear-ticket": [`cp /dev/null ${join(dataDir(), "ticket-approvals")}/`],
  "no-mac-web-build": ["docker compose build web"],
  "no-main-checkout": [`touch ${join(CHECKOUT, "..", "..", "..", "made-up-file")}`],
  "no-off-palette-label": [`gh label create made-up --color 123456`],
  "no-ours-merge": ["git merge -s ours origin/canary"],
  "no-prompt-stop": ["rmdir $HOME/$s"],
  "no-public-leak": [`gh pr comment 1 --repo nrjdalal/playground --body "$X"`],
  "no-unslotted-run": ["bun run test"],
}

// A data folder whose scope acme syncs with the made-up extension repo quillco/acme-skills, which the fixture's pushes name, as refused-forms.test.ts builds it.
const SYNCED = storeWith(
  join(SCRATCH, "synced"),
  {},
  { "ext.repos": { acme: "quillco/acme-skills" } },
)
mkdirSync(join(SYNCED, "extensions", "acme"), { recursive: true })
// The environment a guard's case runs in beyond the session's role, set on the process, since run calls each check() with its own defaults.
const ENVS: Record<string, Record<string, string>> = {
  "no-extension-repo-write": { PLAYGROUND_DATA_DIR: SYNCED },
}

async function withEnv<T>(vars: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const prior = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  Object.assign(process.env, vars)
  try {
    return await body()
  } finally {
    for (const [key, value] of Object.entries(prior))
      value === undefined ? delete process.env[key] : (process.env[key] = value)
  }
}

type Pane = { agent_session?: Record<string, string>; cwd: string; workspace_id: string }

// A herdr with no server: workspaces and panes in memory, each call it took, and the text a wait-output finds.
function stubHerdr(seen = "") {
  const workspaces = new Map<string, string>([
    ["w1", "shell-vtqhxp-worker-1"],
    ["w2", "vtqhxp-worker"],
  ])
  const panes = new Map<string, Pane>([
    ["w1:p1", { cwd: CHECKOUT, workspace_id: "w1" }],
    ["w2:p1", { cwd: CHECKOUT, workspace_id: "w2" }],
  ])
  const calls: string[][] = []
  const ok = (result: Record<string, unknown>) => ({ code: 0, json: { result } })
  const herdr: Herdr = async (args) => {
    calls.push(args)
    const [group, verb, id] = args
    if (group === "workspace" && verb === "list")
      return ok({
        workspaces: [...workspaces].map(([workspace_id, label]) => ({ label, workspace_id })),
      })
    if (group === "workspace" && verb === "create") {
      const workspace_id = `w${workspaces.size + 1}`
      workspaces.set(workspace_id, args[args.indexOf("--label") + 1]!)
      panes.set(`${workspace_id}:p1`, { cwd: args[args.indexOf("--cwd") + 1]!, workspace_id })
      return ok({
        root_pane: { pane_id: `${workspace_id}:p1` },
        workspace: { label: workspaces.get(workspace_id), workspace_id },
      })
    }
    if (group === "workspace" && (verb === "get" || verb === "close") && workspaces.has(id!)) {
      const label = workspaces.get(id!)
      if (verb === "close") workspaces.delete(id!)
      return ok({ workspace: { label, workspace_id: id } })
    }
    if (group === "pane" && verb === "get" && panes.has(id!))
      return ok({ pane: { pane_id: id, ...panes.get(id!) } })
    if (group === "pane" && verb === "run") return ok({})
    if (group === "pane" && verb === "wait-output") {
      const marker = args[args.indexOf("--regex") + 1]!.slice(1).split(" ")[0]!
      if (!seen.includes(`${marker} rc=`))
        return { code: 1, json: { error: { code: "timeout", message: "timed out" } } }
      return ok({ read: { text: seen } })
    }
    return { code: 1, json: { error: { code: "not_found", message: `no ${args.join(" ")}` } } }
  }
  return { calls, herdr, panes, workspaces }
}

const typed = (calls: string[][]) =>
  calls.filter(([group, verb]) => group === "pane" && verb === "run")

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Refusal) return error.message
    throw error
  }
  throw new Error("expected a refusal")
}

// A repo of its own whose factory settings register `hooks` for the Bash tool, each hook's file given its text.
let repos = 0
function repoWith(hooks: Record<string, string>, matcher = "^Bash$"): string {
  const repo = join(SCRATCH, `repo-${++repos}`)
  mkdirSync(join(repo, "scripts", "hooks"), { recursive: true })
  for (const [name, text] of Object.entries(hooks))
    writeFileSync(join(repo, "scripts", "hooks", `${name}.ts`), text)
  const entries = Object.keys(hooks).map((name) => ({
    hooks: [{ command: `bun scripts/hooks/${name}.ts`, type: "command" }],
    matcher,
  }))
  writeFileSync(
    join(repo, "scripts", "factory-settings.json"),
    JSON.stringify({ hooks: { PreToolUse: entries } }),
  )
  return repo
}

// A repo registering one real guard alone, its hook file the checkout's own check.
const repoOf = (guard: string) =>
  repoWith({
    [guard]: `export { check } from ${JSON.stringify(join(CHECKOUT, "scripts", "hooks", `${guard}.ts`))}\n`,
  })

// The fixture's Bash rows for a guard, each one the allow list does not let run, then the test's own.
const rowsFor = (guard: string): string[] => [
  ...REFUSED_FORMS.filter((group) => group.guards.includes(guard as never)).flatMap((group) =>
    group
      .rows(PATHS)
      .filter(
        ([what, call]) => typeof call === "string" && !ALLOWED.includes(`${group.source} ${what}`),
      )
      .map(([, call]) => call as string),
  ),
  ...(OWN_ROWS[guard] ?? []),
]

const REGISTERED = await bashGuards(CHECKOUT)

describe("run screens the command through every registered Bash guard before it types", () => {
  test("the guards come from the factory settings' Bash matchers", () => {
    expect(REGISTERED).toContain("no-raw-spawn")
    expect(REGISTERED).toContain("no-unslotted-run")
    expect(REGISTERED).not.toContain("writing-first")
    expect(REGISTERED).not.toContain("no-bare-slack-link")
  })

  test.each(REGISTERED.map((guard) => [guard]))(
    "%s refuses one of its rows through run, and nothing is typed",
    async (guard) => {
      const repo = repoOf(guard)
      for (const row of rowsFor(guard)) {
        const { calls, herdr } = stubHerdr()
        try {
          await withEnv(ENVS[guard] ?? {}, () => run("w1:p1", row, herdr, repo))
        } catch (error) {
          if (!(error instanceof Refusal)) throw error
          expect(error.message).toContain(`${guard} hook `)
          expect(typed(calls)).toEqual([])
          return
        }
      }
      throw new Error(`${guard} refused none of its rows: give it one in OWN_ROWS`)
    },
    60_000,
  )

  test("a guard added to the registered list is checked, with no launcher change", async () => {
    const repo = repoWith({
      "no-made-up": `export const check = async (raw: string) => JSON.parse(raw).tool_input.command.includes("made-up-word") ? "no-made-up hook refuses it" : undefined\n`,
    })
    const { calls, herdr } = stubHerdr()
    expect(await refusal(run("w1:p1", "echo made-up-word", herdr, repo))).toBe(
      "no-made-up hook refuses it",
    )
    expect(typed(calls)).toEqual([])
    await run("w1:p1", "echo fine", herdr, repo)
    expect(typed(calls)).toHaveLength(1)
  })

  test("a guard registered for another tool alone is not checked", async () => {
    const repo = repoWith(
      { "no-made-up": `export const check = async () => "no-made-up hook refuses it"\n` },
      "^Write$",
    )
    expect(await refusal(run("w1:p1", "echo fine", stubHerdr().herdr, repo))).toContain(
      "no Bash guard",
    )
  })

  test("a registered guard that cannot load refuses", async () => {
    const repo = repoWith({ "no-made-up": `export const nothing = 1\n` })
    const { calls, herdr } = stubHerdr()
    expect(await refusal(run("w1:p1", "echo fine", herdr, repo))).toContain(
      "no-made-up could not check",
    )
    expect(typed(calls)).toEqual([])
  })

  test("a heavy command outside run-slot is refused by no-unslotted-run, with the whole registered list", async () => {
    const { calls, herdr } = stubHerdr()
    expect(await refusal(run("w1:p1", "bun run test", herdr, CHECKOUT))).toContain(
      "no-unslotted-run hook ",
    )
    expect(typed(calls)).toEqual([])
  })
})

describe("run's own refusals", () => {
  test("a word naming claude", async () => {
    const { calls, herdr } = stubHerdr()
    const repo = repoWith({ "no-made-up": `export const check = async () => undefined\n` })
    expect(await refusal(run("w1:p1", "claude --version", herdr, repo))).toContain("naming claude")
    expect(typed(calls)).toEqual([])
  })

  test("a pane in a workspace whose label it did not make", async () => {
    const { calls, herdr } = stubHerdr()
    expect(await refusal(run("w2:p1", "echo hi", herdr, CHECKOUT))).toContain(
      "only into a workspace it labelled",
    )
    expect(typed(calls)).toEqual([])
  })

  test("a pane holding an agent session", async () => {
    const { calls, herdr, panes } = stubHerdr()
    panes.get("w1:p1")!.agent_session = { kind: "claude", value: "s-1" }
    expect(await refusal(run("w1:p1", "echo hi", herdr, CHECKOUT))).toContain(
      "holds an agent session",
    )
    expect(typed(calls)).toEqual([])
  })
})

describe("run types the command with a fresh exit marker", () => {
  test("the typed line ends with the marker's printf, and holds no marker line of its own", async () => {
    const { calls, herdr } = stubHerdr()
    const marker = await run("w1:p1", "echo hi; id", herdr, CHECKOUT)
    expect(marker).toMatch(/^__shell_pane_[0-9a-f]{12}$/)
    const [[, , pane, line]] = typed(calls) as [string[]]
    expect(pane).toBe("w1:p1")
    expect(line).toBe(`echo hi; id; printf '\\n%s rc=%s\\n' ${marker} "$?"`)
    expect(line).not.toMatch(new RegExp(`${marker} rc=\\d`))
    expect(await run("w1:p1", "echo hi", herdr, CHECKOUT)).not.toBe(marker)
  })
})

describe("read waits for the marker", () => {
  const marker = "__shell_pane_0123456789ab"
  const screenText = [
    "nrjdalal /work",
    `> echo hi; printf '\\n%s rc=%s\\n' ${marker} "$?"`,
    "hi",
    "",
    `${marker} rc=0`,
    "",
    "nrjdalal /work",
    ">",
  ].join("\n")

  test("a marker gives the output and rc=0", async () => {
    expect(await read("w1:p1", marker, 1000, stubHerdr(screenText).herdr)).toEqual({
      output: "hi",
      rc: 0,
    })
  })

  test("no marker by the timeout reads as unknown, never a pass", async () => {
    expect(await read("w1:p1", marker, 50, stubHerdr("hi\n").herdr)).toBeUndefined()
    const log = console.log
    const printed: string[] = []
    console.log = (line: string) => printed.push(line)
    try {
      expect(
        await main(["read", "w1:p1", marker, "--timeout", "50"], stubHerdr("hi\n").herdr),
      ).toBe(2)
    } finally {
      console.log = log
    }
    expect(printed).toEqual(["no exit marker by 50 ms: the result is unknown"])
  })

  test("a word that is not a marker run printed is refused", async () => {
    expect(await refusal(read("w1:p1", "rc=0", 50, stubHerdr().herdr))).toContain(
      "takes the marker",
    )
  })
})

describe("open and close", () => {
  test("open labels a workspace shell-<name>-<n>, one past the name's highest, in the folder given", async () => {
    const { calls, herdr } = stubHerdr()
    expect(await open("vtqhxp-worker", "/work", herdr)).toEqual({
      label: "shell-vtqhxp-worker-2",
      pane: "w3:p1",
      workspace: "w3",
    })
    expect(calls.at(-1)).toEqual([
      "workspace",
      "create",
      "--label",
      "shell-vtqhxp-worker-2",
      "--cwd",
      "/work",
      "--no-focus",
    ])
  })

  test("open takes a session name that is a word", async () => {
    expect(await refusal(open("a b", "/work", stubHerdr().herdr))).toContain("a word")
  })

  test("close refuses a workspace it did not label, and closes one it did", async () => {
    const { calls, herdr, workspaces } = stubHerdr()
    expect(await refusal(close("w2", herdr))).toContain("closes only a workspace it labelled")
    expect(calls.some(([group, verb]) => group === "workspace" && verb === "close")).toBe(false)
    await close("w1", herdr)
    expect(workspaces.has("w1")).toBe(false)
    expect(workspaces.has("w2")).toBe(true)
  })
})
