import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Env, GIT_TAKES, lex, run } from "../../../scripts/hooks/shell"
import { type Paths, REFUSED_FORMS } from "./fixtures/refused-forms"

const HOOKS = join(import.meta.dir, "..", "..", "..", "scripts", "hooks")

describe("git's value-taking options live in one list", () => {
  test("GIT_TAKES holds every option git 2.56 steps over before its subcommand", () => {
    expect([...GIT_TAKES].sort()).toEqual([
      "--attr-source",
      "--config-env",
      "--exec-path",
      "--git-dir",
      "--namespace",
      "--work-tree",
      "-C",
      "-c",
    ])
  })

  test("no hook keeps a copy of its own", () => {
    const copies = readdirSync(HOOKS)
      .filter((file) => file.endsWith(".ts") && file !== "shell.ts")
      .filter((file) => readFileSync(join(HOOKS, file), "utf8").includes('"--namespace"'))
    expect(copies).toEqual([])
  })
})

describe("an alternate reading runs on its own copy of the env", () => {
  // sudo -Z is an option sudo's list lacks, so the call is read twice: x as the program, and x as -Z's value with the rest as the program
  const seen = async (line: string) => {
    const env: Env = { cwd: "/start", files: new Map(), known: {}, process: {}, vars: new Map() }
    let probe: Env | undefined
    await run(lex(line), env, async (_cmd, parsed, here) => {
      if (parsed.name === "probe") probe = here
      return undefined
    })
    return { cwd: probe?.cwd, vars: [...(probe?.vars.keys() ?? [])] }
  }

  test("a cd only an alternate reading runs leaves the next command's folder as it was", async () => {
    expect(await seen("sudo -Z x cd /; probe")).toEqual({ cwd: "/start", vars: [] })
  })

  test("an export only an alternate reading runs leaves the next command's variables as they were", async () => {
    expect(await seen("sudo -Z x export A=1; probe")).toEqual({ cwd: "/start", vars: [] })
  })

  test("the primary reading still moves the folder and sets the variables", async () => {
    expect(await seen("cd /; export A=1; probe")).toEqual({ cwd: "/", vars: ["A"] })
  })
})

// Env.cwd's own reading follows zsh's ~- through the one folder Env.old names, and the proven reading through the set Env.cwdBack holds, so the set must hold that folder or the two readings could disagree on where a `cd -` or `pushd ~-` goes back to.
describe("the folder Env.old names is always one Env.cwdBack holds", () => {
  // each row is read as text by the reader alone and never run, in folders made under a mkdtemp root so Env.cwd's reading lands in them
  test("after every cd, pushd and popd of the refused-forms rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "old-in-back-"))
    const extensions = join(root, "data", "extensions")
    const paths: Paths = {
      BARE: join(root, "bare"),
      CLI_DIR: join(root, "cli"),
      DATA: join(root, "data"),
      HOME: join(root, "home"),
      LINK: join(root, "home", "store"),
      LIST: join(extensions, "hooks", "list.json"),
      MAIN: join(root, "main"),
      ROOT: extensions,
      SCOPE: join(extensions, "login"),
      WORDS: join(root, "home", "words"),
      WORK: join(root, "home", "work"),
    }
    for (const [key, dir] of Object.entries(paths))
      if (key !== "LIST") mkdirSync(dir, { recursive: true })
    let read = 0
    const misses: string[] = []
    for (const { rows } of REFUSED_FORMS)
      for (const [, call] of rows(paths)) {
        if (typeof call !== "string" || !/\b(?:cd|pushd|popd)\b/.test(call)) continue
        const start = paths.WORK
        const env: Env = {
          cwd: start,
          cwdSure: start,
          files: new Map(),
          known: {},
          old: { dir: start },
          process: {},
          vars: new Map(),
        }
        await run(lex(call), env, async (_cmd, _parsed, here) => {
          const dir = here.old?.dir
          if (dir === undefined || here.cwdBack === undefined) return undefined
          read++
          if (!here.cwdBack.includes(dir)) misses.push(`${call} :: ${dir}`)
          return undefined
        })
      }
    expect(misses).toEqual([])
    expect(read).toBeGreaterThan(100)
  })
})
