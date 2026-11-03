import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dataDir } from "../../packages/env/src/data-dir"
import { UNSET_REPOS } from "../../packages/scripts/src/trace-count/kinds"
import { mainCheckout } from "../../scripts/hooks/no-main-checkout"
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
import { git } from "./hooks/scratch-git"

const CHECKOUT = join(import.meta.dir, "..", "..")
// The pane's folder: a worktree of the main checkout the guards read, as a session's pane opens in its own worktree, here or on CI's checkout.
const MAIN = mainCheckout(CHECKOUT)
const WORKTREE = join(MAIN, ".claude", "worktrees", "shell-pane-test")
const SCRATCH = mkdtempSync(join(tmpdir(), "shell-pane-"))
afterAll(() => rmSync(SCRATCH, { force: true, recursive: true }))

// The launcher runs in a factory session, whose role and Claude Code session id the guards read.
const PRIOR = { id: process.env.CLAUDE_CODE_SESSION_ID, role: process.env.PLAYGROUND_ROLE }
process.env.PLAYGROUND_ROLE = "worker"
process.env.CLAUDE_CODE_SESSION_ID = "s-shell-pane-test"
afterAll(() => {
  if (PRIOR.role === undefined) delete process.env.PLAYGROUND_ROLE
  else process.env.PLAYGROUND_ROLE = PRIOR.role
  if (PRIOR.id === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = PRIOR.id
})

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
  "no-main-checkout": [`touch ${join(MAIN, "made-up-file")}`],
  "no-off-palette-label": [`gh label create made-up --color 123456`],
  "no-ours-merge": ["git merge -s ours origin/canary"],
  "no-prompt-stop": ["rmdir $HOME/$s"],
  "no-public-leak": [`gh pr comment 1 --repo ${UNSET_REPOS.public[0]} --body "$X"`],
  "no-unslotted-run": ["bun run test"],
}

// A data folder whose scope acme syncs with the made-up extension repo quillco/acme-skills, which the fixture's pushes name, as refused-forms.test.ts builds it.
const SYNCED = storeWith(
  join(SCRATCH, "synced"),
  {},
  { "ext.repos": { acme: "quillco/acme-skills" } },
)
mkdirSync(join(SYNCED, "extensions", "acme"), { recursive: true })
// A repo with a heavy path staged, as no-glm-heavy-path's own test stages one, for that guard's case to run in.
const GLM_REPO = join(SCRATCH, "glm-repo")
git(SCRATCH, "init", "-q", "-b", "canary", GLM_REPO)
git(GLM_REPO, "commit", "-q", "--allow-empty", "-m", "base")
mkdirSync(join(GLM_REPO, "web", "next", "src"), { recursive: true })
writeFileSync(join(GLM_REPO, "web", "next", "src", "x.ts"), "x\n")
git(GLM_REPO, "add", ".")
// The folder a guard's case runs in, where it is not the worktree.
const CWDS: Record<string, string> = { "no-glm-heavy-path": GLM_REPO }
// The environment a guard's case runs in beyond the session's role, set on the process, since run calls each check() with its own defaults.
const ENVS: Record<string, Record<string, string>> = {
  "no-extension-repo-write": { PLAYGROUND_DATA_DIR: SYNCED },
}

// Runs `body` with `vars` set on the process, an undefined one unset, then puts each back.
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const prior = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(vars))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  try {
    return await body()
  } finally {
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  }
}

type Pane = {
  agent_session?: Record<string, string>
  busy?: boolean
  cwd: string
  silent?: boolean
  workspace_id: string
}

// A herdr with no server, answering as herdr 0.9.5's CLI does (measured): a JSON line for most calls, nothing for a pane run that typed, plain text for a pane read. Its workspaces and panes sit in memory; `seen` is the pane's text, and a stuck close leaves the workspace listed.
function stubHerdr(seen = "", { cwd = WORKTREE, stuck = false } = {}) {
  const workspaces = new Map<string, string>([
    ["w1", "shell-vtqhxp-worker-1"],
    ["w2", "vtqhxp-worker"],
  ])
  const panes = new Map<string, Pane>([
    ["w1:p1", { cwd, workspace_id: "w1" }],
    ["w2:p1", { cwd, workspace_id: "w2" }],
  ])
  const calls: string[][] = []
  const ok = (result: Record<string, unknown>) => ({ code: 0, out: JSON.stringify({ result }) })
  const failed = (code: string) => ({
    code: 1,
    out: JSON.stringify({ error: { code, message: code } }),
  })
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
    if (group === "workspace" && verb === "get" && workspaces.has(id!))
      return ok({ workspace: { label: workspaces.get(id!), workspace_id: id } })
    if (group === "workspace" && verb === "close" && workspaces.has(id!)) {
      if (!stuck) workspaces.delete(id!)
      return ok({ type: "ok" })
    }
    if (group === "pane" && verb === "process-info" && panes.get(args[3]!)?.silent) return ok({})
    if (group === "pane" && verb === "process-info" && panes.has(args[3]!))
      return ok({
        process_info: {
          foreground_process_group_id: panes.get(args[3]!)!.busy ? 2 : 1,
          shell_pid: 1,
        },
      })
    if (group === "pane" && verb === "get" && panes.has(id!))
      return ok({ pane: { pane_id: id, ...panes.get(id!) } })
    if (group === "pane" && verb === "run") return { code: 0, out: "" }
    if (group === "pane" && verb === "read") return { code: 0, out: seen }
    if (group === "pane" && verb === "wait-output") {
      const marker = args[args.indexOf("--regex") + 1]!.slice(1).split(" ")[0]!
      return seen.includes(`${marker} rc=`) ? ok({ read: { text: seen } }) : failed("timeout")
    }
    return failed("not_found")
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
        const { calls, herdr } = stubHerdr("", { cwd: CWDS[guard] ?? WORKTREE })
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

  test("a registered Bash hook that names no guard file refuses, rather than being skipped", async () => {
    const repo = repoWith({ "no-made-up": `export const check = async () => undefined\n` })
    const file = join(repo, "scripts", "factory-settings.json")
    const settings = JSON.parse(await Bun.file(file).text())
    settings.hooks.PreToolUse.push({
      hooks: [{ command: "echo made-up-hook", type: "command" }],
      matcher: "^Bash$",
    })
    writeFileSync(file, JSON.stringify(settings))
    const { calls, herdr } = stubHerdr()
    expect(await refusal(run("w1:p1", "echo fine", herdr, repo))).toContain(
      "names no scripts/hooks/<name>.ts: echo made-up-hook",
    )
    expect(typed(calls)).toEqual([])
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
  test.each([
    ["claude --version"],
    ["cl''aude --version"],
    ["c\\laude --version"],
    [`"cl"aude -p hi`],
  ])("a word naming claude: %s", async (command) => {
    const { calls, herdr } = stubHerdr()
    const repo = repoWith({ "no-made-up": `export const check = async () => undefined\n` })
    expect(await refusal(run("w1:p1", command, herdr, repo))).toContain("naming claude")
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

  test.each([
    ["a Ctrl-U", "echo a\x15alias st=git", "U+0015"],
    ["an escape", "echo a\x1b[2K", "U+001B"],
    ["a newline", "echo a\ngit stash", "U+000A"],
    ["a non-ASCII character", "echo caf\u00e9", "U+00E9"],
    ["a DEL", "echo a\x7f", "U+007F"],
    ["a tab", "printf 'a\tb'", "U+0009"],
  ])("a command holding %s is refused before typing, naming it", async (_, command, named) => {
    const { calls, herdr } = stubHerdr()
    const repo = repoWith({ "no-made-up": `export const check = async () => undefined\n` })
    expect(await refusal(run("w1:p1", command, herdr, repo))).toBe(
      `shell-pane refuses a command holding ${named}: it types printable ASCII and space alone`,
    )
    expect(typed(calls)).toEqual([])
  })

  test("a session with no Claude Code session id, whose role the guards could not read", async () => {
    const { calls, herdr } = stubHerdr()
    const repo = repoWith({ "no-made-up": `export const check = async () => undefined\n` })
    expect(
      await refusal(
        withEnv({ CLAUDE_CODE_SESSION_ID: undefined }, () => run("w1:p1", "echo hi", herdr, repo)),
      ),
    ).toContain("no CLAUDE_CODE_SESSION_ID")
    expect(typed(calls)).toEqual([])
  })

  test("run from a bun that loads an env file, since the hooks load none", async () => {
    const log = console.error
    const printed: string[] = []
    console.error = (line: string) => printed.push(line)
    try {
      expect(await main(["run", "w1:p1", "echo hi"], stubHerdr().herdr)).toBe(1)
    } finally {
      console.error = log
    }
    expect(printed.join("\n")).toContain("takes bun run --no-env-file")
  })

  test("the screen reads no .env, as the hooks start with --no-env-file", async () => {
    const guard = `export const check = async () => process.env.SHELL_PANE_MADE_UP ? "no-made-up hook refuses it" : undefined\n`
    const repo = repoWith({ "no-made-up": guard })
    writeFileSync(join(repo, ".env"), "SHELL_PANE_MADE_UP=1\n")
    const { calls, herdr } = stubHerdr()
    await run("w1:p1", "echo hi", herdr, repo)
    expect(typed(calls)).toHaveLength(1)
    expect(
      await refusal(
        withEnv({ SHELL_PANE_MADE_UP: "1" }, () => run("w1:p1", "echo hi", herdr, repo)),
      ),
    ).toBe("no-made-up hook refuses it")
  })

  test("a role-gated guard reads the role from the session id, as its hook does, when PLAYGROUND_ROLE is unset", async () => {
    const config = join(SCRATCH, "config-role")
    mkdirSync(join(config, "sessions"), { recursive: true })
    writeFileSync(
      join(config, "sessions", "1.json"),
      JSON.stringify({ name: "worker-made-up", sessionId: "s-role" }),
    )
    const repo = repoOf("no-linear-ticket")
    const row = OWN_ROWS["no-linear-ticket"]![0]!
    const as = (id: string) =>
      withEnv(
        {
          CLAUDE_CODE_SESSION_ID: id,
          CLAUDE_CONFIG_DIR: config,
          PLAYGROUND_DATA_DIR: dataDir(),
          PLAYGROUND_ROLE: undefined,
        },
        () => run("w1:p1", row, stubHerdr().herdr, repo),
      )
    expect(await refusal(as("s-role"))).toContain("no-linear-ticket hook ")
    expect(await as("s-unknown")).toMatch(/^__shell_pane_/)
  })

  test("a pane herdr gives no folder for, which the guards judge", async () => {
    const { calls, herdr, panes } = stubHerdr()
    panes.get("w1:p1")!.cwd = ""
    expect(await refusal(run("w1:p1", "echo hi", herdr, CHECKOUT))).toContain("gave no folder")
    expect(typed(calls)).toEqual([])
  })

  test("a registered matcher that is no regex refuses", async () => {
    const repo = repoWith(
      { "no-made-up": `export const check = async () => undefined\n` },
      "^(Bash",
    )
    expect(await refusal(run("w1:p1", "echo hi", stubHerdr().herdr, repo))).toContain(
      "cannot read a registered hook's matcher",
    )
  })

  test("a pane herdr gives no process info for, since it cannot be told idle", async () => {
    const { calls, herdr, panes } = stubHerdr()
    panes.get("w1:p1")!.silent = true
    expect(await refusal(run("w1:p1", "echo hi", herdr, CHECKOUT))).toContain("herdr did not say")
    expect(typed(calls)).toEqual([])
  })

  test("a pane whose last command still runs, so no line is typed into its input", async () => {
    const { calls, herdr, panes } = stubHerdr()
    panes.get("w1:p1")!.busy = true
    expect(await refusal(run("w1:p1", "echo hi", herdr, CHECKOUT))).toContain(
      "a command is still running there",
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
    expect(line).toBe(`/bin/zsh -f -c 'echo hi; id'; printf '\\n%s rc=%s\\n' ${marker} "$?"`)
    expect(line).not.toMatch(new RegExp(`${marker} rc=\\d`))
    expect(await run("w1:p1", "echo hi", herdr, CHECKOUT)).not.toBe(marker)
  })

  // Each run is a zsh of its own, so the pane's shell never reads a command's text as its own line: no alias, function, variable or open quote carries to the next run, as none carries between Bash tool calls.
  test.each([
    ["an alias", "alias st=git", `/bin/zsh -f -c 'alias st=git'`],
    ["an open quote", "echo 'x", `/bin/zsh -f -c 'echo '\\''x'`],
    ["a quote meant to close one", "x' ; git stash", `/bin/zsh -f -c 'x'\\'' ; git stash'`],
  ])("%s stays inside its own shell", async (_, command, shell) => {
    const repo = repoWith({ "no-made-up": `export const check = async () => undefined\n` })
    const { calls, herdr } = stubHerdr()
    await run("w1:p1", command, herdr, repo)
    const [[, , , line]] = typed(calls) as [string[]]
    expect(line!.startsWith(`${shell}; printf `)).toBe(true)
  })
})

describe("read waits for the marker", () => {
  const marker = "__shell_pane_0123456789ab"
  const screenText = [
    "me /work",
    `> echo hi; printf '\\n%s rc=%s\\n' ${marker} "$?"`,
    "hi",
    "",
    `${marker} rc=0`,
    "",
    "me /work",
    ">",
  ].join("\n")

  test("a marker gives the output and rc=0", async () => {
    expect(await read("w1:p1", marker, 1000, stubHerdr(screenText).herdr)).toEqual({
      output: "hi",
      rc: 0,
    })
  })

  test("no marker by the timeout reads as unknown, never a pass, with what showed so far", async () => {
    const shown = `> long-run; printf '\\n%s rc=%s\\n' ${marker} "$?"\nstep 1 of 3`
    expect(await read("w1:p1", marker, 50, stubHerdr(shown).herdr)).toEqual({
      output: "step 1 of 3",
    })
    const log = console.log
    const printed: string[] = []
    console.log = (line: string) => printed.push(line)
    try {
      expect(await main(["read", "w1:p1", marker, "--timeout", "50"], stubHerdr(shown).herdr)).toBe(
        2,
      )
    } finally {
      console.log = log
    }
    expect(printed).toEqual(["step 1 of 3", "no exit marker by 50 ms: the result is unknown"])
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

  test("close refuses to report closed while the server still lists the label", async () => {
    expect(await refusal(close("w1", stubHerdr("", { stuck: true }).herdr))).toContain(
      "still lists shell-vtqhxp-worker-1",
    )
  })

  test("a herdr error reaches the caller as a refusal naming it", async () => {
    expect(await refusal(run("w9:p1", "echo hi", stubHerdr().herdr, CHECKOUT))).toBe(
      "herdr pane get: not_found",
    )
  })
})
