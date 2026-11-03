import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { type Env, GIT_TAKES, lex, run, stdinShell } from "../../../scripts/hooks/shell"

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

describe("stdinShell reads a privilege wrapper's root shell", () => {
  test.each<[string, string, "root" | undefined]>([
    ["a program in a variable behind a quoted bare wrapper", `'sudo' "$X"`, "root"],
    ["a second wrapper's shell option behind a plain first wrapper", "doas sudo -i", "root"],
    ["a quoted shell option", "sudo '-s'", "root"],
    ["the shell long option given its command", "sudo --shell ls", undefined],
  ])("%s", (_, line, kind) => {
    expect(stdinShell(lex(line).commands[0])).toBe(kind)
  })
})
